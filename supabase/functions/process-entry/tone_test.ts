import { assert, assertEquals } from "./testing/assert.ts";
import {
  correctionNote,
  estimatedSeconds,
  firstNeverSay,
  firstWord,
  hasStockOpening,
  hasVerseReference,
  HOOK_MAX_WORDS,
  leakedWords,
  leaksPrivate,
  NEVER_SAY,
  openingSentence,
  openingStart,
  privateWords,
  SAFE_HEADLINES,
  SAFE_TITLE,
  salvageReflection,
  SCRIPT_CHARS_PER_SECOND,
  styleMeasures,
  TONE_EXAMPLE,
  type ToneReflection,
} from "./tone.ts";

Deno.test("never say: each phrase is caught, with straight and curly apostrophes and in any case", () => {
  const caught: [string, string][] = [
    ["reason", "Everything happens for a reason, even this."],
    ["reason", "Remember that things happen for a reason."],
    ["reason", "It happened for a reason."],
    ["handle", "God won’t give you more than you can handle."],
    ["handle", "God won't give you more than you can bear."],
    ["handle", "He will not give you more than you can handle."],
    ["handle", "God doesn’t give us more than we can bear."],
    ["handle", "GOD NEVER GIVES US MORE THAN WE CAN HANDLE."],
    ["just_believe", "Just pray and it will pass."],
    ["just_believe", "All you need to do is just trust him."],
    ["just_believe", "Just have faith."],
    ["just_believe", "If you just believe, it will change."],
    ["just_believe", "Keep just praying about it."],
    ["angel", "Heaven needed another angel."],
    ["angel", "God called them home because their work was done."],
    ["angel", "He took her home so that she could rest."],
    ["work_out", "Everything will work out in the end."],
    ["work_out", "It all will be okay."],
    ["work_out", "Everything is going to be fine."],
    ["work_out", "It will all work out."],
    ["work_out", "Everything’ll be alright."],
    ["punishment", "This is a punishment for what you did."],
    ["punishment", "Maybe you are being punished for the past."],
    ["punishment", "God is punishing you."],
  ];
  for (const [id, text] of caught) assertEquals(firstNeverSay(text), id, text);
});

Deno.test("never say: near misses pass, and so does a sentence that denies the phrase", () => {
  const fine = [
    "At least I tried.",
    "There is a reason to hope.",
    "This is more than you can handle right now, and that is okay.",
    "God will give you rest, even when it’s more than you can handle.",
    "You can pray one simple sentence.",
    "Trust grows slowly, one day at a time.",
    "I won’t pretend that everything will be okay.",
    "No one can promise you that everything will work out.",
    "This is not a punishment for anything you did.",
    "You are not being punished for your grief.",
    "It isn’t a punishment.",
    "Your work matters, and it is okay to rest.",
    "The angel told Mary not to be afraid.",
    "You can bring him everything, just as you are.",
  ];
  for (const text of fine) assertEquals(firstNeverSay(text), null, text);
  // A denial covers only its own sentence: the phrase said again afterwards is still caught.
  assertEquals(firstNeverSay("I won’t say everything will be okay. But everything will be okay."), "work_out");
  // The list has the six phrases, each with the words a correction note quotes.
  assertEquals(NEVER_SAY.map((item) => item.id), [
    "reason",
    "handle",
    "just_believe",
    "angel",
    "work_out",
    "punishment",
  ]);
  for (const item of NEVER_SAY) assert(item.label.length > 0 && !item.label.includes("'"), item.id);
});

Deno.test("verse references: a book with a number, or words that point to a passage", () => {
  const references = [
    "Psalm 23 says it well.",
    "Psalms 46 is a comfort.",
    "Read 1 Peter 5:7 tonight.",
    "As Philippians 4 reminds us, we can bring everything.",
    "Song of Solomon 2 is about love.",
    "The psalmist knew this kind of night.",
    "This verse reminds you that you are held.",
    "Today’s passage speaks of rest.",
    "Scripture says you are loved.",
    "The Bible says he is near.",
    "It is written that he will never leave you.",
    "In the book of Job we see a man who wept.",
    "Read verse 7 again.",
  ];
  for (const text of references) assert(hasVerseReference(text), text);
  const fine = [
    "Mark called me yesterday.",
    "Your job is hard right now.",
    "Small acts of kindness matter.",
    "Pray a psalm of thanks.",
    "The passage of time can feel slow.",
    "John and Mark came to visit.",
    "In two weeks you will know more.",
    "Grace and peace to you.",
    "Job loss is hard.",
  ];
  for (const text of fine) assert(!hasVerseReference(text), text);
});

