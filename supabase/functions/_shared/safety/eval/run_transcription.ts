// A manual check of how faithfully the crisis screening transcribes a recording (step 36), against the real Gemini API. It is
// not a test and it never runs on a deploy or in CI: it needs a key and it spends a little of it (under $0.05 for six clips).
// Run it after any change to the transcription rule in screenPrompt.ts or to the screening model.
//
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
//     --allow-net --allow-env --allow-read --env-file=supabase/functions/.env.local \
//     supabase/functions/_shared/safety/eval/run_transcription.ts --clip path/to/clip.m4a=work-nigerian-english ...
//
//   --clip   a recording and what was read in it: the id of a script in transcription_scripts.json, or the path of a text
//            file holding the script. Repeat it for each clip.
//   --pause  milliseconds between clips (default 2000)
//
// The clips are made-up speech: someone reads a script from transcription_scripts.json aloud, in their own accent, through
// the app's recorder or a voice memo app, and keeps the file outside the repository. Each clip is screened exactly as the
// function screens a recording (screenEntry), with the screening model (GEMINI_SCREENING_MODEL, or GEMINI_MODEL when that is
// empty) and never GEMINI_FALLBACK_MODEL: to measure the fallback, set GEMINI_SCREENING_MODEL to it on the command line.
//
// It prints the clip's file name, the seconds, the words in the script and in what was heard, the word error rate and the
// verdict. Never a transcribed word.
//
// Pass (step 36, decision 12): the median word error rate at most 10% and no clip over 20%. Otherwise the owner decides
// whether the screening uses the stronger model, and this runs again on it.
import { newStats } from "../../../process-entry/gemini.ts";
import { type ScreenConfig, screenEntry, screenTiming } from "../screen.ts";
import { SCREEN_PROMPT_VERSION } from "../screenPrompt.ts";
import { median, normalizeWords, wordErrorRate } from "./wer.ts";

type Script = { id: string; kind: string; script: string };

const PASS_MEDIAN = 0.1;
const PASS_MAX = 0.2;

const args = Deno.args;
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const pause = Number(option("--pause") ?? 2000);
const clipArgs = args.flatMap((arg, at) => (args[at - 1] === "--clip" ? [arg] : []));

const scripts: Script[] = JSON.parse(await Deno.readTextFile(new URL("./transcription_scripts.json", import.meta.url)));
if (clipArgs.length === 0) {
  console.error(
    `Give at least one --clip path.m4a=<script>. The scripts: ${scripts.map((item) => item.id).join(", ")}.`,
  );
  Deno.exit(2);
}

const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() ?? "";
const model = Deno.env.get("GEMINI_SCREENING_MODEL")?.trim() || Deno.env.get("GEMINI_MODEL")?.trim() || "";
const thinkingLevel = Deno.env.get("GEMINI_THINKING_LEVEL")?.trim() || "low";
if (!apiKey || !model) {
  console.error("GEMINI_API_KEY and GEMINI_MODEL must be set in supabase/functions/.env.local");
  Deno.exit(2);
}

async function scriptFor(name: string): Promise<string> {
  const known = scripts.find((item) => item.id === name);
  if (known) return known.script;
  return await Deno.readTextFile(name);
}

const stats = newStats();
const config = (): ScreenConfig => ({
  apiKey,
  model,
  thinkingLevel,
  deadlineAt: Date.now() + screenTiming.deadlineMs,
  stats,
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log(
  `screening model ${model} | thinking ${thinkingLevel} | prompt ${SCREEN_PROMPT_VERSION} | ${clipArgs.length} clip(s)\n`,
);
console.log("clip                             seconds  script  heard   WER     verdict");

const rates: number[] = [];
const unanswered: string[] = [];
for (const [index, entry] of clipArgs.entries()) {
  if (index > 0) await sleep(pause);
  const at = entry.lastIndexOf("=");
  if (at <= 0) {
    console.error(`--clip ${entry}: expected path=script`);
    Deno.exit(2);
  }
  const path = entry.slice(0, at);
  const script = await scriptFor(entry.slice(at + 1));
  const bytes = await Deno.readFile(path);
  const label = (path.split(/[\\/]/).at(-1) ?? path).slice(0, 32);
  const started = Date.now();
  const result = await screenEntry({ kind: "audio", bytes }, config());
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === "failed") {
    unanswered.push(label);
    console.log(`${label.padEnd(32)} ${seconds.padStart(7)}  no answer: ${result.reason}`);
    continue;
  }
  // A crisis with no words, and silence, are measured as nothing heard.
  const heard = result.status === "no_speech" ? "" : result.transcript ?? "";
  const rate = wordErrorRate(script, heard);
  rates.push(rate);
  const verdict = result.status === "crisis" ? `crisis (${result.source})` : result.status;
  console.log(
    `${label.padEnd(32)} ${seconds.padStart(7)}  ${String(normalizeWords(script).length).padStart(6)}  ${
      String(normalizeWords(heard).length).padStart(5)
    }   ${percent(rate).padStart(6)}  ${verdict}`,
  );
}

const middle = median(rates);
const worst = rates.length > 0 ? Math.max(...rates) : null;
console.log(
  `\nmodel calls: ${stats.attempts} attempts | tokens in ${stats.usage.input}, out ${stats.usage.output}, thinking ${stats.usage.thought} | ${
    (stats.ms / 1000).toFixed(1)
  } s of model time`,
);
console.log(`median WER:  ${middle === null ? "-" : percent(middle)} (at most ${percent(PASS_MEDIAN)} to pass)`);
console.log(`worst clip:  ${worst === null ? "-" : percent(worst)} (at most ${percent(PASS_MAX)} to pass)`);
console.log(`no answer:   ${unanswered.length ? unanswered.join(", ") : "none"}`);
const passed = middle !== null && middle <= PASS_MEDIAN && worst !== null && worst <= PASS_MAX &&
  unanswered.length === 0;
console.log(passed ? "\nPASSED." : "\nNOT PASSED: the owner decides the screening model (step 36, decision 12).");
Deno.exit(passed ? 0 : 1);
