import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { installWorld, type World } from "../../process-entry/testing/fakes.ts";
import { clearChapterCache } from "../bible/helloao.ts";
import type { ScriptureRef } from "../bible/reference.ts";
import { hardPassage, heavyChatFallback } from "./heavyChat.ts";
import {
  endsSentence,
  findTypedVerse,
  namedReferences,
  type PassageCard,
  resolvePassages,
  sharesRun,
  TYPED_VERSE_NOTE,
} from "./passages.ts";

const JOHN_3_16: ScriptureRef = { bookId: "JHN", chapter: 3, verseStart: 16, verseEnd: 16 };
const PSALM_23_1: ScriptureRef = { bookId: "PSA", chapter: 23, verseStart: 1, verseEnd: 2 };
const DENIED: ScriptureRef = { bookId: "PHP", chapter: 1, verseStart: 21, verseEnd: 21 };
const MISSING: ScriptureRef = { bookId: "JHN", chapter: 3, verseStart: 40, verseEnd: 40 };

function withWorld(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

Deno.test(
  "resolvePassages: only a verified passage becomes a card, with the Bible's own words; none is ever unverified",
  withWorld(async (world) => {
    const found = await resolvePassages({ lead: JOHN_3_16, support: PSALM_23_1 }, { heavy: false });
    assertEquals(found.lead?.reference, "John 3:16");
    assert(found.lead?.text.startsWith("For God so loved the world"));
    assertEquals(found.support?.reference, "Psalm 23:1–2");
    assert(found.support?.text.includes("The LORD is my shepherd"));

    // A verse that does not exist is left out; a chapter that cannot be read is left out too (no "confirming" state).
    world.bible.set("PSA/23", { kind: "status", status: 500 });
    const partial = await resolvePassages({ lead: MISSING, support: { ...PSALM_23_1, chapter: 46 } }, { heavy: false });
    assertEquals(partial.lead, null);
    // A chapter read once is cached: clear it, so the failure below is what is read.
    clearChapterCache();
    world.bible.set("PSA/46", { kind: "network" });
    const none = await resolvePassages({ lead: null, support: { ...PSALM_23_1, chapter: 46 } }, { heavy: false });
    assertEquals(none.support, null);
  }),
);

const ISAIAH = hardPassage("ISA_41_10").ref;

Deno.test(
  "resolvePassages: a heavy conversation never shows a denied passage, and an answer given a fallback card gets it",
  withWorld(async (world) => {
    const first = await resolvePassages({ lead: DENIED, support: null }, { heavy: true, fallback: ISAIAH });
    assertEquals([first.lead, first.support?.reference], [null, "Isaiah 41:10"]);
    assertEquals(world.bibleCalls.filter((call) => call.url.pathname.includes("/PHP/")).length, 0, "never even read");
    // A heavy answer given no fallback card, with no passage, stays with none.
    const later = await resolvePassages({ lead: DENIED, support: null }, { heavy: true });
    assertEquals([later.lead, later.support], [null, null]);
    // A heavy answer that has a fitting passage keeps it, and the fallback card is not added.
    const kept = await resolvePassages({ lead: null, support: PSALM_23_1 }, { heavy: true, fallback: ISAIAH });
    assertEquals(kept.support?.reference, "Psalm 23:1–2");
    // A fallback card is never given to an everyday answer.
    const everyday = await resolvePassages({ lead: null, support: null }, { heavy: false, fallback: ISAIAH });
    assertEquals(everyday.support, null);
    // When the Bible cannot be read, the fallback card is left out too.
    clearChapterCache();
    world.bible.set("ISA/41", { kind: "status", status: 503 });
    const down = await resolvePassages({ lead: null, support: null }, { heavy: true, fallback: ISAIAH });
    assertEquals([down.lead, down.support], [null, null]);
  }),
);

Deno.test("endsSentence: a card ends at the end of a sentence; a psalm's Selah and a closing quote mark are set aside", () => {
  assertEquals(endsSentence("God is our refuge and strength,\nan ever-present help in times of trouble."), true);
  assertEquals(endsSentence("Therefore we will not fear,\nthough the earth is transformed,"), false);
  assertEquals(endsSentence("He will never leave you nor forsake you. Do not be afraid or discouraged.”"), true);
  assertEquals(endsSentence("on your bed, search your heart and be still. Selah"), true);
  assertEquals(endsSentence("are they not in Your book?"), true);
  assertEquals(endsSentence("For God so loved the world"), false);
  assertEquals(endsSentence("the waters roar and foam—"), false);
});

Deno.test(
  "resolvePassages: a card that stops mid-sentence (the readers' Psalm 46:1–2) is completed in an everyday answer, never in a heavy one",
  withWorld(async () => {
    const psalm: ScriptureRef = { bookId: "PSA", chapter: 46, verseStart: 1, verseEnd: 2 };
    const everyday = await resolvePassages({ lead: null, support: psalm }, { heavy: false });
    assertEquals(everyday.support?.reference, "Psalm 46:1–3");
    assert(everyday.support !== null && endsSentence(everyday.support.text), "the card ends its sentence");
    const heavy = await resolvePassages({ lead: null, support: psalm }, { heavy: true });
    assertEquals(heavy.support, null, "a heavy answer's card is never grown past what the readers read");
    const whole = await resolvePassages({ lead: null, support: hardPassage("PSA_46_1").ref }, { heavy: true });
    assertEquals(whole.support?.reference, "Psalm 46:1");
    // The readers' cards for a person someone is hurting, and for a second written answer, read whole from the BSB.
    const hurt = await resolvePassages({ lead: null, support: hardPassage("PSA_9_9_10").ref }, { heavy: true });
    assertEquals(hurt.support?.reference, "Psalm 9:9–10");
    const near = await resolvePassages({ lead: null, support: hardPassage("DEU_31_8").ref }, { heavy: true });
    assertEquals(near.support?.reference, "Deuteronomy 31:8");
  }),
);

const at = (
  bookId: ScriptureRef["bookId"],
  chapter: number,
  verseStart: number,
  verseEnd = verseStart,
): ScriptureRef => ({
  bookId,
  chapter,
  verseStart,
  verseEnd,
});

Deno.test(
  "resolvePassages: an everyday card is completed one verse at a time, within its chapter and six verses, or left out",
  withWorld(async () => {
    // One verse more ends the sentence, and each card keeps its role.
    const one = await resolvePassages({ lead: at("JHN", 3, 14), support: at("ISA", 41, 8) }, { heavy: false });
    assertEquals([one.lead?.role, one.lead?.reference], ["lead", "John 3:14–15"]);
    assert(one.lead?.text.endsWith("may have eternal life."), one.lead?.text);
    assertEquals([one.support?.role, one.support?.reference], ["support", "Isaiah 41:8–9"]);
    // Two verses more (31:24 ends on a comma, 31:25 on a colon).
    const two = await resolvePassages({ lead: null, support: at("DEU", 31, 24) }, { heavy: false });
    assertEquals(two.support?.reference, "Deuteronomy 31:24–26");
    // The chapter ends before the sentence does (its song begins in the next chapter): left out.
    const end = await resolvePassages({ lead: null, support: at("DEU", 31, 30) }, { heavy: false });
    assertEquals(end.support, null);
    // Already six verses, and the sentence goes on: left out, never a seventh verse.
    const six = await resolvePassages({ lead: null, support: at("DEU", 31, 20, 25) }, { heavy: false });
    assertEquals(six.support, null);
    // A card that ends a sentence is shown as it was named, never grown.
    const named = await resolvePassages({ lead: at("DEU", 31, 8), support: at("JHN", 3, 16) }, { heavy: false });
    assertEquals([named.lead?.reference, named.support?.reference], ["Deuteronomy 31:8", "John 3:16"]);
  }),
);

Deno.test("sharesRun: six words in a row, case, punctuation and quote marks aside", () => {
  const verse =
    "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";
  assertEquals(sharesRun("He says “for God so loved the world,” and means it.", verse), true);
  assertEquals(sharesRun("God so loved the world.", verse), false, "five words are not a typed verse");
  assertEquals(sharesRun("God loves the world so much that he gave his Son.", verse), false);
  assertEquals(sharesRun("everyone who believes in him shall not perish", verse), true);
  assertEquals(sharesRun("", verse), false);
});

Deno.test("namedReferences: the chapter-and-verse references a reply names, each once", () => {
  assertEquals(
    namedReferences(
      "Read John 3:16 and Psalm 23:1–2, then 1 Corinthians 13:4-7 and John 3:16 again. In John 3 he speaks.",
    ),
    [
      JOHN_3_16,
      PSALM_23_1,
      { bookId: "1CO", chapter: 13, verseStart: 4, verseEnd: 7 },
    ],
  );
  assertEquals(namedReferences("Psalms 23:1 says it."), [{ bookId: "PSA", chapter: 23, verseStart: 1, verseEnd: 1 }]);
  assertEquals(namedReferences("Nothing named here, only Mark and Job."), []);
});

Deno.test(
  "findTypedVerse: a card's words or a named passage's words, in the reply or the prayer, are a typed verse",
  withWorld(async (world) => {
    const resolved = await resolvePassages({ lead: JOHN_3_16, support: null }, { heavy: false });
    const cards = [resolved.lead].filter((card): card is PassageCard => card !== null);
    assertEquals(await findTypedVerse(["God loves you, and he gave his Son for you."], cards), false);
    assertEquals(await findTypedVerse(["He gave His one and only Son, that everyone may live."], cards), true);
    assertEquals(await findTypedVerse(["Fine words.", "Lord, the LORD is my shepherd; I shall not want."], []), false);
    // A reference the reply names is read and checked too, even with no card for it.
    const before = world.bibleCalls.length;
    assertEquals(await findTypedVerse(["As Psalm 23:1–2 says, the LORD is my shepherd; I shall not want."], []), true);
    assert(world.bibleCalls.length >= before, "the named passage was read");
    // At most three named references are read.
    const reads = world.bibleCalls.length;
    await findTypedVerse(["John 3:16, John 3:17, Psalm 23:1, Psalm 46:1, Isaiah 41:10, Philippians 4:6."], []);
    const keys = new Set(world.bibleCalls.slice(reads).map((call) => call.url.pathname));
    assert(keys.size <= 3, `${keys.size} chapters read`);
  }),
);

Deno.test("the typed-verse note names the rule and nothing of the person's, and no written answer types its card", async () => {
  assert(TYPED_VERSE_NOTE.includes("Write the whole reply again"));
  const world = installWorld();
  try {
    for (const variant of ["general", "abuse", "repeat"] as const) {
      const written = heavyChatFallback(variant, {
        help: variant === "abuse" ? "abuse" : "crisis",
        region: "us",
        usedPassages: [],
      });
      assert(written.passageKey !== null, variant);
      const resolved = await resolvePassages({ lead: null, support: hardPassage(written.passageKey).ref }, {
        heavy: true,
      });
      const cards = [resolved.support].filter((card): card is PassageCard => card !== null);
      assertEquals(cards.length, 1, variant);
      assertEquals(await findTypedVerse([written.reply], cards), false, variant);
    }
  } finally {
    world.restore();
  }
});
