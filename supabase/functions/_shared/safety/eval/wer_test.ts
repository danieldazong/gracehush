import { matchCrisisPhrase } from "../phrases.ts";
import { assert, assertEquals } from "../../../process-entry/testing/assert.ts";
import { median, normalizeWords, UNCLEAR, wordErrorRate } from "./wer.ts";

// The transcription fidelity check (step 36): a recording's words are measured against the script that was read, as a word
// error rate. Offline: no model is called here.

const near = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-9;

Deno.test("words: lowercased, punctuation gone, one kind of apostrophe, and [unclear] kept as its own word", () => {
  assertEquals(normalizeWords("Hello, World! It’s me… "), ["hello", "world", "it's", "me"]);
  assertEquals(normalizeWords("Abeg, make dem pay us; NA so."), ["abeg", "make", "dem", "pay", "us", "na", "so"]);
  assertEquals(normalizeWords("Give me [unclear] tonight"), ["give", "me", UNCLEAR, "tonight"]);
  assertEquals(normalizeWords("  "), []);
});

Deno.test("the word error rate: substitutions, insertions and deletions over the script's words", () => {
  const script = "Lord please help me today";
  assertEquals(wordErrorRate(script, "Lord please help me today"), 0);
  assert(near(wordErrorRate(script, "Lord please help us today"), 1 / 5), "one substitution");
  assert(near(wordErrorRate(script, "Lord please please help me today"), 1 / 5), "one insertion");
  assert(near(wordErrorRate(script, "Lord help me today"), 1 / 5), "one deletion");
  assertEquals(wordErrorRate(script, ""), 1);
  // Case, punctuation and the apostrophe's shape are not errors.
  assertEquals(wordErrorRate("I can’t sleep, Lord.", "i can't sleep lord"), 0);
  // The order of the words is.
  assert(wordErrorRate("I can’t sleep", "sleep can’t I") > 0);
});

Deno.test("[unclear] is a wrong word, even where the script had a word that is hard to hear", () => {
  assert(near(wordErrorRate("Lord please help me today", "Lord please [unclear] me today"), 1 / 5));
  // It never matches anything, not even itself.
  assert(near(wordErrorRate("Lord [unclear] me", "Lord [unclear] me"), 1 / 3));
});

Deno.test("an empty script is refused: there is nothing to measure against", () => {
  let refused = false;
  try {
    wordErrorRate("", "anything");
  } catch {
    refused = true;
  }
  assert(refused);
});

Deno.test("the median of the clips", () => {
  assertEquals(median([0.1, 0.3, 0.2]), 0.2);
  assert(near(median([0.1, 0.2, 0.3, 0.4]) ?? Number.NaN, 0.25));
  assertEquals(median([]), null);
});

type Script = { id: string; kind: string; script: string };

Deno.test("six made-up scripts of 40 to 80 words, one of each kind the owner records, none a crisis", async () => {
  const scripts: Script[] = JSON.parse(
    await Deno.readTextFile(new URL("./transcription_scripts.json", import.meta.url)),
  );
  assertEquals(scripts.map((item) => item.id), [
    "work-nigerian-english",
    "pidgin-mixed",
    "name-and-place",
    "moving-car",
    "pauses-restarts",
    "whisper",
  ]);
  for (const item of scripts) {
    assertEquals(Object.keys(item).sort(), ["id", "kind", "script"], item.id);
    const count = normalizeWords(item.script).length;
    assert(count >= 40 && count <= 80, `${item.id} has ${count} words`);
    assert(!matchCrisisPhrase(item.script), `${item.id} matches the crisis phrase list`);
    assert(!item.script.includes(UNCLEAR), item.id);
  }
});
