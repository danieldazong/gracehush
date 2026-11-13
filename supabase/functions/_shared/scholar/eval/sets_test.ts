import { assert, assertEquals } from "../../../process-entry/testing/assert.ts";
import { HEAVY_NEVER_SAY } from "../../../process-entry/tone.ts";
import { parseReference } from "../../bible/reference.ts";
import { HELP_KINDS } from "../../safety/helpKind.ts";
import { matchCrisisPhrase } from "../../safety/phrases.ts";
import { SCHOLAR_REQUEST, WRITER_CONTEXT } from "../constants.ts";
import { HARD_PASSAGE_KEYS } from "../heavyChat.ts";

// Scholar's three answer sets (step 38) are data, and these checks keep them honest. They run offline: the model is never
// called here. run_scholar_eval.ts answers them: cases.json (20 everyday conversations, graded), adversarial.json (30 attempts
// at the five failures) and heavy.json (the hard-moment set of scholar-v2: the readers' twelve cases with their own rewrites, which
// the grader compares with and the writer never sees, and the cases they found missing).

type Message = {
  role: "user" | "scholar";
  text: string;
  prayer?: string;
  passageKey?: string;
  help?: string;
};
type Reflection = {
  words: string;
  title: string;
  feeling: string;
  passage: string;
  devotional: string;
  closingPrayer: string;
};
type Everyday = {
  id: string;
  topic: string;
  asksPrayer: boolean;
  reflection: Reflection | null;
  context: Message[];
  message: string;
};
type Adversarial = { id: string; target: string; context: Message[]; message: string };
type Heavy = {
  id: string;
  force: boolean;
  heavyBefore: boolean;
  region: string;
  hour: number;
  help: string[];
  asksPrayer: boolean;
  under18: boolean;
  expectPath: string | null;
  context: Message[];
  message: string;
  target: string | null;
  targetPassage: string | null;
};

const read = async <T>(name: string): Promise<T[]> =>
  JSON.parse(await Deno.readTextFile(new URL(`./${name}`, import.meta.url)));
const everyday = await read<Everyday>("cases.json");
const adversarial = await read<Adversarial>("adversarial.json");
const heavy = await read<Heavy>("heavy.json");

const TARGETS = ["method", "human", "romantic", "medical", "typed_verse"];

// The heavy never-say list's "method" entry (process-entry/tone.ts) is the one place the code names such words, so it is the
// measure here too: no case may hold a match, and no new list of them is written.
const methodEntry = HEAVY_NEVER_SAY.find((entry) => entry.id === "method");
const holdsMethod = (text: string) => methodEntry !== undefined && text.search(methodEntry.pattern) >= 0;

const textsOf = (
  item: { message: string; context: Message[]; reflection?: Reflection | null; target?: string | null },
) => [
  item.message,
  ...item.context.flatMap((message) => (message.prayer ? [message.text, message.prayer] : [message.text])),
  ...(item.reflection ? Object.values(item.reflection) : []),
  ...(item.target ? [item.target] : []),
];

function checkMessages(id: string, message: string, context: Message[]): void {
  assert(message.trim().length > 0 && message.length <= SCHOLAR_REQUEST.maxTextChars, `${id}: its message`);
  for (const earlier of context) {
    assert(earlier.role === "user" || earlier.role === "scholar", `${id}: a role`);
    assert(
      earlier.text.trim().length > 0 && earlier.text.length <= WRITER_CONTEXT.messageChars,
      `${id}: an earlier message`,
    );
  }
}

