import { assert, assertEquals } from "./testing/assert.ts";
import { readyOutput, TEXT } from "./testing/fakes.ts";
import { heavyFallback } from "./heavy.ts";
import { checkTone, readReflection, type ReadyReflection } from "./output.ts";
import { buildSystemInstruction } from "./prompt.ts";
import {
  avoidedWords,
  PLAIN_AVOID_WORDS,
  PLAIN_RETRY_GRADE,
  PLAINER_WORDS,
  plainSpeechProblem,
  readingGrade,
  SAFE_HEADLINES,
  SAFE_TITLE,
  styleMeasures,
  syllables,
  TIME_WORDS,
  timeOfDayProblem,
  timeWords,
  type ToneReflection,
} from "./tone.ts";

// gen-v2.7 (2026-11-23): plain speech and any hour of the day. The rules of tone.ts are exact (the evaluation's bars and the
// incident's numbers depend on them); these fixtures pin them.

const round = (value: number) => Math.round(value * 100) / 100;

// The project lead's own example of how a friend talks (the register, never a template).
const LEAD =
  "Going through life all by yourself can be challenging. Sometimes you sit down and you wonder why life pulls you backward. And sometimes you look at your friends going forward, seeing that they've gone many steps ahead of you, and it seems like you are moving backwards.";
// The plain sample of the step (never in the instruction).
const SAMPLE =
  "You keep looking at your friends, and it feels like they're all moving ahead of you. Some days you sit down and wonder why your life feels stuck. That hurts, and it's okay to say so. God knows exactly where you are today. He hasn't left you behind, and he isn't comparing you to anyone. Tell him one thing you're scared about. He's listening.";
// gen-v2.6's grief-pet opening (saved from a made-up entry).
const GRIEF =
  "Fourteen years of loyalty leave an enormous silence behind by the front door.\n\nYou keep expecting to hear familiar steps, and every quiet corner reminds you of what is missing. It never feels foolish to mourn something that gave you uncomplicated devotion for over a decade. Grief is simply the echo of genuine love.";

Deno.test("plain speech: syllables by a consistent rule of thumb, and the reading grade of the fixtures", () => {
  const expected: [string, number][] = [
    ["God", 1],
    ["people", 2],
    ["beautiful", 3],
    ["faithfulness", 3],
    ["everything", 4],
    ["doesn’t", 1],
    ["wanted", 2],
    ["needed", 2],
    ["lived", 1],
    ["hoped", 1],
    ["themselves", 2],
    ["steadfast", 2],
  ];
  for (const [word, count] of expected) assertEquals(syllables(word), count, word);
  assertEquals(round(readingGrade(LEAD)), 5.83);
  assertEquals(round(readingGrade(SAMPLE)), 2.54);
  assertEquals(round(readingGrade(heavyFallback().devotional)), 2.96);
  assertEquals(round(readingGrade(GRIEF)), 8.03);
  assertEquals(readingGrade(""), 0);
  assertEquals(PLAIN_RETRY_GRADE, 7);
});

Deno.test("avoidedWords: whole words of the list, each once in the order first seen, never the echo or the entry's own", () => {
  assertEquals(avoidedWords(["", "His love is steadfast and near.", ""], "I am tired."), ["steadfast"]);
  assertEquals(avoidedWords(["You wrote “steadfast and true” and you meant it."], "I am tired."), []);
  assertEquals(avoidedWords(['You wrote "steadfast and true" and you meant it.'], "I am tired."), []);
  assertEquals(avoidedWords(["His love is steadfast."], "I want a steadfast heart."), []);
  assertEquals(avoidedWords(["We sat in the gazebo and talked about sustainable farming."], ""), []);
  assertEquals(avoidedWords(["Linger here. Steadfast love.", "You linger, and solace comes."], ""), [
    "linger",
    "steadfast",
    "solace",
  ]);
});

const spoken = (devotional: string, closingPrayer = "Lord, help me today and stay with me.") => ({
  validationLine: "Your friends seem to be moving ahead, and you feel stuck.",
  devotional,
  closingPrayer,
});

