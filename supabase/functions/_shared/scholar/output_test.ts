import { OutputInvalid } from "../../process-entry/output.ts";
import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import {
  hurtProblem,
  parseScholarReply,
  repeatedStock,
  repeatsEarlier,
  type ScholarAnswer,
  type ScholarParseContext,
  scholarStyle,
} from "./output.ts";

const MESSAGE = "My friend Adaeze is moving to Lagos and I feel lost without her.";

const everyday = (over: Partial<ScholarParseContext> = {}): ScholarParseContext => ({
  heavy: false,
  message: MESSAGE,
  askTitle: false,
  privateSource: MESSAGE,
  ...over,
});

const REPLY =
  "Losing someone close to a move is a real grief, and it makes sense that you feel unsteady.\n\nGod stays near when people we love move far away. Ruth knew what it was to start again somewhere new, and God was with her there.";

const PRAYER =
  "Lord, you are the God who stays near. I bring you this empty feeling. Give me peace tonight. Help me reach out to my friend. Show me the people you have put around me. You hold me and my friend in your care. I trust you with tomorrow.";

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    is_heavy: false,
    title: null,
    lead_passage: null,
    passage: null,
    reply: REPLY,
    prayer: null,
    ...over,
  });

// A reply of the heavy schema (scholar-v2): its one passage by key, no title and no free passage.
const heavyReply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    is_heavy: true,
    passage_key: "PSA_46_1",
    reply: REPLY,
    prayer: null,
    says_under_18: false,
    ...over,
  });

const heavyContext = (over: Partial<ScholarParseContext> = {}): ScholarParseContext =>
  everyday({ heavy: true, help: "crisis", plainNaming: null, earlier: [], ...over });

function invalid(text: string, context: ScholarParseContext, reason: string): OutputInvalid {
  try {
    parseScholarReply(text, context);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    return error;
  }
  throw new Error(`expected "${reason}" but the reply was accepted`);
}

Deno.test("a good reply is read, cleaned and kept whole: nothing is truncated", () => {
  const parsed = parseScholarReply(
    reply({
      reply: "**Losing** someone close   is hard.\n\n\n\nGod is near to you don't worry",
      passage: { book_id: "PSA", chapter: 34, verse_start: 18, verse_end: 18 },
    }),
    everyday(),
  );
  assert(parsed.kind === "answer");
  assertEquals(parsed.reply, "**Losing** someone close is hard.\n\nGod is near to you don’t worry.");
  assertEquals(parsed.passage, { bookId: "PSA", chapter: 34, verseStart: 18, verseEnd: 18 });
  assertEquals([parsed.leadPassage, parsed.prayer, parsed.title, parsed.isHeavy], [null, null, null, false]);
  // A code fence around the JSON is accepted.
  assertEquals(parseScholarReply("```json\n" + reply() + "\n```", everyday()).kind, "answer");
});

Deno.test("shape and lengths: anything out of range is asked for again with no note", () => {
  for (
    const [text, reason] of [
      ["not json", "json"],
      ["[]", "shape"],
      [JSON.stringify({ is_heavy: "no", reply: REPLY }), "is_heavy"],
      [reply({ reply: 5 }), "reply_missing"],
      [reply({ reply: "Too short." }), "reply_length"],
      [reply({ reply: "word ".repeat(261) }), "reply_length"],
      [reply({ prayer: "Lord, help." }), "prayer_length"],
      [reply({ prayer: "word ".repeat(101) }), "prayer_length"],
      [reply({ prayer: 7 }), "prayer_shape"],
    ] as const
  ) {
    const error = invalid(text, everyday(), reason);
    assertEquals(error.note, undefined, reason);
  }
});

Deno.test("a prayer is cleaned, loses its Amen and keeps its length; an empty one is none", () => {
  const parsed = parseScholarReply(reply({ prayer: `${PRAYER} Amen.` }), everyday());
  assert(parsed.kind === "answer");
  assertEquals(parsed.prayer, PRAYER);
  const none = parseScholarReply(reply({ prayer: "   " }), everyday());
  assert(none.kind === "answer" && none.prayer === null);
});

