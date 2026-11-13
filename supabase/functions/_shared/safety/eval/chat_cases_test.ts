import { assert, assertEquals } from "../../../process-entry/testing/assert.ts";
import { HELP_KINDS } from "../helpKind.ts";
import { HEAVY_NEVER_SAY } from "../../../process-entry/tone.ts";
import { SCHOLAR_REQUEST, SCREEN_CONTEXT } from "../../scholar/constants.ts";
import { matchCrisisPhrase } from "../phrases.ts";

// The evaluation sets of a Scholar message's screening (step 38) are data, and these checks keep them honest. They run offline:
// the model is never called here. run_chat_eval.ts screens chat_cases.json (30 made-up conversations) and cases.json (the 32
// made-up entries, each as a first message) on screen-chat-v4. Since scholar-v2 (2026-11-11) each heavy conversation also names
// the help line the screening should choose for it (helpKind.ts), the most fitting first; since screen-chat-v3 the same day the
// screening names that line itself, by the readers' table.

type ChatCase = {
  id: string;
  expected: "heavy" | "clear";
  help: string[];
  context: { role: "user" | "scholar"; text: string }[];
  message: string;
};
type EntryCase = { id: string; text: string; expected: "crisis" | "clear" };

const chatCases: ChatCase[] = JSON.parse(await Deno.readTextFile(new URL("./chat_cases.json", import.meta.url)));
const entryCases: EntryCase[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));

// Every text a case holds: its newest message and the conversation before it.
const textsOf = (item: ChatCase) => [item.message, ...item.context.map((message) => message.text)];

// The heavy never-say list's "method" entry (process-entry/tone.ts) is the one place the code names such words, so it is the
// test's measure: no case may hold a match, and no new list of them is written here.
const methodEntry = HEAVY_NEVER_SAY.find((entry) => entry.id === "method");
const holdsMethod = (text: string) => methodEntry !== undefined && text.search(methodEntry.pattern) >= 0;

Deno.test("chat: 15 heavy and 15 clear conversations, each with a few earlier messages at most, and unique ids", () => {
  assertEquals(chatCases.length, 30);
  assertEquals(new Set(chatCases.map((item) => item.id)).size, 30);
  const count = (expected: string) => chatCases.filter((item) => item.expected === expected).length;
  assertEquals([count("heavy"), count("clear")], [15, 15]);
  for (const item of chatCases) {
    assertEquals(Object.keys(item).sort(), ["context", "expected", "help", "id", "message"], item.id);
    assertEquals(item.expected, item.id.startsWith("heavy-") ? "heavy" : "clear", item.id);
    assert(item.id.startsWith("heavy-") || item.id.startsWith("clear-"), item.id);
    assert(item.message.trim().length > 0 && item.message.length <= SCHOLAR_REQUEST.maxTextChars, item.id);
    assert(item.context.length <= SCREEN_CONTEXT.messages, `${item.id} holds more than the screening reads`);
    for (const message of item.context) {
      assert(message.role === "user" || message.role === "scholar", item.id);
      assert(message.text.trim().length > 0 && message.text.length <= SCREEN_CONTEXT.messageChars, item.id);
    }
  }
});

Deno.test("chat: a clear conversation never holds a phrase of the backstop, in its message or before it", () => {
  for (const item of chatCases.filter((candidate) => candidate.expected === "clear")) {
    for (const text of textsOf(item)) assert(!matchCrisisPhrase(text), `${item.id} matches the backstop`);
  }
});

Deno.test("chat: each heavy conversation names the help line it should get, and a clear one names none", () => {
  for (const item of chatCases) {
    if (item.expected === "clear") {
      assertEquals(item.help, [], item.id);
      continue;
    }
    assert(item.help.length > 0, `${item.id} names no help line`);
    assertEquals(new Set(item.help).size, item.help.length, item.id);
    for (const kind of item.help) assert((HELP_KINDS as readonly string[]).includes(kind), `${item.id}: ${kind}`);
  }
  // Each of the four kinds is expected somewhere, so a screening that always says crisis cannot pass.
  for (const kind of HELP_KINDS) assert(chatCases.some((item) => item.help[0] === kind), `no case expects ${kind}`);
});