Deno.test("plainSpeechProblem: the lead's example and the plain sample pass; a list word or a hard devotional is asked again", () => {
  assertEquals(plainSpeechProblem(spoken(LEAD), ""), null);
  assertEquals(plainSpeechProblem(spoken(SAMPLE), ""), null);
  const word = plainSpeechProblem(spoken(`${SAMPLE} His love is steadfast.`), "");
  assertEquals([word?.reason, word?.salvaged], ["plain_speech", "plain_speech"]);
  assertEquals(
    word?.note,
    'Your last reply did not sound like a caring friend talking. It used words people don’t say out loud: “steadfast”. Write the whole reply again in the plain words of "Voice": everyday words a nine-year-old knows, short sentences with one idea each, and a contraction every time a person would say one.',
  );
  // A devotional graded over 7 with no word of the list (8.03).
  assertEquals(avoidedWords([GRIEF], ""), []);
  const hard = plainSpeechProblem(spoken(GRIEF), "");
  assertEquals(hard?.reason, "plain_speech");
  assert(hard?.note.includes("Its devotional reads at a harder level than asked."), hard?.note);
  assert(!hard?.note.includes("It used words"), hard?.note);
  // The line and the prayer are scanned too.
  assertEquals(
    plainSpeechProblem({ ...spoken(SAMPLE), validationLine: "Your heart yearns for rest." }, "")?.reason,
    "plain_speech",
  );
  assertEquals(
    plainSpeechProblem(spoken(SAMPLE, "Lord, be my refuge and my solace today."), "")?.reason,
    "plain_speech",
  );
});

Deno.test("plainSpeechProblem: the note names at most eight words of the list, never a word of the entry", () => {
  const entry = "Please pray for my sister Blessing in Ibadan. She is lonely and her landlord is angry.";
  const many = `${SAMPLE} Abide amid the anchor, anguish, beacon, behold, beloved, boundless and bountiful days.`;
  const note = plainSpeechProblem(spoken(many), entry)?.note ?? "";
  assert(
    note.includes(
      "out loud: “abide”, “amid”, “anchor”, “anguish”, “beacon”, “behold”, “beloved”, “boundless”. Write",
    ),
    note,
  );
  assert(!note.includes("bountiful"), "at most eight");
  for (const word of ["blessing", "ibadan", "sister", "lonely", "landlord", "angry"]) {
    assert(!note.toLowerCase().includes(word), `the note holds the entry's "${word}"`);
  }
});

Deno.test("timeWords: parts of the day, sleep and waking, never the echo, the entry's own, today or now", () => {
  assertEquals(timeWords(["Rest with him tonight."], ""), ["tonight"]);
  assertEquals(timeWords(["Tonight’s quiet is his."], ""), ["tonight"]);
  assertEquals(timeWords(["As you start your day, he is near."], ""), ["start your day"]);
  assertEquals(timeWords(["You wrote “every night I cry” and he heard it."], ""), []);
  assertEquals(timeWords(["After the night shift you are tired."], "I just got off the night shift."), []);
  assertEquals(timeWords(["You couldn’t sleep, and he stayed."], "I couldn’t sleep at all."), []);
  assertEquals(timeWords(["Today and right now, he is with you."], ""), []);
  assertEquals(timeWords(["The knight stood on bedrock, and the awaken word."], ""), []);
  // In the order first seen, each once, across the texts.
  assertEquals(timeWords(["This morning, and again tonight.", "Sleep well tonight."], ""), [
    "morning",
    "tonight",
    "sleep",
  ]);
  // A phrase is set aside when the entry holds the same phrase.
  assertEquals(timeWords(["At the end of the day, he stays."], "At the end of the day I am spent."), []);
});

const affirmations = (headline: string, text: string) => [
  { headline, text },
  { headline: "Your needs are known to him", text: "Whatever you face, he knows what you need and stays with you." },
  { headline: "He keeps watch over you", text: "Right where you are, he holds you and he does not let go." },
];

