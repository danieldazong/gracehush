import { matchCrisisPhrase } from "../../_shared/safety/phrases.ts";
import { assert, assertEquals } from "../testing/assert.ts";

// The tone evaluation's entries are data, and these checks keep them honest. They run offline with the other tests: the
// model is never called here. The entries are made up; none is a real person's words.

type Case = { id: string; topic: string; text: string; names: string[]; notes: string };

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

Deno.test("24 cases with unique ids, every one in the shape run_tone_eval.ts reads", () => {
  assertEquals(cases.length, 24);
  assertEquals(new Set(cases.map((item) => item.id)).size, 24);
  for (const item of cases) {
    assertEquals(Object.keys(item).sort(), ["id", "names", "notes", "text", "topic"], item.id);
    assert(/^[a-z0-9-]+$/.test(item.id), `${item.id} is a plain id`);
    assert(item.text.length >= 10 && item.text.length <= 5_000, `${item.id} is within the function's 10 to 5,000`);
    assert(Array.isArray(item.names) && item.notes.length > 0, item.id);
  }
});

Deno.test("the short case is under 5 words and the long one over 550", () => {
  const short = cases.find((item) => item.id === "short-tired");
  const long = cases.find((item) => item.id === "long-rambling");
  assert(short && words(short.text) < 5, "the short case");
  assert(long && words(long.text) > 550, `the long case has ${long ? words(long.text) : 0} words`);
});

Deno.test("every name a case lists is in its text, and the two name cases are there", () => {
  for (const item of cases) {
    for (const name of item.names) assert(item.text.includes(name), `${item.id} names ${name}`);
  }
  assertEquals(cases.find((item) => item.id === "names-grace")?.names, ["Grace"]);
  assertEquals(cases.find((item) => item.id === "names-blessing")?.names, ["Blessing", "Ibadan"]);
});

Deno.test("no case is a crisis: the crisis evaluation (step 21) has its own cases", () => {
  for (const item of cases) assert(!matchCrisisPhrase(item.text), `${item.id} matches the crisis phrase list`);
});