Deno.test("passages: a malformed one is left out, and a supporting passage equal to the lead one is dropped", () => {
  const same = { book_id: "JHN", chapter: 3, verse_start: 16, verse_end: 16 };
  const parsed = parseScholarReply(reply({ lead_passage: same, passage: same }), everyday());
  assert(parsed.kind === "answer");
  assertEquals(parsed.leadPassage, { bookId: "JHN", chapter: 3, verseStart: 16, verseEnd: 16 });
  assertEquals(parsed.passage, null);
  const bad = parseScholarReply(
    reply({ lead_passage: { book_id: "XYZ", chapter: 1, verse_start: 1, verse_end: 1 }, passage: "John 3:16" }),
    everyday(),
  );
  assert(bad.kind === "answer" && bad.leadPassage === null && bad.passage === null);
});

Deno.test("the title: kept only when asked, cleaned, and dropped when it is too long or holds a private word", () => {
  const asked = everyday({ askTitle: true });
  const kept = parseScholarReply(reply({ title: "Finding Peace After a Goodbye." }), asked);
  assert(kept.kind === "answer");
  assertEquals(kept.title, "Finding Peace After a Goodbye");
  const unasked = parseScholarReply(reply({ title: "Finding Peace After a Goodbye" }), everyday());
  assert(unasked.kind === "answer" && unasked.title === null);
  for (
    const title of [
      "Adaeze Moves Away",
      "A Friend in Lagos",
      "Peace",
      "One Two Three Four Five Six Seven",
      "x".repeat(61),
    ]
  ) {
    const dropped = parseScholarReply(reply({ title }), asked);
    assert(dropped.kind === "answer" && dropped.title === null, title);
  }
});

Deno.test("the reflection's never-say list is a hard check on the reply and the prayer, with a note", () => {
  const error = invalid(reply({ reply: `${REPLY} Everything happens for a reason.` }), everyday(), "never_say:reason");
  assert(error.note !== undefined && error.note.includes("Write the whole reply again"));
  invalid(reply({ prayer: `${PRAYER} Everything happens for a reason.` }), everyday(), "never_say:reason");
});

Deno.test("an everyday reply may echo one short run of the newest message, and nothing else in quotation marks", () => {
  const echo = parseScholarReply(
    reply({ reply: `When you say “I feel lost without her” I hear real love.\n\n${REPLY}` }),
    everyday(),
  );
  assertEquals(echo.kind, "answer");
  const error = invalid(
    reply({ reply: `${REPLY} “The Lord is close to the brokenhearted.”` }),
    everyday(),
    "echo_invented",
  );
  assert(error.note !== undefined);
  // An echo too long, or two, is refused too.
  invalid(
    reply({ reply: `“My friend Adaeze is moving to Lagos and I feel lost” is hard.\n\n${REPLY}` }),
    everyday(),
    "echo_invented",
  );
});

Deno.test("the everyday writer's own flag: the reply is not checked further, because it is discarded", () => {
  const flagged = parseScholarReply(
    JSON.stringify({ is_heavy: true, title: null, lead_passage: null, passage: null, reply: "x", prayer: null }),
    everyday(),
  );
  assertEquals(flagged, { kind: "flagged" });
});

Deno.test("a heavy reply quotes nothing and says nothing of the heavy list; each is asked again with a note", () => {
  const heavy = everyday({ heavy: true });
  const fine = parseScholarReply(reply({ is_heavy: true }), heavy);
  assert(fine.kind === "answer" && fine.isHeavy);
  // The heavy writer's reply is used even when it does not flag itself.
  const unflagged = parseScholarReply(reply({ is_heavy: false }), heavy);
  assert(unflagged.kind === "answer");
  const quoted = invalid(
    reply({ reply: `When you said “I feel lost without her” I listened.\n\n${REPLY}` }),
    heavy,
    "heavy_quote",
  );
  assert(quoted.note !== undefined && quoted.note.includes("A heavy moment"));
  invalid(reply({ prayer: `${PRAYER} “Lost.”` }), heavy, "heavy_quote");
  const said = invalid(reply({ reply: `${REPLY} Dying is never the answer.` }), heavy, "heavy_never_say:dying");
  assert(said.note !== undefined);
});