Deno.test("private words: the words the person capitalized in the middle of a sentence", () => {
  assertEquals(privateWords("Please pray for my sister Blessing. She moved to Ibadan last month."), [
    "blessing",
    "ibadan",
  ]);
  // A name that only starts a sentence is not caught (a known limit), and the allow list is never private.
  assertEquals(
    privateWords("Grace is unwell. I asked God and Jesus on Sunday in March to help My family, Lord."),
    [],
  );
  // Possessives and contractions, with curly and straight apostrophes.
  assertEquals(privateWords("I miss Blessing’s laugh and Tunde's jokes. I’m tired and I've cried."), [
    "blessing",
    "tunde",
  ]);
  // A title before a name does not make the name start a sentence, and the title itself is not private.
  assertEquals(privateWords("I saw Dr. Okafor today and then Mrs. Bello."), ["okafor", "bello"]);
  // Function words are never private, even capitalized: a book or a show is not a reason to refuse "the".
  assertEquals(privateWords("I watched The Chosen last night and it was So good."), ["chosen"]);
  // A word in capitals for emphasis is private only when it is not a common word.
  assertEquals(privateWords("I am SO tired and EXHAUSTED."), ["exhausted"]);
  // After a line break, an ellipsis or a question a word starts a sentence; after a comma or a colon it does not.
  assertEquals(privateWords("Thank you\nGrace came by… Later she left? Then, Kemi called: Lagos again."), [
    "kemi",
    "lagos",
  ]);
  // A hyphenated name gives the whole name and its parts; each word once, in the order first seen.
  assertEquals(privateWords("I met Mary-Jane and Mary-Jane again."), ["mary-jane", "mary", "jane"]);
  // Single letters are never private.
  assertEquals(privateWords("I went to see A and B."), []);
});

Deno.test("leaks: a private word counts as a whole word, in any case, possessive or not", () => {
  assert(leaksPrivate("You are a blessing", ["blessing"]));
  assert(leaksPrivate("BLESSING TODAY", ["blessing"]));
  assert(leaksPrivate("Blessing’s day", ["blessing"]));
  assert(leaksPrivate("For Mary-Jane", ["mary-jane"]));
  assert(leaksPrivate("O'Brien is here", ["o’brien"]));
  assert(!leaksPrivate("You are blessed", ["blessing"]));
  assert(!leaksPrivate("Graceful rest", ["grace"]));
  assert(!leaksPrivate("Anything at all", []));
  assertEquals(leakedWords("Grace for Ibadan and grace again", ["blessing", "ibadan", "grace"]), ["ibadan", "grace"]);
});

const reflection = (over: Partial<ToneReflection> = {}): ToneReflection => ({
  title: "Rest for a Tired Heart",
  devotional: [
    "It sounds like this week has been heavy. You’ve carried a lot, and it makes sense to feel tired.",
    "God is near in the tired places. He isn’t waiting for you to be stronger.",
    "Tonight, take one slow breath and tell him how you feel.",
  ].join("\n\n"),
  closingPrayer: "Lord, we bring you this tired heart. Hold us close tonight and give us rest.",
  affirmations: [
    { slot: "morning", headline: "You are held, not hurried", text: "Begin today knowing that God holds you." },
    { slot: "afternoon", headline: "God is steady with you", text: "Pause and breathe; he is near." },
    { slot: "evening", headline: "Rest in his care", text: "Let tonight be gentle." },
  ],
  ...over,
});

Deno.test("style measures: counted, never enforced", () => {
  const clean = styleMeasures(reflection());
  assertEquals(clean.longSentences, 0);
  assertEquals(clean.questions, 0);
  assertEquals(clean.symbols, 0);
  assertEquals(clean.numerals, 0);
  assertEquals(clean.commands, 0);
  assertEquals(clean.capitalPronouns, 0);
  assertEquals(clean.copiedExample, false);
  assertEquals([clean.devotionalParagraphs, clean.paragraphsInRange], [3, true]);
  assertEquals(clean.devotionalInRange, false, "the sample is short of 110 words");
  assertEquals(clean.titleWords, 5);
  assertEquals(clean.titleInRange, true);
  assertEquals(clean.titleEndPunctuation, false);
  assertEquals(clean.headlinesOutOfRange, 0);
  assertEquals(clean.textsOutOfRange, 3, "each sample text is under 12 words");

  const long = Array.from({ length: 30 }, () => "word").join(" ");
  const messy = styleMeasures(reflection({
    title: "A Title That Is Far Too Long For A Lock Screen.",
    devotional: `${long}. Why now? (Maybe) at 3 pm; "quoted" / here. You should rest, at least for now. ` +
      `Trust Him, and His love. ${TONE_EXAMPLE.strong[1]}`,
    closingPrayer: "Lord, You are near. We need You.",
    affirmations: [
      { slot: "morning", headline: "A headline that runs on for far too many words today", text: "Short." },
      { slot: "afternoon", headline: "Ok", text: "Short." },
      { slot: "evening", headline: "Rest", text: Array.from({ length: 31 }, () => "word").join(" ") },
    ],
  }));
  assertEquals(messy.longSentences, 1);
  assertEquals(messy.questions, 1);
  assertEquals(messy.symbols, 6, "two parentheses, a semicolon, two quotes and a slash");
  assertEquals(messy.numerals, 1);
  assertEquals(messy.commands, 2);
  assertEquals(messy.capitalPronouns, 4, "Him, His, You and You, never a sentence's first word");
  assertEquals(messy.copiedExample, true);
  assertEquals(messy.titleInRange, false);
  assertEquals(messy.titleEndPunctuation, true);
  assertEquals(messy.headlinesOutOfRange, 3);
  assertEquals(messy.textsOutOfRange, 3);
});

