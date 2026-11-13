import { assert, assertEquals } from "../../../process-entry/testing/assert.ts";
import { matchCrisisPhrase } from "../phrases.ts";

// The evaluation set is data, and these checks keep it honest. They run offline: the model is never called here.

type Case = { id: string; text: string; expected: "crisis" | "clear" };

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));

Deno.test("the set is 11 crisis, 5 uncertain (which also expect a crisis) and 16 clear cases, with unique ids", () => {
  assertEquals(cases.length, 32);
  assertEquals(new Set(cases.map((item) => item.id)).size, 32);
  const count = (prefix: string) => cases.filter((item) => item.id.startsWith(prefix)).length;
  assertEquals([count("crisis-"), count("uncertain-"), count("clear-")], [11, 5, 16]);
  for (const item of cases) {
    assertEquals(Object.keys(item).sort(), ["expected", "id", "text"]);
    assert(item.expected === "crisis" || item.expected === "clear", item.id);
    assertEquals(item.expected, item.id.startsWith("clear-") ? "clear" : "crisis", item.id);
    assert(item.text.length >= 40 && item.text.length <= 500, `${item.id} is a few plain sentences`);
  }
});

Deno.test("a clear case never holds a phrase of the backstop: a false alarm there would not be the model's", () => {
  for (const item of cases.filter((candidate) => candidate.expected === "clear")) {
    assert(!matchCrisisPhrase(item.text), `${item.id} matches the backstop`);
  }
});

Deno.test("only the model can find the uncertain cases and several of the crisis ones, so the model is really tested", () => {
  const modelOnly = cases.filter((item) => item.expected === "crisis" && !matchCrisisPhrase(item.text)).map((item) =>
    item.id
  );
  for (const id of ["uncertain-01", "uncertain-02", "uncertain-03", "uncertain-04", "uncertain-05"]) {
    assert(modelOnly.includes(id), `${id} should be left to the model`);
  }
  assert(modelOnly.length >= 8, `only ${modelOnly.length} cases are left to the model`);
  // And the backstop does catch the plainest statements, so it is tested too.
  for (const id of ["crisis-01", "crisis-02", "crisis-03", "crisis-04", "crisis-05", "crisis-08"]) {
    const item = cases.find((candidate) => candidate.id === id);
    assert(item && matchCrisisPhrase(item.text), `${id} should match the backstop`);
  }
});

// screen-v4 (2026-11-11, the readers' answer): abuse or violence that happened very recently is a crisis, and violence that is
// clearly past and healing is not. Neither case holds a phrase of the backstop, so both test the model.
Deno.test("screen-v4: a very recent assault is a crisis the model must find, and a healed past one is a clear case", () => {
  const recent = cases.find((item) => item.id === "crisis-11");
  const past = cases.find((item) => item.id === "clear-16");
  assert(
    recent && recent.expected === "crisis" && !matchCrisisPhrase(recent.text),
    "crisis-11 should be left to the model",
  );
  assert(past && past.expected === "clear" && !matchCrisisPhrase(past.text), "clear-16 should be a clear case");
});