Deno.test("scholar-v2: a heavy reply names its one passage by key, and has no other passage and no title", () => {
  const parsed = parseScholarReply(
    heavyReply({
      title: "Held In The Night",
      lead_passage: { book_id: "JHN", chapter: 3, verse_start: 16, verse_end: 16 },
      passage: { book_id: "PSA", chapter: 34, verse_start: 18, verse_end: 18 },
    }),
    heavyContext({ askTitle: true }),
  );
  assert(parsed.kind === "answer");
  assertEquals(
    [parsed.passageKey, parsed.leadPassage, parsed.passage, parsed.title, parsed.isHeavy],
    ["PSA_46_1", null, null, null, true],
  );
  for (const key of ["none", "ISA_99_1", 7, null, "psa_46_1"]) {
    const other = parseScholarReply(heavyReply({ passage_key: key }), heavyContext());
    assert(other.kind === "answer" && other.passageKey === null, String(key));
  }
  // An everyday reply never carries a key, whatever it writes.
  const everydayAnswer = parseScholarReply(reply({ passage_key: "PSA_46_1" }), everyday());
  assert(everydayAnswer.kind === "answer" && everydayAnswer.passageKey === null);
});

Deno.test("scholar-v2: says_under_18 is read in both schemas, and only true is true", () => {
  const read = (text: string, context: ScholarParseContext) => {
    const parsed = parseScholarReply(text, context);
    assert(parsed.kind === "answer");
    return parsed.saysUnder18;
  };
  assertEquals(read(reply({ says_under_18: true }), everyday()), true);
  assertEquals(read(heavyReply({ says_under_18: true }), heavyContext()), true);
  for (const value of [false, "yes", 1, null, undefined]) {
    assertEquals(read(reply({ says_under_18: value }), everyday()), false, String(value));
  }
  assertEquals(read(reply(), everyday()), false);
});

const NAMING_ONCE = `${REPLY}\n\nI am so sorry you have had thoughts of ending your life.`;

Deno.test("scholar-v2: plain naming only as the block allows, once, never more directly, never in the prayer", () => {
  // Not allowed: it is named only in general words.
  const named = invalid(heavyReply({ reply: NAMING_ONCE }), heavyContext(), "heavy_naming");
  assert(
    named.note !== undefined && named.note.includes("<heavy_moment> block") && named.note.includes("A heavy moment"),
  );
  // Allowed once as "thoughts of ending your life" when the person wrote it that plainly.
  const allowed = parseScholarReply(heavyReply({ reply: NAMING_ONCE }), heavyContext({ plainNaming: "life" }));
  assert(allowed.kind === "answer");
  // Twice is once too many, and another way of naming it is more direct than the block allows.
  invalid(
    heavyReply({ reply: `${NAMING_ONCE} Thoughts of ending your life do not have the last word.` }),
    heavyContext({ plainNaming: "life" }),
    "heavy_naming",
  );
  invalid(
    heavyReply({ reply: `${REPLY}\n\nI am so sorry you have thought of taking your own life.` }),
    heavyContext({ plainNaming: "life" }),
    "heavy_naming",
  );
  // Never in the prayer, even when the reply may name it.
  invalid(
    heavyReply({ prayer: `${PRAYER} Hold me in these thoughts of ending my life.` }),
    heavyContext({ plainNaming: "life" }),
    "heavy_naming",
  );
  // The word itself: refused by the heavy list unless the person used it, then allowed once.
  const SUICIDE_ONCE = `${REPLY}\n\nI am so sorry you have had thoughts of suicide.`;
  const plain = invalid(heavyReply({ reply: SUICIDE_ONCE }), heavyContext(), "heavy_never_say:dying");
  assert(plain.note !== undefined && !plain.note.includes("<heavy_moment> block"));
  assert(
    parseScholarReply(heavyReply({ reply: SUICIDE_ONCE }), heavyContext({ plainNaming: "suicide" })).kind === "answer",
  );
  const twice = invalid(
    heavyReply({ reply: `${SUICIDE_ONCE} Thoughts of suicide can feel loud at night.` }),
    heavyContext({ plainNaming: "suicide" }),
    "heavy_never_say:dying",
  );
  assert(
    twice.note !== undefined && twice.note.includes("<heavy_moment> block"),
    "the note says what the block allows",
  );
  // "life" never allows the word itself.
  invalid(heavyReply({ reply: SUICIDE_ONCE }), heavyContext({ plainNaming: "life" }), "heavy_never_say:dying");
});

