import { assert, assertEquals } from "./testing/assert.ts";
import {
  contentStems,
  correctionNote,
  DEVOTIONAL_WORDS,
  echoProblem,
  estimatedSeconds,
  firstNeverSay,
  firstWord,
  groundingCount,
  groundingProblem,
  groundingThreshold,
  hasStockOpening,
  hasVerseReference,
  headlineKey,
  headlineProblems,
  HOOK_MAX_WORDS,
  leakedWords,
  leaksPrivate,
  NEVER_SAY,
  openingSentence,
  openingStart,
  prayerPetitions,
  prayerVoice,
  prayerVoiceProblem,
  privateWords,
  SAFE_HEADLINES,
  SAFE_TITLE,
  salvageReflection,
  SCRIPT_CHARS_PER_SECOND,
  stem,
  STOPWORDS,
  styleMeasures,
  TONE_EXAMPLE,
  type ToneReflection,
  validationProblem,
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

// ---- gen-v2.3: the prayer's voice, grounding, the echo and the validation line --------------------------------------

Deno.test('prayer voice: the person\'s own prayer in the first person singular, and "we" only when their entry said it', () => {
  const plain = "I have an interview tomorrow and my car broke down. Lord, please help me find a way.";
  const together = "Lord, our family needs a new home. Please guide us while we search.";
  const prayers: [string, string, "i" | "we" | "none"][] = [
    ["Lord, I bring you my worry about tomorrow. Hold me close tonight.", plain, "i"],
    ["Father, I’m tired, and I ask you for rest.", plain, "i"],
    ["Father, I'm tired and I ask you for rest.", plain, "i"],
    ["Lord, we bring you this tired heart. Hold us close tonight.", plain, "we"],
    ["Lord, I bring you my week. Give us rest.", plain, "we"],
    ["Lord, we lift our family to you and ask you to guide us.", together, "we"],
    ["Lord, I lift our family to you, and I ask you to guide us.", together, "i"],
    ["Lord, hold this family close tonight and give them rest.", plain, "none"],
    ["Lord, I’m here.", plain, "none"],
    ["Jesus, MY heart is yours, and I trust you.", plain, "i"],
    ["Lord, hear Mimi and Ivy tonight, and give them rest.", plain, "none"],
    ["God, I’ll wait for you, and I'd rather wait with you than without.", plain, "i"],
  ];
  for (const [prayer, entry, expected] of prayers) assertEquals(prayerVoice(prayer, entry), expected, prayer);

  // Only "i" passes, and "we" passes too when the person themselves wrote as "we".
  assertEquals(prayerVoiceProblem(prayers[0][0], plain), null);
  assertEquals(prayerVoiceProblem(prayers[3][0], plain)?.reason, "prayer_voice:we");
  assertEquals(prayerVoiceProblem(prayers[3][0], plain)?.salvaged, "prayer_we");
  assertEquals(prayerVoiceProblem(prayers[5][0], together), null, "the entry's own we");
  assertEquals(prayerVoiceProblem(prayers[6][0], together), null);
  assertEquals(prayerVoiceProblem(prayers[7][0], plain)?.reason, "prayer_voice:none");
  assertEquals(prayerVoiceProblem(prayers[7][0], plain)?.salvaged, "prayer_none");
  assert(prayerVoiceProblem(prayers[3][0], plain)?.note.includes("first person singular"));
});

Deno.test("grounding: content stems shared with the entry, never the common words or the words of any devotional", () => {
  // A content word has four letters or more; the stem cuts a plural, -ed and -ing, and a possessive is cut at the apostrophe.
  assertEquals(stem("surgeries"), stem("surgery"));
  assertEquals(stem("interviews"), "interview");
  assertEquals(stem("waiting"), "wait");
  assertEquals(stem("worried"), stem("worries"));
  assertEquals(stem("classes"), "class");
  assertEquals(stem("houses"), "house");
  assertEquals([...contentStems("My son’s surgery's on Thursday.")].sort(), [stem("surgery"), "thursday"].sort());

  const two = "Pray for the surgery on Thursday.";
  const five = "My manager moved the deadline and the client is angry.";
  const twelve =
    "The landlord raised my rent, my daughter starts school, the generator broke, the mechanic wants cash, and my stall is quiet.";
  assertEquals(contentStems(two).size, 2);
  assertEquals(contentStems(five).size, 5);
  assertEquals(contentStems(twelve).size, 12);
  // At least 2 shared when the entry has 8 or more content stems, at least 1 with 3 to 7, and no check below 3.
  assertEquals([groundingThreshold(two), groundingThreshold(five), groundingThreshold(twelve)], [0, 1, 2]);

  assertEquals(groundingCount(twelve, ["God is near, and his love holds you tonight."]), 0);
  assertEquals(groundingCount(twelve, ["Your rent is not the measure of your worth."]), 1);
  assertEquals(groundingCount(twelve, ["The landlord and the rent sit on your shoulders."]), 2);
  assertEquals(
    groundingCount(twelve, ["The landlord, the rent, the school, the generator and the mechanic all came at once."]),
    5,
  );
  // The texts count together: the line, the devotional and the prayer.
  assertEquals(groundingCount(twelve, ["The landlord came.", "Lord, I bring you my rent."]), 2);

  // The words any devotional holds and the common words never count, whatever the entry says.
  const devotionalWords = "My heart feels heavy and I keep praying for peace tonight.";
  assertEquals(groundingCount(devotionalWords, ["Your heart can rest in his peace tonight as you pray."]), 0);
  for (
    const word
      of "god lord jesus christ father spirit holy pray prayer amen grace faith love peace hope heart hearts today tonight morning evening feel feeling feels felt moment carry carrying rest know knows hold holds held still here near close alone true truth breath breathe step small good real right world thing things time day days life"
        .split(" ")
  ) {
    assert(DEVOTIONAL_WORDS.has(word), word);
  }
  assert(STOPWORDS.size >= 120 && STOPWORDS.size <= 220, `${STOPWORDS.size} stopwords`);
  // A possessive and a plural meet their plain word, and a day of the week counts.
  assertEquals(groundingCount("Please pray for my son's surgery on Thursday.", ["The surgery’s date is Thursday."]), 2);
  assertEquals(groundingCount("Two surgeries this month.", ["After the surgery, rest."]), 1);
});

Deno.test("the echo: one short phrase of theirs, word for word, in quotation marks, or none at all", () => {
  const entry = "My boss said the report was late again, and I told him I am doing my best.";
  const devotional = (sentence: string) => `${sentence}\n\nGod sees what you carry.`;
  assertEquals(echoProblem([devotional("You said it yourself: “I am doing my best.”")], entry), null);
  assertEquals(echoProblem([devotional('You said it yourself: "I am doing my best."')], entry), null);
  assertEquals(
    echoProblem([devotional("You told him, “I’m doing my best”, and you are.")], entry)?.reason,
    "echo_invented",
  );
  assertEquals(echoProblem([devotional("No quotation at all.")], entry), null);
  // Nine words, even the person's own, are too many.
  assertEquals(
    echoProblem([devotional("“the report was late again and I told him”")], entry)?.reason,
    "echo_invented",
  );
  assertEquals(echoProblem([devotional("“the report was late again and I told”")], entry), null, "eight words");
  // A changed word is not their words.
  assertEquals(echoProblem([devotional("You said, “I am trying my best.”")], entry)?.reason, "echo_invented");
  // Twice is once too many, and a quotation in the prayer counts too.
  assertEquals(
    echoProblem([devotional("“I am doing my best.” And “the report was late.”")], entry)?.reason,
    "echo_invented",
  );
  assertEquals(
    echoProblem([devotional("No quote here."), "Lord, you heard me say “I give up.”"], entry)?.reason,
    "echo_invented",
  );
  // Case, apostrophes and punctuation do not matter; the words and their order do.
  assertEquals(echoProblem(["You wrote “i can't SLEEP, Lord.”"], "I can’t sleep. Lord, I need you."), null);
  const reversed = echoProblem(["You wrote “sleep can’t I.”"], "I can’t sleep. Lord, I need you.");
  assertEquals([reversed?.reason, reversed?.salvaged], ["echo_invented", "echo_invented"]);
  assert(reversed?.note.startsWith("The quoted words are not in the person’s entry."), reversed?.note);
});

Deno.test("the validation line: from the entry, second person, 5 to 24 words, never stock and never private", () => {
  const entry = "Please pray for my sister Blessing, who moved to Ibadan. I miss her every day.";
  const words = privateWords(entry);
  assertEquals(words, ["blessing", "ibadan"]);
  const line = (text: string | null) => validationProblem(text, words)?.reason ?? null;
  assertEquals(line(null), "validation_missing");
  assertEquals(line("  "), "validation_missing");
  assertEquals(line("Your sister moved away."), "validation_length");
  assertEquals(line(Array.from({ length: 25 }, () => "you").join(" ")), "validation_length");
  assertEquals(line(`You ${"x".repeat(240)}`), "validation_length");
  for (
    const stock of [
      "It sounds like you are carrying a lot this week, and that is real.",
      "It seems your week has been long and you are tired.",
      "Sometimes the quiet after a move is louder than you expected.",
      "The move left you missing someone you love every single day.",
      "Today you miss your sister more than you can say.",
    ]
  ) {
    assertEquals(line(stock), "validation_stock", stock);
  }
  assertEquals(line("Missing a sister who moved far away is a real ache."), "validation_person");
  assertEquals(line("Your sister Blessing moved away, and you miss her every day."), "validation_private");
  assertEquals(line("Your sister moved to a new city, and you miss her every single day."), null);
  // In this order: a line that is both stock and private is stock.
  assertEquals(line("It hurts that Blessing moved away and you miss her."), "validation_stock");
  // Every note names the rule; only the private one names words, and only the entry's private ones.
  const problems = [
    null,
    "Your sister moved away.",
    "It seems your week was long and you are tired.",
    "Missing a sister far away is a real ache for anyone.",
  ].map((text) => validationProblem(text, words)!);
  for (const problem of problems) {
    assertEquals(problem.salvaged, problem.reason);
    assert(problem.note.includes("validation_line"), problem.note);
    assert(!/blessing|ibadan|sister/i.test(problem.note), problem.note);
  }
  assert(
    validationProblem("Your sister Blessing moved away, and you miss her.", words)!.note.endsWith(
      ": blessing, ibadan.",
    ),
  );
});

Deno.test("step 36's correction notes name a rule and never a word of the person's (the private-word notes are step 32's)", () => {
  const entry =
    "Bartholomew drove to Kaduna for the cardiology appointment, and the generator broke down on Tuesday evening.";
  const theirs = (entry.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((word) => !STOPWORDS.has(word));
  const words = privateWords(entry);
  const notes = [
    prayerVoiceProblem("Lord, we ask you to carry us through this week.", entry)?.note,
    prayerVoiceProblem("Lord, carry them through this week.", entry)?.note,
    groundingProblem(entry, ["A quiet word of comfort from God, with nothing of theirs in it."])?.note,
    echoProblem(["You said it yourself: “the engine exploded on the highway”."], entry)?.note,
    validationProblem(null, words)?.note,
    validationProblem("Too short.", words)?.note,
    validationProblem("It sounds like the generator broke down on Tuesday for you.", words)?.note,
    validationProblem("A generator broke down on a long and cold Tuesday evening again.", words)?.note,
  ];
  assert(theirs.length >= 8, "the entry has words of its own to leak");
  for (const note of notes) {
    assert(note !== undefined && note.length > 0, "every problem has a note");
    for (const word of theirs) assert(!note.toLowerCase().includes(word), `a note holds the person's word "${word}"`);
  }
});

Deno.test("style measures of gen-v2.3: grounding, the prayer's voice and the validation line's words", () => {
  const entry = "Work has been relentless and I keep lying awake before the client meeting.";
  const measured = styleMeasures(
    reflection({ validationLine: "The client meeting keeps you awake, and work will not let up." }),
    entry,
  );
  assertEquals(measured.validationWords, 12);
  assertEquals(measured.prayerVoice, "we", "the sample prayer says we");
  assert(measured.grounding >= 2, `${measured.grounding}`);
  const none = styleMeasures(reflection());
  assertEquals([none.validationWords, none.grounding], [0, 0]);
});

Deno.test("gen-v2.6: the prayer's petitions are the clauses that ask God, and its range is 50 to 75 words", () => {
  const prayer = [
    "Father, you are the God who provides.",
    "I failed the exam again and I feel like running away.",
    "Give me rest tonight, and clear sight before I decide anything.",
    "Help me take the next step tomorrow, and steady my hands when the results come.",
    "You have not left me, and your grace is enough for this.",
    "I trust you with what I cannot see.",
  ].join(" ");
  assertEquals(prayerPetitions(prayer), 3, "give, help and steady ask; the rest declares");
  assertEquals(prayerPetitions("Lord, you know how tired I am. Thank you for staying close. I trust you."), 0);
  assertEquals(prayerPetitions("Lord, please show me what to do. I ask for wisdom and I pray for rest."), 3);
  assertEquals(prayerPetitions("Be near me tonight, Lord. Don’t let me face it alone."), 2);
  const measured = styleMeasures(reflection({ closingPrayer: prayer }));
  assertEquals([measured.prayerPetitions, measured.prayerSentences, measured.prayerWords], [3, 6, 64]);
  assertEquals(measured.prayerInRange, true);
  // The sample prayer of the fixture is 15 words and asks twice ("hold us close", "give us rest").
  const sample = styleMeasures(reflection());
  assertEquals([sample.prayerPetitions, sample.prayerInRange], [2, false]);
});

// ---- Step 37 (gen-v2.5): the headlines are a lock screen's bold title -------------------------------------------------------

Deno.test("headlineProblems: a feeling word in any headline, in any of its forms, and nothing else", () => {
  const three = (morning: string) => [
    { slot: "morning" as const, headline: morning },
    { slot: "afternoon" as const, headline: "He leads you gently" },
    { slot: "evening" as const, headline: "Your needs are known" },
  ];
  for (
    const headline of [
      "When you feel anxious",
      "Your worries are his",
      "Grief does not have the last word",
      "Fearful days end",
      "Rest when you are tired",
      "You are not ALONE or lonely",
      "Overwhelmed and still held",
      // Step 37 round 2: a person's state or reaction, which a headline written from a verse tended to name.
      "Your tears are noticed",
      "Strength when depleted",
      "His grace meets your weakness",
      "God stays beside your ache",
    ]
  ) {
    assertEquals(headlineProblems(three(headline)).map((item) => item.reason), ["headline_feeling"], headline);
  }
  for (const headline of ["God is your refuge", "His mercies are new", "Sadie’s Grace", "Peace that guards you"]) {
    assertEquals(headlineProblems(three(headline)), [], headline);
  }
});

Deno.test("headlineProblems: a headline this person already received, compared without case or punctuation", () => {
  const items = [
    { slot: "morning" as const, headline: "God is your refuge" },
    { slot: "afternoon" as const, headline: "He leads you gently" },
    { slot: "evening" as const, headline: "Your needs are known" },
  ];
  assertEquals(headlineProblems(items, ["You are held", "he leads you, gently."]).map((item) => item.reason), [
    "headline_repeated",
  ]);
  assertEquals(headlineProblems(items, ["", "You are held"]), []);
  assertEquals(headlineKey("  He LEADS you—gently! "), "he leads you gently");
});

Deno.test("headlineProblems: the notes quote only the model's own headline, never the person's words", () => {
  const notes = headlineProblems([
    { slot: "morning", headline: "When you feel anxious" },
    { slot: "afternoon", headline: "He leads you gently" },
    { slot: "evening", headline: "Your needs are known" },
  ], ["he leads you gently"]).map((item) => item.note);
  assertEquals(notes.length, 2);
  assert(notes.every((note) => !note.includes("work this week")), "never the entry");
});
