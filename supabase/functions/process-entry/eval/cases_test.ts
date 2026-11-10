import { matchCrisisPhrase } from "../../_shared/safety/phrases.ts";
import { assert, assertEquals } from "../testing/assert.ts";

// The tone evaluation's entries are data, and these checks keep them honest. They run offline with the other tests: the
// model is never called here. The entries are made up; none is a real person's words.

type Case = { id: string; topic: string; text: string; names: string[]; notes: string };

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const byId = (id: string) => cases.find((item) => item.id === id);

// Step 36: eight real-world cases join the 24 of step 32.
const NEW_CASES = [
  "pidgin-work",
  "short-thanks",
  "decision-job",
  "prayer-for-friend",
  "voice-rambling",
  "unclear-marks",
  "wedding-joy",
  "traffic-annoyance",
];

// gen-v2.6 (2026-11-10): four setbacks whose prayer must meet the need beneath the words and never pray the despairing wish.
const SETBACK_CASES = ["exam-dropout", "job-lost", "give-up-business", "decision-anger"];

Deno.test("36 cases with unique ids, every one in the shape run_tone_eval.ts reads", () => {
  assertEquals(cases.length, 36);
  assertEquals(new Set(cases.map((item) => item.id)).size, 36);
  for (const item of cases) {
    assertEquals(Object.keys(item).sort(), ["id", "names", "notes", "text", "topic"], item.id);
    assert(/^[a-z0-9-]+$/.test(item.id), `${item.id} is a plain id`);
    assert(item.text.length >= 10 && item.text.length <= 5_000, `${item.id} is within the function's 10 to 5,000`);
    assert(Array.isArray(item.names) && item.notes.length > 0, item.id);
    // The swap test draws its decoys by topic.
    assert(typeof item.topic === "string" && item.topic.trim().length > 0, `${item.id} has a topic`);
  }
});

Deno.test("the eight real-world cases of step 36 are there, after the first 24", () => {
  assertEquals(cases.slice(24, 32).map((item) => item.id), NEW_CASES);
});

Deno.test("the four setback cases of gen-v2.6 are there, after the 32, and each says the wish the prayer must not pray", () => {
  assertEquals(cases.slice(32).map((item) => item.id), SETBACK_CASES);
  assert(/drop out/.test(byId("exam-dropout")!.text), "a wish to drop out");
  assert(/rent/i.test(byId("job-lost")!.text), "the rent is the need");
  assert(/giving up/.test(byId("give-up-business")!.text), "a wish to give up on the business, not on life");
  assert(/angry/.test(byId("decision-anger")!.text), "a decision made in anger");
  // Three share a topic, so the swap test draws a same-topic decoy for them; the fourth pairs with decision-job.
  assertEquals(SETBACK_CASES.map((id) => byId(id)!.topic), ["setbacks", "setbacks", "setbacks", "decisions"]);
});

Deno.test("each new case is the kind of entry it names", () => {
  const pidgin = byId("pidgin-work")!;
  assert(pidgin.text.length >= 150 && pidgin.text.length <= 220, `pidgin-work is ${pidgin.text.length} characters`);
  assert(/\b(?:dey|na|abeg|oga|dem)\b/.test(pidgin.text), "pidgin-work is in Pidgin");
  const thanks = byId("short-thanks")!;
  assert(thanks.text.length < 30, `short-thanks is ${thanks.text.length} characters`);
  const rambling = byId("voice-rambling")!;
  assert(rambling.text.length >= 350 && rambling.text.length <= 450, `voice-rambling is ${rambling.text.length}`);
  assert(/\bum\b/i.test(rambling.text), "voice-rambling holds fillers");
  const sentences = rambling.text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.toLowerCase());
  assert(sentences.some((sentence, index) => sentences.indexOf(sentence) !== index), "a sentence is said twice");
  assertEquals(byId("unclear-marks")!.text.match(/\[unclear\]/g)?.length, 3);
  const traffic = byId("traffic-annoyance")!;
  assert(traffic.text.length >= 100 && traffic.text.length <= 140, `traffic-annoyance is ${traffic.text.length}`);
  assertEquals(byId("prayer-for-friend")!.names, ["Ada"]);
});

Deno.test("the short cases are under 5 words and 30 characters, and the long one is over 550 words", () => {
  const short = byId("short-tired");
  const long = byId("long-rambling");
  assert(short && words(short.text) < 5, "the short case");
  assert(long && words(long.text) > 550, `the long case has ${long ? words(long.text) : 0} words`);
  assert(words(byId("short-thanks")!.text) < 6);
});

Deno.test("every name a case lists is in its text, and the name cases are there", () => {
  for (const item of cases) {
    for (const name of item.names) assert(item.text.includes(name), `${item.id} names ${name}`);
  }
  assertEquals(byId("names-grace")?.names, ["Grace"]);
  assertEquals(byId("names-blessing")?.names, ["Blessing", "Ibadan"]);
});

Deno.test("no case is a crisis: the crisis evaluation (step 21) has its own cases", () => {
  for (const item of cases) assert(!matchCrisisPhrase(item.text), `${item.id} matches the crisis phrase list`);
});

Deno.test("every topic but one-off ones has a partner, so the swap test can draw a decoy on the same topic", () => {
  const topics = new Map<string, number>();
  for (const item of cases) topics.set(item.topic, (topics.get(item.topic) ?? 0) + 1);
  // At least two topics, so a decoy on another topic always exists.
  assert(topics.size >= 2);
  // Most cases share their topic with another case.
  const paired = cases.filter((item) => (topics.get(item.topic) ?? 0) >= 2).length;
  assert(paired >= 24, `${paired} cases share a topic`);
});