Deno.test("scholar-v2: to someone being hurt, no instruction to leave, stay or act at a set time, and never not to be afraid", () => {
  const abuse = heavyContext({ help: "abuse" });
  const told = invalid(heavyReply({ reply: `${REPLY} You should leave tonight.` }), abuse, "hurt_instruction");
  assert(told.note !== undefined && told.note.includes("advocates") && told.note.includes("A heavy moment"));
  invalid(heavyReply({ reply: `${REPLY} Please stay with him for now.` }), abuse, "hurt_instruction");
  invalid(heavyReply({ reply: `${REPLY} You could go before he comes home.` }), abuse, "hurt_instruction");
  invalid(heavyReply({ reply: `${REPLY}\n\nLeave when you can.` }), abuse, "hurt_instruction");
  const fear = invalid(heavyReply({ reply: `${REPLY} Do not be afraid.` }), abuse, "hurt_not_afraid");
  assert(fear.note !== undefined && fear.note.includes("fear"));
  invalid(heavyReply({ prayer: `${PRAYER} Let me never be afraid.` }), abuse, "hurt_not_afraid");
  // Staying safe, close or connected is not an instruction to stay with anyone, and "God stays near" is no instruction.
  const safe = parseScholarReply(
    heavyReply({ reply: `${REPLY} Stay safe, and stay close to the people who care for you.` }),
    abuse,
  );
  assert(safe.kind === "answer");
  // These checks are for a person someone is hurting: the same words in another heavy moment are not refused by them.
  assert(parseScholarReply(heavyReply({ reply: `${REPLY} Do not be afraid.` }), heavyContext()).kind === "answer");
  assertEquals(hurtProblem(["You are not alone, and your fear makes sense."]), null);
  assertEquals(hurtProblem(["Fear not."]), "hurt_not_afraid");
  assertEquals(hurtProblem(["Try to return to your mother’s house."]), "hurt_instruction");
});

Deno.test("scholar-v2: a stock phrase said twice, a run of six words said before, and a length out of range are asked again and kept", () => {
  const salvage = (error: OutputInvalid) => {
    const kept = error.salvage as ({ kind: "answer" } & ScholarAnswer) | undefined;
    assert(kept !== undefined && kept.kind === "answer", "a soft check keeps the reply");
    return kept;
  };
  const stockEarlier = ["Thank you for telling me. This is not the end of your story, and God is near."];
  const stock = invalid(
    heavyReply({ reply: `${REPLY} This is not the end of your story.` }),
    heavyContext({ earlier: stockEarlier }),
    "heavy_stock",
  );
  assert(stock.note !== undefined && stock.note.includes("fresh"));
  assert(salvage(stock).reply.endsWith("This is not the end of your story."));
  // Once in the whole conversation is allowed.
  assert(
    parseScholarReply(heavyReply({ reply: `${REPLY} This is not the end of your story.` }), heavyContext()).kind ===
      "answer",
  );
  assertEquals(repeatedStock("I’m glad you told me.", ["I am glad you wrote."]), "glad you");
  assertEquals(repeatedStock("I’m glad you told me.", []), null);
  // The help line’s own first sentence, said in an earlier answer or by a written one, is not said again.
  assertEquals(
    repeatedStock("You do not have to carry this alone tonight.", ["Please don’t carry this alone today."]),
    "carry this alone",
  );

  const repeat = invalid(
    heavyReply(),
    heavyContext({ earlier: ["Ruth knew what it was to start again in a new land."] }),
    "heavy_repeat",
  );
  assert(repeat.note !== undefined && repeat.note.includes("more briefly"));
  assertEquals(salvage(repeat).reply, REPLY);
  // Pointing to the help line in the same words is no repeat.
  assertEquals(
    repeatsEarlier(
      "You can call or text the line under this message at any hour.",
      ["Please call or text the line under this message today."],
    ),
    false,
  );
  // Nor is naming the help line, by its name or its number, as the heavy_moment block names it.
  assertEquals(
    repeatsEarlier(
      "Please reach out to the 988 Lifeline right below this message tonight.",
      ["You could reach out to the 988 Lifeline right below whenever you are ready."],
    ),
    false,
  );
  assertEquals(
    repeatsEarlier(
      "The advocates at the National Domestic Violence Hotline can help you plan.",
      ["The advocates at the National Domestic Violence Hotline know this well."],
    ),
    false,
  );
  assertEquals(repeatsEarlier("He is near to you in the dark tonight.", ["God is near to you in the dark."]), true);

  const short =
    "God is with you in this moment, and he is not letting go of you. Please tell one person you trust today.";
  const shortError = invalid(heavyReply({ reply: short }), heavyContext(), "heavy_length");
  assert(shortError.note !== undefined && shortError.note.includes("50 to 110"));
  assertEquals(salvage(shortError).reply, short);
  invalid(heavyReply({ reply: [REPLY, REPLY, REPLY].join("\n\n") }), heavyContext(), "heavy_length");
  // An everyday reply is not held to the heavy soft checks.
  assert(
    parseScholarReply(
      reply({ reply: `${REPLY} This is not the end of your story.` }),
      everyday({ earlier: stockEarlier }),
    ).kind === "answer",
  );
});

