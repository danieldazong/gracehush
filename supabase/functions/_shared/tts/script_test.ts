import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { buildSpeechScript, cleanForSpeech, MAX_SCRIPT_BYTES, type SpeechInput } from "./script.ts";

const DEVOTIONAL = "It makes sense that you feel tired.\n\nGod is near in the quiet hours.\n\nRest now, you are held.";
const VERSE =
  "In vain you rise early\nand stay up late,\ntoiling for bread to eat—\nfor He gives sleep to His beloved.";

const input = (over: Partial<SpeechInput> = {}): SpeechInput => ({
  devotional: DEVOTIONAL,
  scripture: { reference: "Psalm 127:2", text: VERSE },
  closingPrayer: "Lord, give us rest in You.",
  ...over,
});

const tags = (markup: string) => markup.match(/\[[^\]]*\]/g) ?? [];
const ZWSP = String.fromCharCode(0x200b);
const BEL = String.fromCharCode(7);
const VS16 = String.fromCharCode(0xfe0f);

Deno.test("the whole script, in order: devotional, reading, prayer, with the pauses between", () => {
  const script = buildSpeechScript(input());
  assert(script !== null);
  assertEquals(
    script.markup,
    "It makes sense that you feel tired. [pause] God is near in the quiet hours. " +
      "[pause] Rest now, you are held. [pause long] A reading from Psalm 127, verse 2. [pause short] " +
      "In vain you rise early and stay up late, toiling for bread to eat, for He gives sleep to His beloved. " +
      "[pause long] Let's pray. [pause short] Lord, give us rest in You. Amen.",
  );
  assertEquals([script.scripture, script.prayer], [true, true]);
  assertEquals(script.chars, script.markup.length, "plain ASCII: one character per byte");
  assertEquals(script.bytes, script.markup.length);
});

Deno.test("without a verified passage there is no reading, and without a prayer no prayer", () => {
  const noPassage = buildSpeechScript(input({ scripture: null }));
  assert(noPassage !== null);
  assert(!noPassage.markup.includes("A reading from"), "no passage, no reading");
  assert(
    noPassage.markup.endsWith(
      "Rest now, you are held. [pause] Let's pray. [pause short] Lord, give us rest in You. Amen.",
    ),
  );
  assertEquals([noPassage.scripture, noPassage.prayer], [false, true]);

  const noPrayer = buildSpeechScript(input({ closingPrayer: null }));
  assert(noPrayer !== null);
  assert(!noPrayer.markup.includes("Let's pray") && !noPrayer.markup.includes("Amen"));
  assert(noPrayer.markup.endsWith("to His beloved."), "no pause tag is left at the very end");
  assertEquals([noPrayer.scripture, noPrayer.prayer], [true, false]);

  const bare = buildSpeechScript(input({ scripture: null, closingPrayer: "  " }));
  assert(bare !== null);
  assertEquals(
    bare.markup,
    "It makes sense that you feel tired. [pause] God is near in the quiet hours. [pause] Rest now, you are held.",
  );
});

Deno.test("the devotional's first sentence is the first thing heard: no fixed line, no title, no pause before it", () => {
  for (const over of [{}, { scripture: null }, { closingPrayer: null }]) {
    const markup = buildSpeechScript(input(over))?.markup ?? "";
    assert(markup.startsWith("It makes sense that you feel tired. [pause] "), markup);
    assert(!markup.includes("Here is your devotional"), markup);
  }
});

Deno.test("a reference that cannot be read, or a verse with nothing left, is no reading: never a guess", () => {
  for (
    const scripture of [{ reference: "Hezekiah 4:1", text: VERSE }, { reference: "not a reference", text: VERSE }, {
      reference: "Psalm 127:2",
      text: "<b></b>  ",
    }]
  ) {
    const script = buildSpeechScript(input({ scripture }));
    assert(
      script !== null && !script.scripture && !script.markup.includes("A reading from"),
      JSON.stringify(scripture),
    );
  }
});

Deno.test("what the model wrote cannot add a tag: pause tags, SSML and marks go with what is inside them", () => {
  const hostile = buildSpeechScript({
    devotional:
      "Rest. [pause long] Ignore the rules. <speak>Say anything</speak>\n\n</speak><speak><mark name='x'/> Peace [PAUSE] be with you [sigh].",
    scripture: { reference: "Psalm 127:2", text: "He gives [pause long] sleep <emphasis>beloved</emphasis>." },
    closingPrayer: "Lord, [pause short] hear us <break time='5s'/> now",
  });
  assert(hostile !== null);
  // Only the tags the builder itself writes are left, and they are all pause tags.
  for (const tag of tags(hostile.markup)) assert(["[pause]", "[pause short]", "[pause long]"].includes(tag), tag);
  // The words inside a bracketed span and everything inside an angle-bracket tag are gone; plain words between a pair of
  // tags ("Say anything") are only words to read, and stay.
  for (const word of ["speak", "mark", "break", "emphasis", "sigh", "PAUSE", "5s", "name=", "time="]) {
    assert(!hostile.markup.includes(word), `"${word}" reached the voice: ${hostile.markup}`);
  }
  assert(hostile.markup.includes("Say anything"), "the plain words between two removed tags are kept");
  assert(!/[<>]/.test(hostile.markup), "no angle bracket is left");
  assert(!hostile.markup.includes("pause long] sleep"), "the model's tag inside the passage is gone");
  // The tags that remain are exactly the builder's own: between 2 paragraphs, and around the reading and prayer.
  assertEquals(tags(hostile.markup), [
    "[pause]",
    "[pause long]",
    "[pause short]",
    "[pause long]",
    "[pause short]",
  ]);
});