Deno.test("the opening: a stock first line is counted, and the first word is read without its apostrophe ending", () => {
  const stock = [
    "It sounds like this week asked a lot of you.",
    "It’s okay to be this tired.",
    "It's okay to be this tired.",
    "it makes sense that you feel this.",
    "I hear how heavy this is.",
    "I’m so glad you wrote this down.",
    "Today feels long.",
    "Sometimes grief arrives quietly.",
    "Dear friend, rest a moment.",
    "Dear one, rest a moment.",
    "You are not alone tonight.",
    "You’re not alone tonight.",
    "In this moment, breathe.",
    "Let’s pause here.",
    "Let's pause here.",
    "“It is late, and you are tired.”",
    "The weight of this week sits on your chest.",
    "The phone call ended, and the house went quiet.",
  ];
  for (const opening of stock) assert(hasStockOpening(opening), opening);
  // "The" is stock as a whole word only.
  for (const opening of ["There is a quiet in the house tonight.", "Then the call came.", "These hours are long."]) {
    assert(!hasStockOpening(opening), opening);
  }
  const fresh = [
    "Imagine the kitchen light still on at midnight.",
    "Itinerant weeks wear a heart thin.",
    "Some weeks ask more of you than you have.",
    "You have carried this alone for too long.",
    "Your heart has been running all week.",
    "Grief keeps its own hours.",
    "In the quiet after the house is asleep, the worry wakes.",
    "Letting go has never been easy for you.",
    "Dearest things are the hardest to lose.",
  ];
  for (const opening of fresh) assert(!hasStockOpening(opening), opening);
  assertEquals(firstWord("It’s okay."), "it");
  assertEquals(firstWord("You’re held."), "you");
  assertEquals(firstWord("  Grief keeps its own hours."), "grief");
  assertEquals(firstWord(""), "");
  const measured = styleMeasures(reflection({ devotional: "It makes sense to be tired.\n\nGod is near." }));
  assertEquals([measured.firstWord, measured.stockOpening], ["it", true]);
  const fresher = styleMeasures(reflection({ devotional: "Some weeks ask a lot of you.\n\nGod is near." }));
  assertEquals([fresher.firstWord, fresher.stockOpening], ["some", false]);
});

Deno.test("the hook: its length in words and its first two words are measured, never a reason to refuse a reply", () => {
  assertEquals(HOOK_MAX_WORDS, 12);
  assertEquals(openingSentence("Another night at your desk. God is here."), "Another night at your desk.");
  assertEquals(openingSentence("You said “enough.” Then you rested."), "You said “enough.”");
  assertEquals(openingSentence("No end at all"), "No end at all");
  assertEquals(openingStart("Empty spaces settle into your home."), "empty spaces");
  assertEquals(openingStart("  “You’re holding it together for everyone.”"), "you're holding");
  assertEquals(openingStart("Waiting."), "waiting");
  assertEquals(openingStart(""), "");
  const short = styleMeasures(
    reflection({ devotional: "Every buzz of the phone makes your heart jump.\n\nGod is near, and he stays." }),
  );
  assertEquals([short.openingWords, short.openingStart], [9, "every buzz"]);
  const long = styleMeasures(
    reflection({
      devotional:
        "You feel like the floor has fallen out from under you and the story did not go the way you pleaded for.\n\nGod is near.",
    }),
  );
  assertEquals(long.openingWords, 22);
  assert(long.openingWords > HOOK_MAX_WORDS);
  // A hook that leans on a feeling word is counted; the concrete thing carrying the feeling is not.
  const hookOf = (sentence: string) =>
    styleMeasures(reflection({ devotional: `${sentence}\n\nGod is near.` })).hookFeeling;
  for (
    const sentence of [
      "Heavy dread marks your mornings now.",
      "Weighed down, you sat in the car.",
      "The worry sits heavier tonight.",
      "That burden stayed all week.",
    ]
  ) {
    assert(hookOf(sentence), sentence);
  }
  for (const sentence of ["Boxes sit unopened in rooms you barely know.", "A weightless morning came at last."]) {
    assert(!hookOf(sentence), sentence);
  }
});

