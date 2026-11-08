import { assert, assertEquals } from "../testing/assert.ts";
import { pickDecoys, readSwapAnswer, SWAP_LABELS, swapOrder } from "./swap.ts";

// The swap test (step 36, decision 14): the grader sees a reflection and three entries, the real one and two decoys, and says
// which entry the reflection was written for. These checks keep the draw fair; the model is never called here.

type Case = { id: string; topic: string; text: string; names: string[]; notes: string };

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));

Deno.test("decoys: two other cases on two topics, the first on the case's own topic whenever one exists", () => {
  for (const item of cases) {
    const [first, second] = pickDecoys(cases, item.id);
    assert(first.id !== item.id && second.id !== item.id && first.id !== second.id, item.id);
    assert(first.topic !== second.topic, `${item.id}: both decoys are on one topic`);
    assert(second.topic !== item.topic, `${item.id}: the second decoy is on another topic`);
    const partner = cases.some((other) => other.id !== item.id && other.topic === item.topic);
    // A same-topic decoy is the hard one: a devotional that only matches the topic cannot tell them apart.
    if (partner) assertEquals(first.topic, item.topic, item.id);
  }
});

Deno.test("decoys for a case alone on its topic: two other topics, never two decoys from one", () => {
  // Every real case has a topic partner today, so this branch is drawn on a made-up list: a dozen cases alone on their topics,
  // and the others all on one topic but for a single case on another, so a draw that forgot the rule would pair two decoys from
  // the crowded topic.
  const crowd = Array.from({ length: 30 }, (_, index) => ({ id: `crowd-${index}`, topic: "crowded" }));
  const alone = Array.from({ length: 12 }, (_, index) => ({ id: `alone-${index}`, topic: `alone ${index}` }));
  const list = [...crowd, { id: "single", topic: "single" }, ...alone];
  for (const item of alone) {
    const [first, second] = pickDecoys(list, item.id);
    assert(first.topic !== item.topic && second.topic !== item.topic, `${item.id}: a decoy on its own topic`);
    assert(first.topic !== second.topic, `${item.id}: both decoys are on the topic "${first.topic}"`);
  }
});

Deno.test("the draw and the order are the same on every run, seeded by the case's id", () => {
  for (const item of cases) {
    assertEquals(
      pickDecoys(cases, item.id).map((decoy) => decoy.id),
      pickDecoys(cases, item.id).map((decoy) => decoy.id),
    );
    assertEquals(swapOrder(item.id), swapOrder(item.id));
    assertEquals([...swapOrder(item.id)].sort(), [0, 1, 2], "a permutation of the real entry and the two decoys");
  }
  // An id that is not a case is refused rather than drawn from nothing.
  let refused = false;
  try {
    pickDecoys(cases, "no-such-case");
  } catch {
    refused = true;
  }
  assert(refused);
});

Deno.test("the real entry is not always in one place: over the 32 cases it is shown as A, B and C", () => {
  assertEquals(SWAP_LABELS, ["A", "B", "C"]);
  const places = cases.map((item) => swapOrder(item.id).indexOf(0));
  for (const place of [0, 1, 2]) {
    const count = places.filter((found) => found === place).length;
    assert(count >= 5, `the real entry is ${SWAP_LABELS[place]} for ${count} cases`);
  }
});

Deno.test("the grader's answer is one letter, read strictly", () => {
  assertEquals(readSwapAnswer('{"entry":"B"}'), "B");
  assertEquals(readSwapAnswer('```json\n{"entry": "c"}\n```'), "C");
  for (const bad of ['{"entry":"D"}', '{"entry":""}', '{"answer":"A"}', "A", "[]", '{"entry":1}']) {
    assertEquals(readSwapAnswer(bad), null, bad);
  }
});