Deno.test("a correction note names the rule and never a word of the person's", () => {
  const words = ["Adaeze", "Lagos", "lost without her"];
  const notes = [
    invalid(heavyReply({ reply: NAMING_ONCE }), heavyContext(), "heavy_naming").note,
    invalid(
      heavyReply({ reply: `${REPLY} You should leave tonight.` }),
      heavyContext({ help: "abuse" }),
      "hurt_instruction",
    )
      .note,
    invalid(heavyReply({ reply: `${REPLY} Do not be afraid.` }), heavyContext({ help: "abuse" }), "hurt_not_afraid")
      .note,
    invalid(
      heavyReply({ reply: `${REPLY} This is not the end of your story.` }),
      heavyContext({ earlier: ["This is not the end of your story."] }),
      "heavy_stock",
    ).note,
    invalid(heavyReply(), heavyContext({ earlier: ["Ruth knew what it was to start again."] }), "heavy_repeat").note,
    invalid(
      heavyReply({ reply: "God is near to you, and he holds you through this night. Tell one person today." }),
      heavyContext(),
      "heavy_length",
    )
      .note,
    invalid(reply({ reply: `${REPLY} Everything happens for a reason.` }), everyday(), "never_say:reason").note,
    invalid(reply({ reply: `${REPLY} “Adaeze and Lagos forever, my lost friend.”` }), everyday(), "echo_invented").note,
    invalid(
      reply({ reply: `When you said “I feel lost without her” I listened.\n\n${REPLY}` }),
      everyday({ heavy: true }),
      "heavy_quote",
    )
      .note,
  ];
  for (const note of notes) {
    assert(note !== undefined);
    for (const word of words) assert(!note.toLowerCase().includes(word.toLowerCase()), `${word} in ${note}`);
  }
});

Deno.test("style measures, never a refusal: the prayer's voice, its petitions and the word counts", () => {
  const parsed = parseScholarReply(reply({ prayer: PRAYER }), everyday());
  assert(parsed.kind === "answer");
  const style = scholarStyle(parsed, MESSAGE);
  assertEquals(style.prayerVoice, "i");
  assert((style.prayerPetitions ?? 0) >= 2, `${style.prayerPetitions}`);
  assert(style.replyWords > 30 && (style.prayerWords ?? 0) > 40, JSON.stringify(style));
  const none = parseScholarReply(reply(), everyday());
  assert(none.kind === "answer");
  assertEquals(scholarStyle(none, MESSAGE).prayerVoice, null);
});