Deno.test("timeOfDayProblem: the line, the devotional, the prayer, the headlines and the texts; the fallback passes", () => {
  const plain = { ...spoken(SAMPLE), affirmations: affirmations("God goes ahead of you", "He is with you today.") };
  assertEquals(timeOfDayProblem(plain, ""), null);
  const devotional = timeOfDayProblem({ ...plain, devotional: `${SAMPLE} Tonight, tell God one thing.` }, "");
  assertEquals([devotional?.reason, devotional?.salvaged], ["time_of_day", "time_of_day"]);
  assertEquals(
    devotional?.note,
    'Your last reply named a part of the day (“tonight”), but the person may hear or read it at any hour. Write the whole reply again so that nothing in it depends on the time of day, as "Any hour of the day" asks: say "today" or "right now", or say nothing about time.',
  );
  const headline = timeOfDayProblem({
    ...plain,
    affirmations: affirmations("Safety surrounds your night", "He stays."),
  }, "");
  assertEquals(headline?.reason, "time_of_day");
  const text = timeOfDayProblem(
    { ...plain, affirmations: affirmations("God goes ahead of you", "He met you this morning.") },
    "",
  );
  assert(text?.note.includes("(“morning”)"), text?.note);
  // Decision 22's fallback fits any hour.
  assertEquals(timeOfDayProblem(heavyFallback(), ""), null);
  // The note names only what the model wrote, never a word of the entry.
  const entry = "My son Tunde starts at the Lagos office on Monday and I keep worrying all evening.";
  const note = timeOfDayProblem({ ...plain, devotional: `${SAMPLE} Rest tonight.` }, entry)?.note ?? "";
  for (const word of ["tunde", "lagos", "office", "monday", "worrying", "evening"]) {
    assert(!note.toLowerCase().includes(word), `the note holds the entry's "${word}"`);
  }
});

Deno.test("the two word lists: what a friend never needs, and what is only measured", () => {
  assertEquals(PLAIN_AVOID_WORDS.size, 107);
  assertEquals(PLAINER_WORDS.size, 29);
  for (const word of [...PLAIN_AVOID_WORDS, ...PLAINER_WORDS]) assert(/^[a-z]+$/.test(word), word);
  for (const word of PLAINER_WORDS) assert(!PLAIN_AVOID_WORDS.has(word), `${word} is in both lists`);
  // No word of the faith is ever refused or counted.
  const FAITH_WORDS = (
    "god lord jesus christ holy spirit grace mercy faith pray prayer prayed hope love peace heaven forgive forgiven church " +
    "bible amen savior father gospel cross"
  ).split(" ");
  for (const word of FAITH_WORDS) {
    assert(!PLAIN_AVOID_WORDS.has(word), `${word} is a word of the faith`);
    assert(!PLAINER_WORDS.has(word) || word === "mercy", `${word} is a word of the faith`);
  }
  // No fixed text holds a word the check refuses: the written fallback, the safe texts and the line's example.
  const fallback = heavyFallback();
  const example = buildSystemInstruction().match(/such as "(Your son’s surgery[^"]*)"/)?.[1] ?? "";
  assert(example.startsWith("Your son’s surgery is Thursday"), example);
  const fixed = [
    fallback.title,
    fallback.validationLine ?? "",
    fallback.devotional,
    fallback.closingPrayer,
    ...fallback.affirmations.flatMap((item) => [item.headline, item.text]),
    SAFE_TITLE,
    ...Object.values(SAFE_HEADLINES),
    example,
  ];
  assertEquals(avoidedWords(fixed, ""), []);
  assertEquals(TIME_WORDS.size, 31);
});