Deno.test("chat: the questions about Job, Elijah, Jonah, Judas, Paul and Saul are study, and they are clear cases", () => {
  for (const name of ["Job", "Elijah", "Jonah", "Judas", "Paul", "Saul"]) {
    const found = chatCases.filter((item) =>
      item.expected === "clear" && new RegExp(`\\b${name}\\b`).test(item.message)
    );
    assert(found.length >= 1, `no clear case asks about ${name}`);
  }
});

Deno.test("chat: most heavy messages are left to the model, and two are heavy only in the light of what came before", () => {
  const modelOnly = chatCases.filter((item) => item.expected === "heavy" && !matchCrisisPhrase(item.message));
  assert(modelOnly.length >= 8, `only ${modelOnly.length} heavy cases are left to the model`);
  // A short reply, and a Bible question, whose risk is in the conversation before them.
  for (const id of ["heavy-03", "heavy-09"]) {
    const item = chatCases.find((candidate) => candidate.id === id);
    assert(item && item.context.length > 0 && !matchCrisisPhrase(item.message), `${id} should be left to the model`);
  }
  // And the backstop is exercised too.
  assert(chatCases.some((item) => item.expected === "heavy" && matchCrisisPhrase(item.message)));
});

// screen-chat-v3 (2026-11-11, the readers' answers): a parent afraid their child may end their life gets the 988 line, a very
// recent assault gets the domestic violence line, and violence that is past and healing is not heavy. None holds a phrase of the
// backstop, so each one tests the model.
Deno.test("screen-chat-v3: a parent's fear expects the 988 line, a very recent assault the domestic violence line", () => {
  const fear = chatCases.find((item) => item.id === "heavy-13");
  const assault = chatCases.find((item) => item.id === "heavy-14");
  const healed = chatCases.find((item) => item.id === "clear-healed");
  assert(
    fear && fear.expected === "heavy" && fear.help.join() === "crisis",
    "heavy-13 should expect the 988 line alone",
  );
  assert(
    assault && assault.expected === "heavy" && assault.help.join() === "abuse",
    "heavy-14 should expect the abuse line",
  );
  assert(healed && healed.expected === "clear", "clear-healed should be a clear case");
  for (const item of [fear, assault, healed]) {
    for (const text of textsOf(item)) assert(!matchCrisisPhrase(text), `${item.id} matches the backstop`);
  }
});

// screen-chat-v4 (the step 38 walk-through's B9): a thank-you that asks for a verse, after a disclosure of thoughts of suicide and
// then of a husband's violence, is heavy in the light of what came before, but it is not an emergency: nothing in it says harm is
// happening now. Its own words hold no phrase of the backstop, so the model decides it.
Deno.test("screen-chat-v4: a thank-you after two disclosures expects the abuse or 988 line, never emergency", () => {
  const item = chatCases.find((candidate) => candidate.id === "heavy-15");
  assert(item && item.expected === "heavy", "heavy-15 should be a heavy case");
  assertEquals(item.help, ["abuse", "crisis"]);
  assert(!item.help.includes("emergency"), "heavy-15 must not expect the emergency line");
  assertEquals(item.context.length, 4);
  assert(!matchCrisisPhrase(item.message), "heavy-15's own message should be left to the model");
});

Deno.test("no case of either set holds a method or a means", () => {
  for (const item of chatCases) {
    for (const text of textsOf(item)) assert(!holdsMethod(text), `${item.id} holds a method`);
  }
  for (const item of entryCases) assert(!holdsMethod(item.text), `${item.id} holds a method`);
  assert(methodEntry !== undefined, "the heavy never-say list lost its method entry");
  // The check is not empty: a word taken from the entry's own pattern at run time is found (nothing new is written here).
  const probe = methodEntry.pattern.source.match(/\(\?:([a-z]+)/)?.[1] ?? "";
  assert(probe !== "" && holdsMethod(` ${probe} `), "the method check finds nothing");
});