Deno.test("everyday: 20 conversations with unique ids, three asking for a prayer and two opened from a reflection", () => {
  assertEquals(everyday.length, 20);
  assertEquals(new Set(everyday.map((item) => item.id)).size, 20);
  for (const item of everyday) {
    assertEquals(Object.keys(item).sort(), ["asksPrayer", "context", "id", "message", "reflection", "topic"], item.id);
    assert(typeof item.asksPrayer === "boolean" && typeof item.topic === "string", item.id);
    checkMessages(item.id, item.message, item.context);
    if (item.reflection !== null) {
      assertEquals(
        Object.keys(item.reflection).sort(),
        ["closingPrayer", "devotional", "feeling", "passage", "title", "words"],
        item.id,
      );
      assert(Object.values(item.reflection).every((value) => typeof value === "string" && value !== ""), item.id);
      assert(parseReference(item.reflection.passage) !== null, `${item.id}: its reflection's passage is a reference`);
    }
  }
  assert(everyday.filter((item) => item.asksPrayer).length >= 3, "at least three ask for a prayer");
  assert(everyday.filter((item) => item.reflection !== null).length >= 2, "at least two are opened from a reflection");
  assert(everyday.filter((item) => item.context.length > 0).length >= 3, "at least three are follow-ups");
});

Deno.test("everyday: a clear conversation never holds a phrase of the backstop", () => {
  for (const item of everyday) {
    for (const text of textsOf(item)) assert(!matchCrisisPhrase(text), `${item.id} matches the backstop`);
  }
});

Deno.test("adversarial: 30 attempts, six at each of the five failures, with unique ids", () => {
  assertEquals(adversarial.length, 30);
  assertEquals(new Set(adversarial.map((item) => item.id)).size, 30);
  for (const item of adversarial) {
    assertEquals(Object.keys(item).sort(), ["context", "id", "message", "target"], item.id);
    assert(TARGETS.includes(item.target), item.id);
    checkMessages(item.id, item.message, item.context);
  }
  for (const target of TARGETS) {
    assertEquals(adversarial.filter((item) => item.target === target).length, 6, target);
  }
});

const HARD_KEYS = HARD_PASSAGE_KEYS as readonly string[];
const KINDS = HELP_KINDS as readonly string[];
const PATHS = ["everyday", "heavy", "fallback", "emergency", "adults_only", "refused"];

Deno.test("hard moments: the readers' twelve cases with their rewrites, and the cases they found missing, with unique ids", () => {
  assertEquals(heavy.length, 27);
  assertEquals(new Set(heavy.map((item) => item.id)).size, 27);
  for (const item of heavy) {
    assertEquals(
      Object.keys(item).sort(),
      [
        "asksPrayer",
        "context",
        "expectPath",
        "force",
        "heavyBefore",
        "help",
        "hour",
        "id",
        "message",
        "region",
        "target",
        "targetPassage",
        "under18",
      ],
      item.id,
    );
    for (const flag of [item.force, item.heavyBefore, item.asksPrayer, item.under18]) {
      assert(typeof flag === "boolean", item.id);
    }
    assert(item.region === "us" || item.region === "other", item.id);
    assert(Number.isInteger(item.hour) && item.hour >= 0 && item.hour <= 23, `${item.id}: its hour`);
    assert(item.help.every((kind) => KINDS.includes(kind)), `${item.id}: a help line`);
    assertEquals(new Set(item.help).size, item.help.length, item.id);
    assert(item.expectPath === null || PATHS.includes(item.expectPath), `${item.id}: its path`);
    checkMessages(item.id, item.message, item.context);
    for (const earlier of item.context) {
      if (earlier.role === "user") {
        assertEquals(Object.keys(earlier).sort(), ["role", "text"], item.id);
        continue;
      }
      assert(earlier.passageKey === undefined || HARD_KEYS.includes(earlier.passageKey), `${item.id}: a card`);
      assert(earlier.help === undefined || KINDS.includes(earlier.help), `${item.id}: an earlier help line`);
      assert(earlier.prayer === undefined || earlier.prayer.trim().length > 0, `${item.id}: a prayer`);
    }
    // A conversation that is already heavy has had a heavy answer, with its help line under it.
    if (item.heavyBefore) {
      assert(item.context.some((earlier) => earlier.role === "scholar" && earlier.help !== undefined), item.id);
    }
    // A case sent as production sends it may end anywhere; a forced one names the help line it is written for.
    if (item.force && item.expectPath !== "adults_only") assert(item.help.length > 0, `${item.id} names no help line`);
  }
  // The readers' twelve keep their rewrites, as anchors for the grader, each with the card they chose from their list.
  const reviewed = heavy.filter((item) => /^h-(0[1-9]|1[0-2])$/.test(item.id));
  assertEquals(reviewed.length, 12);
  for (const item of reviewed) {
    assert(item.target !== null && item.target.split(/\s+/).length >= 50, `${item.id}: its rewrite`);
    assert(item.targetPassage !== null && HARD_KEYS.includes(item.targetPassage), `${item.id}: its card`);
  }
  for (const item of heavy.filter((candidate) => !reviewed.includes(candidate))) {
    assertEquals([item.target, item.targetPassage], [null, null], item.id);
  }
});

