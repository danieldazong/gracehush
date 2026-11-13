import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { SPEECH_PART_CHARS } from "./constants.ts";
import { SPOKEN_HELP_LINE, spokenHelpLine } from "./heavyChat.ts";
import type { StoredBlock } from "./prompt.ts";
import { buildScholarSpeech } from "./script.ts";

const sentence = (index: number) => `This is sentence number ${index} of a long and patient answer about God.`;

const ANSWER: StoredBlock[] = [
  { type: "passage", reference: "John 3:16", text: "For God so loved the world that He gave His one and only Son." },
  {
    type: "text",
    text: [Array.from({ length: 5 }, (_, i) => sentence(i + 1)).join(" "), "**Rest** in him [pause long] today."]
      .join("\n\n"),
  },
  { type: "passage", reference: "Psalm 23:1–2", text: "The LORD is my shepherd;\nI shall not want." },
  { type: "prayer", text: "Lord, I bring you my day. Give me rest tonight." },
];

Deno.test("the parts follow the blocks' order: the lead reading, the answer, the supporting reading, the prayer", () => {
  const parts = buildScholarSpeech(ANSWER, { helpLine: null });
  const joined = parts.join(" | ");
  const order = [
    "A reading from John chapter 3, verse 16.",
    "This is sentence number 1",
    "Rest in him today.",
    "A reading from Psalm 23, verses 1 through 2.",
    "Let's pray.",
    "Give me rest tonight.",
    "Amen.",
  ].map((text) => joined.indexOf(text));
  assert(order.every((index) => index >= 0), JSON.stringify(order));
  assertEquals([...order].sort((a, b) => a - b), order);
  // The Bible's capitals are said as words, and nothing the model wrote reaches the voice as markup.
  assert(joined.includes("The Lord is my shepherd"));
  assert(!/[[\]<>*_#]/.test(joined), joined);
  assert(!joined.includes("pause"));
  // A block starts a new part, so a reading never runs on from the answer.
  assert(parts.some((part) => part.startsWith("A reading from Psalm 23")));
  assert(parts.some((part) => part.startsWith("Let's pray.")));
});

Deno.test("parts break at sentence ends: the first at most 160 characters, the rest at most 280", () => {
  const parts = buildScholarSpeech(ANSWER, { helpLine: null });
  assert(parts[0].length <= SPEECH_PART_CHARS.first, `${parts[0].length}`);
  for (const part of parts.slice(1)) assert(part.length <= SPEECH_PART_CHARS.rest, `${part.length}: ${part}`);
  for (const part of parts) assert(/[.!?"')]$/.test(part), `a part ends a sentence: ${part}`);
});

Deno.test("a sentence longer than a part stays whole, in a part of its own", () => {
  const long = `${"word ".repeat(80).trim()}.`;
  const parts = buildScholarSpeech([{ type: "text", text: `Short first. ${long} Short last.` }], { helpLine: null });
  assertEquals(parts, ["Short first.", long, "Short last."]);
});

Deno.test("the help sentence is spoken once, as the last part, only when there is one", () => {
  const without = buildScholarSpeech(ANSWER, { helpLine: null });
  const withLine = buildScholarSpeech(ANSWER, { helpLine: SPOKEN_HELP_LINE });
  assertEquals(withLine.length, without.length + 1);
  assertEquals(withLine[withLine.length - 1], SPOKEN_HELP_LINE.replace(/’/g, "'"));
  assertEquals(withLine.filter((part) => part.includes("nine eight eight")).length, 1);
  assertEquals(without.filter((part) => part.includes("nine eight eight")).length, 0);
  // No answer, no help sentence on its own.
  assertEquals(buildScholarSpeech([], { helpLine: SPOKEN_HELP_LINE }), []);
});

Deno.test("the spoken help sentence follows the answer's help line and the phone's region", () => {
  const last = (line: string) => {
    const parts = buildScholarSpeech(ANSWER, { helpLine: line });
    return parts[parts.length - 1];
  };
  const abuse = last(spokenHelpLine("abuse", "us"));
  assert(abuse.includes("National Domestic Violence Hotline"), abuse);
  assert(abuse.includes("one eight hundred, seven nine nine, seven two three three"), abuse);
  assert(abuse.includes("text START to eight eight seven eight eight"), abuse);
  assert(abuse.includes("nine one one") && !abuse.includes("nine eight eight"), abuse);
  const emergency = last(spokenHelpLine("emergency", "us"));
  assert(emergency.includes("nine one one") && !emergency.includes("nine eight eight"), emergency);
  const others = last(spokenHelpLine("harm_others", "us"));
  assert(others.includes("nine eight eight") && others.includes("nine one one"), others);
  // Outside the US the voice names no US number: the local emergency number and the directory.
  for (const help of ["crisis", "abuse", "harm_others", "emergency"] as const) {
    const line = last(spokenHelpLine(help, "other"));
    assert(!/nine (?:eight eight|one one)|eight hundred|eight eight seven/.test(line), `${help}: ${line}`);
    assert(line.includes("your local emergency number"), `${help}: ${line}`);
  }
  // Every spoken line is plain words: no digit, no symbol a voice would spell out.
  for (const region of ["us", "other"] as const) {
    for (const help of ["crisis", "abuse", "harm_others", "emergency"] as const) {
      const line = spokenHelpLine(help, region);
      assert(!/[0-9@#/<>[\]]/.test(line), line);
    }
  }
});

Deno.test("an empty answer is no script, and a passage whose reference cannot be read is left out", () => {
  assertEquals(buildScholarSpeech([], { helpLine: null }), []);
  const parts = buildScholarSpeech(
    [{ type: "passage", reference: "Nowhere 1:1", text: "words" }, { type: "text", text: "God is near." }],
    { helpLine: null },
  );
  assertEquals(parts, ["God is near."]);
});