const measured: ToneReflection = {
  title: "A Steadfast Friend",
  validationLine: "Your week was long, and you feel it tonight.",
  devotional:
    "God’s love doesn’t quit. It’s here, you’re not alone, and I’m sure of it. Let’s pray. He does not leave. You wrote “steadfast and true” once. His mercy is not just kind, but close.",
  closingPrayer: "Lord, I cannot see the way. Help me rest in your mercy.",
  affirmations: [
    {
      slot: "morning",
      headline: "Solace meets you",
      text: "Know that he is near you in the morning and all day long.",
    },
    {
      slot: "afternoon",
      headline: "He holds you",
      text: "He is with you right here, and his love for you does not change.",
    },
    {
      slot: "evening",
      headline: "His care stays",
      text: "Whatever today held, he holds you now, and his care for you stays.",
    },
  ],
};

Deno.test("style measures of gen-v2.7: counted, never a reason to refuse", () => {
  const style = styleMeasures(measured, "");
  assertEquals(style.readingGrade, readingGrade(measured.devotional));
  assertEquals(style.prayerGrade, readingGrade(measured.closingPrayer));
  assertEquals(style.wordsPerSentence, 46 / 8, "46 words in 8 sentences, the devotional and the prayer together");
  assertEquals(style.avoidWords, 0, "the echo's “steadfast” is the person's");
  assertEquals(style.avoidWordsElsewhere, 2, "steadfast in the title, solace in a headline");
  assertEquals(style.plainerWords, 2, "mercy twice");
  assertEquals(style.contractions, 5, "doesn’t, It’s, you’re, I’m and Let’s; never God’s");
  assertEquals(style.uncontracted, 2, "does not and is not; cannot is in the prayer");
  assertEquals(style.contrastFrames, 1, "not just");
  assertEquals(style.timeWords, 2, "tonight in the line, morning in a text");
  // The entry's own words are set aside.
  assertEquals(styleMeasures(measured, "I lie awake every night and every morning.").timeWords, 1);
});

// ---- checkTone: the two soft checks in their place ----------------------------------------------------------------------

const reply = (over: Record<string, unknown> = {}): ReadyReflection =>
  readReflection(JSON.stringify(readyOutput(over)));
const withSentence = (sentence: string) =>
  String(readyOutput().devotional_text).replace("About rest", `${sentence} About rest`);

Deno.test("checkTone: a plain-speech fault or a time-of-day fault is asked for again, and the reply is kept as it was", () => {
  assertEquals(checkTone(reply(), TEXT), null, "the shared fixture is plain and fits any hour");
  const wordy = reply({ devotional_text: withSentence("His love is steadfast.") });
  const plain = checkTone(wordy, TEXT);
  assertEquals(plain?.reason, "plain_speech");
  assertEquals(plain?.salvage, { ...wordy, salvaged: "plain_speech" });
  const timed = reply({ devotional_text: withSentence("Rest with him tonight.") });
  const time = checkTone(timed, TEXT);
  assertEquals(time?.reason, "time_of_day");
  assertEquals(time?.salvage, { ...timed, salvaged: "time_of_day" });
});

Deno.test("checkTone: both faults are plain speech first with both notes; a private title comes before them; off for an old version", () => {
  const both = reply({ devotional_text: withSentence("His love is steadfast. Rest with him tonight.") });
  const error = checkTone(both, TEXT);
  assertEquals(error?.reason, "plain_speech");
  assert(error?.note?.includes("did not sound like a caring friend talking"), error?.note);
  assert(error?.note?.includes("named a part of the day (“tonight”)"), error?.note);
  assertEquals((error?.salvage as ReadyReflection).salvaged, "plain_speech");
  // A word of the entry in the title is the first fault, and the one retry carries every note.
  const entry = `${TEXT} My friend Ada keeps checking on me.`;
  const titled = checkTone({ ...both, title: "Peace for Ada" }, entry);
  assertEquals(titled?.reason, "title_private");
  for (const part of ["used a word from the entry in the title", "caring friend talking", "named a part of the day"]) {
    assert(titled?.note?.includes(part), part);
  }
  // gen-v2.6 and older are read with their own rules: neither check runs.
  assertEquals(checkTone(both, TEXT, [], [], { gen27Checks: false }), null);
});
