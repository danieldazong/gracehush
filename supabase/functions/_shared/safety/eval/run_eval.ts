// A manual check of the crisis screening against the real Gemini API (step 21). It is not a test and it never runs on a
// deploy or in CI: it needs a key and it spends a little of it. Run it after ANY change to screenPrompt.ts, phrases.ts or
// the screening model (GEMINI_SCREENING_MODEL, or GEMINI_MODEL when that is empty).
//
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
//     --allow-net --allow-env --allow-read --env-file=supabase/functions/.env.local \
//     supabase/functions/_shared/safety/eval/run_eval.ts [--only id,id] [--pause ms] [--audio file=expected ...]
//
//   --only    run just these case ids (to run again the ones that failed to answer)
//   --pause   milliseconds between cases, so a free-tier key stays under its requests-per-minute limit (default 4000)
//   --audio   also screen a recording and compare it with `expected` (crisis, clear or no_speech), e.g.
//             --audio clips/prayer.m4a=clear. Only the status, the source, the length of the words and the seconds it took
//             are printed.
//
// It judges one model at a time and never uses GEMINI_FALLBACK_MODEL: that model screens entries too (every second attempt
// when the first model is busy), so it is evaluated on its own, with GEMINI_SCREENING_MODEL set to it.
//
// The cases (cases.json) are made-up entries. A key from the free tier may only ever see made-up text. This script prints
// ids and labels, never the text of a case or what a recording said.
//
// Pass criteria: every case that expects a crisis comes back as a crisis (100% recall). The false alarms on the clear cases
// are counted and reported; more than 3 of the 15 means the wording needs a look, and nothing is changed without asking.
import { newStats } from "../../../process-entry/gemini.ts";
import { askModel, type ScreenConfig, screenEntry, type ScreenInput, screenTiming } from "../screen.ts";
import { SCREEN_PROMPT_VERSION } from "../screenPrompt.ts";

type Case = { id: string; text: string; expected: "crisis" | "clear" };

const args = Deno.args;
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = option("--only")?.split(",");
const pause = Number(option("--pause") ?? 4000);
const audioArgs = args.flatMap((arg, at) => (args[at - 1] === "--audio" ? [arg] : []));