Deno.test("the spoken length is estimated from the script's characters", () => {
  assertEquals(SCRIPT_CHARS_PER_SECOND, 14);
  assertEquals(estimatedSeconds(1_400), 100);
  assertEquals(estimatedSeconds(1_260), 90);
});

Deno.test("correction notes: one per tone check, the leaked words first, at most 20, none for a shape problem", () => {
  assertEquals(
    correctionNote("verse_reference", []),
    "Your last reply named or pointed to a Bible passage in the devotional or the closing prayer. Write the whole reply again, and leave every book, chapter and verse out of both.",
  );
  assertEquals(
    correctionNote("never_say:reason", []),
    "Your last reply said “everything happens for a reason” or something that means the same. Write the whole reply again without it.",
  );
  for (const item of NEVER_SAY) assert(correctionNote(`never_say:${item.id}`, [])?.includes(`“${item.label}”`));
  const words = ["tunde", "blessing", "ibadan"];
  for (const reason of ["title_private", "headline_private"]) {
    assertEquals(
      correctionNote(reason, words, ["blessing"]),
      "Your last reply used a word from the entry in the title or an affirmation headline. Write the whole reply again, and do not use any of these words in reflection_title or in any headline: blessing, tunde, ibadan.",
    );
  }
  const many = Array.from({ length: 30 }, (_, index) => `name${index}`);
  const note = correctionNote("headline_private", many, ["name25"]) ?? "";
  const listed = note.slice(note.lastIndexOf(": ") + 2, -1).split(", ");
  assertEquals(listed.length, 20);
  assertEquals(listed[0], "name25");
  for (
    const reason of ["json", "title", "affirmation_headline", "devotional_words", "never_say:unknown", "never_say"]
  ) {
    assertEquals(correctionNote(reason, words), null, reason);
  }
});

Deno.test("salvage: only the fields that leak are replaced, and the safe texts pass every hard check", () => {
  const leaky = reflection({
    title: "Missing Blessing Tonight",
    affirmations: [
      { slot: "morning", headline: "You are a blessing", text: "Begin today knowing that God holds you." },
      { slot: "afternoon", headline: "God is steady with you", text: "Pause and breathe; he is near." },
      { slot: "evening", headline: "Ibadan is not so far", text: "Let tonight be gentle." },
    ],
  });
  const words = privateWords("I miss my sister Blessing, who moved to Ibadan.");
  const saved = salvageReflection(leaky, words);
  assertEquals(saved.salvaged, "title_private");
  assertEquals(saved.title, SAFE_TITLE);
  assertEquals(saved.affirmations.map((item) => item.headline), [
    SAFE_HEADLINES.morning,
    "God is steady with you",
    SAFE_HEADLINES.evening,
  ]);
  // The texts, the devotional and the prayer stay as the model wrote them.
  assertEquals(saved.affirmations.map((item) => item.text), leaky.affirmations.map((item) => item.text));
  assertEquals([saved.devotional, saved.closingPrayer], [leaky.devotional, leaky.closingPrayer]);
  assertEquals(leaky.title, "Missing Blessing Tonight", "the reply itself is not changed");

  const headlineOnly = salvageReflection({ ...leaky, title: "Rest for a Tired Heart" }, words);
  assertEquals(headlineOnly.salvaged, "headline_private");
  assertEquals(headlineOnly.title, "Rest for a Tired Heart");

  const nothing = salvageReflection(reflection(), words);
  assertEquals(nothing.salvaged, null);

  for (const safe of [SAFE_TITLE, ...Object.values(SAFE_HEADLINES)]) {
    assertEquals(firstNeverSay(safe), null, safe);
    assert(!hasVerseReference(safe), safe);
    assert(!leaksPrivate(safe, words), safe);
  }
  assertEquals(SAFE_TITLE, "A Quiet Moment with God");
  assertEquals(SAFE_HEADLINES, {
    morning: "You are not alone today",
    afternoon: "God is with you here",
    evening: "Rest in his care",
  });
  for (const headline of Object.values(SAFE_HEADLINES)) {
    const count = headline.split(" ").length;
    assert(headline.length <= 50 && count >= 2 && count <= 8, headline);
  }
  assert(SAFE_TITLE.length <= 40 && SAFE_TITLE.split(" ").length <= 6);
});