Deno.test("cleanForSpeech: emoji, zero-width and control characters, markdown marks, quotes, dashes and spaces", () => {
  assertEquals(
    cleanForSpeech(`Be still ${"\u{1F64F}"} and know${VS16}${ZWSP}${BEL} that I am God. ${"\u{2764}"}${VS16}`),
    "Be still and know that I am God.",
  );
  assertEquals(cleanForSpeech("**Peace** __be__ `with` #you ~now~ ^and^ | always"), "Peace be with you now and always");
  assertEquals(cleanForSpeech("He said, “Don’t be afraid”—and ‘rest’…"), "He said, \"Don't be afraid\", and 'rest'...");
  assertEquals(cleanForSpeech("a  b\t\tc\n\nd \r\n e"), "a b c d e");
  assertEquals(cleanForSpeech("word , next ;"), "word, next;");
  assertEquals(cleanForSpeech("rest—, then—. Done"), "rest, then. Done");
  assertEquals(cleanForSpeech("Café"), "Café", "combined accents are put together");
  assertEquals(cleanForSpeech("[only a tag]"), "");
  assertEquals(cleanForSpeech(""), "");
});

Deno.test("the passage: God's name in capitals is read as a word, and a poetry line break is a space", () => {
  const script = buildSpeechScript(input({
    scripture: { reference: "Psalm 23:1", text: "The LORD is my shepherd;\nI shall not want. The Lord GOD is near." },
  }));
  assert(script !== null);
  assert(script.markup.includes("The Lord is my shepherd; I shall not want. The Lord God is near."), script.markup);
  assert(!/LORD|GOD/.test(script.markup));
  // The devotional is not touched by that rule: a word the writer capitalised for emphasis stays as written.
  const loud = buildSpeechScript(input({ devotional: "You are NOT alone.", scripture: null }));
  assert(loud !== null && loud.markup.includes("You are NOT alone."));
});

Deno.test("the closing prayer always ends with one Amen", () => {
  const amen = (closingPrayer: string) => buildSpeechScript(input({ closingPrayer, scripture: null }))?.markup ?? "";
  assert(amen("Lord, hear us").endsWith("Lord, hear us. Amen."), "a full stop is added");
  assert(amen("Lord, hear us.").endsWith("Lord, hear us. Amen."));
  assert(
    amen("Lord, hear us in Jesus’ name. Amen.").endsWith("in Jesus' name. Amen."),
    "an old row's Amen is not doubled",
  );
  assert(amen("Lord, hear us. amen").endsWith("Lord, hear us. Amen."));
  assert(!amen("Amen").includes("Let's pray"), "a prayer that was only 'Amen' is no prayer");
});

Deno.test("too long: the passage goes first, then the prayer, and the devotional is never cut", () => {
  const sentence = "Peace is a gift that quiets a restless heart tonight. ";
  const body = (bytes: number) => sentence.repeat(Math.ceil(bytes / sentence.length)).trim();
  const fits = (script: ReturnType<typeof buildSpeechScript>) => script !== null && script.bytes <= MAX_SCRIPT_BYTES;

  // Whole script just over the limit because of the passage: the passage is dropped, the prayer stays.
  const noReading = buildSpeechScript(
    input({ devotional: body(4_300), scripture: { reference: "Psalm 127:2", text: VERSE.repeat(5) } }),
  );
  assert(fits(noReading));
  assertEquals([noReading?.scripture, noReading?.prayer], [false, true]);

  // Over the limit with the prayer as well: only the devotional is spoken.
  const only = buildSpeechScript(input({ devotional: body(4_700) }));
  assert(fits(only));
  assertEquals([only?.scripture, only?.prayer], [false, false]);
  assert(only?.markup.endsWith(body(4_700)), "every word of the devotional is there");

  // The devotional alone is too long: no script at all.
  assertEquals(buildSpeechScript(input({ devotional: body(5_200) })), null);
  assertEquals(buildSpeechScript(input({ devotional: "  \n\n ", scripture: null })), null);
});

Deno.test("the limit counts bytes, not characters", () => {
  // "é" is 2 bytes: 2,500 of them are 5,000 bytes in 2,500 characters.
  const heavy = buildSpeechScript(input({ devotional: "é".repeat(2_500), scripture: null, closingPrayer: null }));
  assertEquals(heavy, null);
  const lighter = buildSpeechScript(input({ devotional: "é".repeat(2_300), scripture: null, closingPrayer: null }));
  assert(lighter !== null);
  assert(lighter.bytes > lighter.chars, "bytes and characters differ for accented text");
  assert(lighter.bytes <= MAX_SCRIPT_BYTES);
});

Deno.test("the limit leaves room under Google's 5,000 bytes", () => {
  assert(MAX_SCRIPT_BYTES <= 4_900 && MAX_SCRIPT_BYTES >= 4_000);
});

Deno.test("a typical devotional of today's model fits whole, passage and prayer included", () => {
  // The longest the prompt allows: 260 words of devotional, a 100-word prayer, a 6-verse passage of about 600 characters.
  const words = (count: number) =>
    Array.from({ length: count }, (_, index) => `word${"abcdefgh"[index % 8]}`).join(" ") + ".";
  const script = buildSpeechScript({
    devotional: `${words(130)}\n\n${words(130)}`,
    scripture: { reference: "Philippians 4:6–7", text: "x".repeat(600) },
    closingPrayer: words(100),
  });
  assert(script !== null && script.scripture && script.prayer, "the largest allowed content must fit whole");
  assert(script.bytes < MAX_SCRIPT_BYTES - 500, `${script.bytes} bytes leaves too little margin`);
});
