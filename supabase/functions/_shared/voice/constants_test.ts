import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { CASCADE_TIMEOUT_SECONDS } from "./agent_setup.ts";
import { VOICE_PRAYER_WORDS, VOICE_WRITER_THINKING, voiceTiming } from "./constants.ts";

// The times of a turn against ElevenLabs' own limit (step 39). ElevenLabs gives an attempt up when no new piece of text has
// arrived for cascade_timeout_seconds, counted from the request's start and from every piece (measured, 2026-11-13). It then
// asks again, and what the first request sends later is never spoken: the person would hear a line twice, or nothing.

const SECOND = 1_000;
// What the moments below keep clear of the limit: the network, and ElevenLabs' own half second before it speaks.
const ROOM_MS = 2 * SECOND;

// The moments at which scholar-voice-llm sends something, from the request's start, when everything is as slow as it may be.
function moments(): Record<string, number[]> {
  const t = voiceTiming;
  // The written answer of last resort is said after the hard-moment answer's whole time and the room the engine's own gets.
  const heavyEnd = t.heavyTotalMs + t.settleMs;
  return {
    // The holding line, then the answer or the not-ready line.
    everyday: [0, t.holdMs, t.answer.totalMs],
    // A heavy conversation: both holding lines, then the answer or the written one.
    heavy: [0, t.heavyHoldMs, t.secondHoldMs, heavyEnd],
    // A conversation the screening calls heavy after the heavy line's moment: its first line comes at the everyday moment.
    flaggedLate: [0, t.holdMs, t.secondHoldMs, heavyEnd],
  };
}

Deno.test("timing: ElevenLabs never waits its whole limit for the next piece of a turn", () => {
  const limit = CASCADE_TIMEOUT_SECONDS * SECOND;
  for (const [turn, at] of Object.entries(moments())) {
    for (let index = 1; index < at.length; index += 1) {
      const gap = at[index] - at[index - 1];
      assert(gap > 0, `${turn}: moment ${index} is not after the one before it`);
      assert(gap + ROOM_MS <= limit, `${turn}: ${gap} ms with nothing sent, against a limit of ${limit} ms`);
    }
  }
});

Deno.test("timing: the holding lines come before the moment their turn ends, the heavy one first", () => {
  const t = voiceTiming;
  assert(t.heavyHoldMs < t.holdMs, "the heavy line comes sooner than the everyday one");
  assert(t.holdMs < t.answer.totalMs, "an everyday turn's holding line comes before its end");
  assert(
    t.holdMs < t.secondHoldMs && t.secondHoldMs < t.heavyTotalMs,
    "the second heavy line comes between the first and the end",
  );
  // An everyday turn never hears a second line: its end is no later than that line's moment.
  assert(t.answer.totalMs <= t.secondHoldMs);
  // The writer of each answer has ended before its turn does.
  assert(t.answer.attemptMs <= t.answer.totalMs && t.settleMs < t.answer.totalMs);
  assert(t.answer.totalMs < t.heavyTotalMs);
});

Deno.test("a talk's everyday writer thinks as little as it can (measured: 3.0 s at low, 1.35 s at minimal)", () => {
  assertEquals(VOICE_WRITER_THINKING, "minimal");
});

Deno.test("a turn that asks Scholar to pray is told apart, and one that is only about prayer is not", () => {
  for (
    const words of [
      "Can you pray with me?",
      "I need a prayer tonight.",
      "Will you keep praying for my son?",
      "Pray for me.",
      "Please pray for my mother.",
      "Help me pray about today",
      "Let’s pray.",
      "let's pray",
      "Let us pray together.",
      "Can we pray about my job?",
      "Could you say a prayer for my exam?",
    ]
  ) {
    assert(VOICE_PRAYER_WORDS.test(words), words);
  }
  for (
    const words of [
      "How do I pray when I feel far from God?",
      "Why do we pray if God already knows?",
      "I prayed about it all week.",
      "My prayers feel empty lately.",
      "She wrote me a prayerful letter.",
      "What does grace mean?",
      "I sprayed the garden today.",
      "Tell me about Psalm 23.",
    ]
  ) {
    assert(!VOICE_PRAYER_WORDS.test(words), words);
  }
});

Deno.test("every prayer request of the evaluation sets is told apart, and no other case is", async () => {
  const dir = new URL("../scholar/eval/", import.meta.url);
  for (const name of ["cases.json", "adversarial.json", "heavy.json"]) {
    const cases = JSON.parse(await Deno.readTextFile(new URL(name, dir))) as {
      id: string;
      message: string;
      asksPrayer?: boolean;
    }[];
    for (const item of cases) {
      assertEquals(VOICE_PRAYER_WORDS.test(item.message), item.asksPrayer === true, `${name} ${item.id}`);
    }
  }
});