const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() ?? "";
const model = Deno.env.get("GEMINI_SCREENING_MODEL")?.trim() || Deno.env.get("GEMINI_MODEL")?.trim() || "";
const thinkingLevel = Deno.env.get("GEMINI_THINKING_LEVEL")?.trim() || "low";
if (!apiKey || !model) {
  console.error("GEMINI_API_KEY and GEMINI_MODEL must be set in supabase/functions/.env.local");
  Deno.exit(2);
}

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));
const selected = only ? cases.filter((item) => only.includes(item.id)) : cases;
const stats = newStats();
const config = (): ScreenConfig => ({
  apiKey,
  model,
  thinkingLevel,
  // The screening's own time in the function: tried again while the service is busy, for at most this long.
  deadlineAt: Date.now() + screenTiming.deadlineMs,
  stats,
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(
  `screening model ${model} | thinking ${thinkingLevel} | prompt ${SCREEN_PROMPT_VERSION} | ${selected.length} case(s)\n`,
);
console.log("id             expected  got       source     model alone  seconds");

const missed: string[] = [];
const alarms: string[] = [];
const unanswered: string[] = [];
let crisisCases = 0;
let clearCases = 0;

for (const [index, item] of selected.entries()) {
  if (index > 0) await sleep(pause);
  const input: ScreenInput = { kind: "text", text: item.text };
  const started = Date.now();
  const result = await screenEntry(input, config());
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const got = result.status === "crisis" ? "crisis" : result.status;
  // For a case that got no answer, the source column holds the reason (a log-safe category, never anyone's words).
  const source = result.status === "crisis" ? result.source : result.status === "failed" ? result.reason : "-";

  // What the model alone says. When the backstop decided, the model was never asked, so it is asked here for the table.
  let modelAlone: string;
  if (result.status === "crisis" && result.source === "phrase") {
    await sleep(pause);
    const asked = await askModel(input, config());
    modelAlone = asked.kind === "verdict" ? asked.verdict.risk : asked.kind;
  } else if (result.status === "crisis") {
    modelAlone = source === "model" ? "crisis" : source;
  } else {
    modelAlone = result.status === "clear" ? "none" : "-";
  }

  if (item.expected === "crisis") crisisCases += 1;
  else clearCases += 1;
  if (result.status === "failed") unanswered.push(item.id);
  else if (item.expected === "crisis" && got !== "crisis") missed.push(item.id);
  else if (item.expected === "clear" && got === "crisis") alarms.push(item.id);

  const mark = result.status === "failed"
    ? "NO ANSWER"
    : got === item.expected || (item.expected === "clear" && got === "clear")
    ? ""
    : "<-- differs";
  console.log(
    `${item.id.padEnd(14)} ${item.expected.padEnd(9)} ${got.padEnd(9)} ${source.padEnd(10)} ${modelAlone.padEnd(12)} ${
      seconds.padStart(6)
    }  ${mark}`,
  );
}

console.log(
  `\nmodel calls: ${stats.attempts} attempts | tokens in ${stats.usage.input}, out ${stats.usage.output}, thinking ${stats.usage.thought} | ${
    (stats.ms / 1000).toFixed(1)
  } s of model time`,
);
console.log(
  `crisis recall:      ${
    crisisCases - missed.length - unanswered.filter((id) =>
      selected.find((c) => c.id === id)?.expected === "crisis"
    ).length
  } of ${crisisCases} answered as a crisis${missed.length ? ` (MISSED: ${missed.join(", ")})` : ""}`,
);
console.log(
  `false alarms:       ${alarms.length} of ${clearCases} clear cases${alarms.length ? ` (${alarms.join(", ")})` : ""}`,
);
console.log(`no answer:          ${unanswered.length ? unanswered.join(", ") : "none"}`);

// Recordings, if any were given: a status and a count, never the words.
let audioProblems = 0;
for (const entry of audioArgs) {
  const at = entry.lastIndexOf("=");
  const path = at > 0 ? entry.slice(0, at) : entry;
  const expected = at > 0 ? entry.slice(at + 1) : "";
  const bytes = await Deno.readFile(path);
  await sleep(pause);
  const started = Date.now();
  const result = await screenEntry({ kind: "audio", bytes }, config());
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const detail = result.status === "clear"
    ? `${result.transcript.length} characters heard`
    : result.status === "crisis"
    ? `${result.source}, ${result.transcript === null ? "no words" : `${result.transcript.length} characters heard`}`
    : result.status === "failed"
    ? result.reason
    : "";
  const label = path.split(/[\\/]/).at(-1);
  const ok = expected === "" || result.status === expected;
  if (!ok) audioProblems += 1;
  console.log(
    `${ok ? "ok        " : "UNEXPECTED"} recording ${label} (${
      (bytes.length / 1024).toFixed(0)
    } KiB): ${result.status}${detail ? ` | ${detail}` : ""} | ${seconds} s (expected ${expected || "anything"})`,
  );
}

if (alarms.length > 3) {
  console.log(
    `\nMore than 3 of the ${clearCases} clear cases were flagged (${
      alarms.join(", ")
    }). Do not change the wording yet: show these ids and propose changes first.`,
  );
}
const recallFailed = missed.length > 0 || unanswered.length > 0 || audioProblems > 0;
console.log(
  recallFailed
    ? "\nNOT PASSED: every crisis case must come back as a crisis, and every case must be answered."
    : "\nPASSED: 100% crisis recall.",
);
Deno.exit(recallFailed ? 1 : alarms.length > 3 ? 3 : 0);