Deno.test("hard moments: the h-10 fixture prays, as the person asked, and shows a card", () => {
  const item = heavy.find((candidate) => candidate.id === "h-10");
  const earlier = item?.context.find((message) => message.role === "scholar");
  assert(item !== undefined && item.heavyBefore && earlier !== undefined);
  assert(/pray/i.test(item.context[0].text), "the person asked for prayer");
  assert((earlier.prayer ?? "").split(/\s+/).length >= 50, "Scholar's earlier answer prays");
  assert(earlier.passageKey !== undefined, "Scholar's earlier answer showed a card");
});

Deno.test("hard moments: every situation the readers listed is covered", () => {
  const ids = new Set(heavy.map((item) => item.id));
  const count = (keep: (item: Heavy) => boolean) => heavy.filter(keep).length;
  // Each kind of help line is the first expectation of some case, so a screening that always says crisis cannot pass.
  for (const kind of HELP_KINDS) assert(count((item) => item.help[0] === kind) >= 1, `no case expects ${kind}`);
  assert(count((item) => item.help[0] === "abuse") >= 3, "the cases of harm done to the person");
  assert(count((item) => item.expectPath === "emergency") >= 1, "harm already underway");
  assert(count((item) => item.under18 && item.force) >= 2, "a child in a hard moment, and a child being harmed");
  assert(count((item) => item.expectPath === "adults_only") >= 1, "a child with an everyday question");
  assert(count((item) => !item.force) >= 3, "cases sent exactly as production sends them");
  assert(count((item) => item.region === "other") >= 1, "a phone outside the US");
  assert(count((item) => item.asksPrayer) >= 1, "a request for prayer in a hard moment");
  assert(count((item) => item.heavyBefore) >= 3, "later turns of a heavy conversation");
  assert(count((item) => item.hour < 5 || item.hour >= 21) >= 5, "messages late at night");
  // A second flagged message later in a conversation: heavy before, and a message the case expects flagged again.
  assert(
    heavy.some((item) => item.heavyBefore && item.context.filter((message) => message.role === "scholar").length >= 2),
    "a second flagged message later in the conversation",
  );
  // A message not in English.
  assert(heavy.some((item) => /[áéíóúñ¿¡]/i.test(item.message)), "a message not in English");
  for (const id of ["h-13", "h-15", "h-16", "h-17", "h-19", "h-20", "h-21", "h-22", "h-24"]) {
    assert(ids.has(id), `missing ${id}`);
  }
  const modelOnly = heavy.filter((item) => !matchCrisisPhrase(item.message));
  assert(modelOnly.length >= 15, `only ${modelOnly.length} hard-moment cases are left to the model`);
  assert(heavy.some((item) => matchCrisisPhrase(item.message)), "the backstop is exercised too");
});

Deno.test("no case of the three sets holds a method or a means, and the ids never repeat across them", () => {
  for (const item of [...everyday, ...adversarial, ...heavy]) {
    for (const text of textsOf(item)) assert(!holdsMethod(text), `${item.id} holds a method`);
  }
  assert(methodEntry !== undefined, "the heavy never-say list lost its method entry");
  // The check is not empty: a word taken from the entry's own pattern at run time is found (nothing new is written here).
  const probe = methodEntry.pattern.source.match(/\(\?:([a-z]+)/)?.[1] ?? "";
  assert(probe !== "" && holdsMethod(` ${probe} `), "the method check finds nothing");
  const ids = [...everyday, ...adversarial, ...heavy].map((item) => item.id);
  assertEquals(new Set(ids).size, ids.length);
});
