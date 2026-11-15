import { assert } from "../../process-entry/testing/assert.ts";
import { matchCrisisGroup } from "../safety/phrases.ts";
import { isStopOnly } from "./stop.ts";

// A whole turn that is only a stop word (step 39, decision 37).

Deno.test("stop: each stop word alone, whatever its case and punctuation", () => {
  for (
    const words of [
      "stop",
      "Stop.",
      "STOP!",
      "Wait.",
      "wait…",
      "Hold on.",
      "Pause.",
      "One moment.",
      "One second.",
      "Just a moment.",
      "Be quiet.",
      "  stop  ",
    ]
  ) {
    assert(isStopOnly(words), `"${words}" is only a stop word`);
  }
});

Deno.test("stop: with okay, please or Scholar around it", () => {
  for (
    const words of [
      "Okay, stop.",
      "Stop, please.",
      "Please stop.",
      "Scholar, wait.",
      "OK, hold on, Scholar.",
      "Okay Scholar, one moment please.",
    ]
  ) {
    assert(isStopOnly(words), `"${words}" is only a stop word`);
  }
});

Deno.test("stop: a stop word the speech-to-text wrote as another word", () => {
  for (const words of ["Weight.", "weight", "Weigh.", "Okay, weight.", "Weight, please.", "Scholar, weigh."]) {
    assert(isStopOnly(words), `"${words}" is heard as "wait"`);
  }
  for (
    const words of ["The weight is heavy.", "Weight loss.", "What weight?", "Weigh my heart, Lord.", "Wait weight"]
  ) {
    assert(!isStopOnly(words), `"${words}" is an ordinary turn`);
  }
});

Deno.test("stop: anything more than a stop word is an ordinary turn", () => {
  for (
    const words of [
      "",
      "…",
      "Okay.",
      "Please.",
      "Scholar?",
      "Stop it.",
      "Stop, I have a question.",
      "Wait, what does that verse mean?",
      "I can’t stop crying.",
      "Don’t stop.",
      "stop stop",
      "Hold on to me, Lord.",
      "Be quiet and know that he is God, is that the verse?",
      "nonstop",
    ]
  ) {
    assert(!isStopOnly(words), `"${words}" is not only a stop word`);
  }
});

Deno.test("stop: a turn that holds a phrase of the phrase list is never only a stop word", () => {
  // The same made-up sentence the screening's tests use: a feeling, no method.
  const heavy = "I do not want to be alive anymore.";
  assert(matchCrisisGroup(heavy) !== null, "the fixture is a phrase of the list");
  for (const words of [`Stop. ${heavy}`, `Wait. ${heavy}`, `${heavy} Stop.`, `Okay, stop, please. ${heavy}`]) {
    assert(!isStopOnly(words), `"${words.slice(0, 12)}…" goes to the engine`);
  }
  // And no stop word, alone or dressed, is itself a phrase of the list.
  for (const words of ["stop", "wait", "hold on", "pause", "one moment", "one second", "just a moment", "be quiet"]) {
    assert(matchCrisisGroup(words) === null, `"${words}" is not on the phrase list`);
  }
});
