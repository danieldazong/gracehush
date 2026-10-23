import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { BENIGN_IDIOMS, CRISIS_PHRASES, matchCrisisPhrase, normalizeForMatch } from "./phrases.ts";

Deno.test("the list is a plain, unique set of phrases already in normalized form", () => {
  assert(CRISIS_PHRASES.length >= 15, "the backstop has real coverage");
  assertEquals(new Set(CRISIS_PHRASES).size, CRISIS_PHRASES.length, "no phrase is listed twice");
  for (const phrase of [...CRISIS_PHRASES, ...BENIGN_IDIOMS]) {
    assertEquals(normalizeForMatch(phrase), phrase, `"${phrase}" must be written the way a text is normalized`);
    assert(!phrase.includes("("), `"${phrase}" still has an unexpanded group`);
  }
});

Deno.test("every phrase matches inside a longer sentence", () => {
  for (const phrase of CRISIS_PHRASES) {
    for (
      const sentence of [
        `Lately, ${phrase}, and I do not know who to tell.`,
        `${phrase}`,
        `It has been a long week.\n\nHonestly ${phrase}!`,
        `I wrote this down: "${phrase.toUpperCase()}" and then I closed the book.`,
      ]
    ) {
      assert(matchCrisisPhrase(sentence), `should match: ${sentence}`);
    }
  }
});

Deno.test("spellings people actually use: contractions, fillers, shouting, line breaks, curly quotes", () => {
  for (
    const text of [
      "I'm gonna kill myself",
      "i dont want to be alive",
      "Im thinking about killing myself",
      "I’m going to end my own life",
      "I JUST want to die",
      "I really, truly want to die.",
      "i wanna die",
      "I want\nto\ndie",
      "I'll hurt myself",
      "I do not want to live any longer",
      "I don’t want to live anymore.",
      "He said 'I want to die' to me.",
      "I want to die.Please help",
      "I want to    die",
    ]
  ) {
    assert(matchCrisisPhrase(text), `should match: ${text}`);
  }
});

Deno.test("a negation still matches (on purpose: it fails safe)", () => {
  assert(matchCrisisPhrase("I'm not suicidal anymore, thank God."));
  assert(matchCrisisPhrase("I was suicidal years ago."));
});

Deno.test("harming someone else", () => {
  for (const text of ["I am going to hurt him tonight.", "I will kill her.", "I want to hurt someone."]) {
    assert(matchCrisisPhrase(text), `should match: ${text}`);
  }
});

Deno.test("common idioms and everyday words do not match", () => {
  for (
    const text of [
      "this traffic is killing me",
      "This week is killing me.",
      "I'm dying to see you!",
      "I'm dying to hear how it went.",
      "I could kill myself for forgetting my keys.",
      "I want to diet this year.",
      "My feet are killing me and I am dying for a cup of tea.",
      "I'm dying of laughter.",
      "To live is Christ and to die is gain.",
      "I do not want to die.",
      "I don’t want to hurt her feelings.",
      "I want to hurt no one and heal everyone.",
      "The doctor said it will not kill me.",
      "I was not going to hurt myself by skipping lunch, but I did.",
      "",
      "   ",
      "constructor __proto__ toString",
    ]
  ) {
    assert(!matchCrisisPhrase(text), `should not match: ${text}`);
  }
});

Deno.test("prayers of surrender and dying to self are not crisis, but the same words in earnest are", () => {
  for (
    const text of [
      "Lord, take my life and let it be consecrated to You.",
      "Take my life, Lord, and use it however You want.",
      "I want to die to self and live for Christ.",
      "Help me die to my pride and my flesh.",
      "I want to be dead to sin and alive to God.",
      "I am ready to end my life of sin and follow Jesus.",
      "That would end my life as I know it, Lord, but I trust You.",
      "I do not want to live in fear anymore.",
      "I do not want to live like that again; I want to live in Your peace.",
    ]
  ) {
    assert(!matchCrisisPhrase(text), `should not match: ${text}`);
  }
  // The exemption removes only the idiom itself.
  assert(matchCrisisPhrase("I want to die to self, and some days I want to die."));
  assert(matchCrisisPhrase("I want to die to be with Jesus."));
  assert(matchCrisisPhrase("I do not want to live anymore, Lord."));
});

Deno.test("normalizeForMatch", () => {
  assertEquals(normalizeForMatch("  I’m JUST   so TIRED... of it!!  "), "i am tired of it");
  assertEquals(normalizeForMatch("Don't, won't; can’t"), "do not won't can't");
  assertEquals(normalizeForMatch("'quoted' words and 'tis"), "quoted words and tis");
  assertEquals(normalizeForMatch("die.Please—now"), "die please");
  assertEquals(normalizeForMatch(""), "");
});

Deno.test("a long entry is checked quickly", () => {
  const long = "I am so grateful for my family and my church. ".repeat(450);
  const started = performance.now();
  assert(!matchCrisisPhrase(long));
  assert(matchCrisisPhrase(`${long} I want to die.`));
  assert(performance.now() - started < 500, "matching a 20,000 character text takes well under half a second");
});
