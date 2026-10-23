import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { bibleTiming, clearChapterCache } from "./helloao.ts";
import { hydrateScripture, MAX_PASSAGE_CHARS } from "./hydrate.ts";
import type { ScriptureRef } from "./reference.ts";

const fixtureText = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.simple.json`, import.meta.url));
const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "Content-Type": "application/json" }, ...init });

const ref = (
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

type Served = Record<string, string | (() => Response)>;

// Serves chapters by "ID/chapter" from fixtures (or a function), 404 for anything else; returns how many times it was asked.
async function withBible(served: Served, work: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const saved = { ...bibleTiming };
  const calls: string[] = [];
  globalThis.fetch = (input) => {
    const url = new URL(new Request(input).url);
    const key = url.pathname.replace(/^\/api\/BSB\//, "").replace(/\.simple\.json$/, "");
    calls.push(key);
    const entry = served[key];
    if (entry === undefined) return Promise.resolve(new Response("Not Found", { status: 404 }));
    return Promise.resolve(typeof entry === "function" ? entry() : json(fixtureText(entry)));
  };
  bibleTiming.retryDelayMs = 1;
  bibleTiming.requestTimeoutMs = 200;
  clearChapterCache();
  try {
    await work(calls);
  } finally {
    globalThis.fetch = original;
    Object.assign(bibleTiming, saved);
    clearChapterCache();
  }
}

const FIXTURES: Served = {
  "PHP/4": "PHP_4",
  "PSA/23": "PSA_23",
  "PSA/46": "PSA_46",
  "PSA/127": "PSA_127",
  "MAT/17": "MAT_17",
  "JHN/3": "JHN_3",
};

Deno.test("prose verses run on, and the text is the BSB's own (Philippians 4:6–7)", async () => {
  await withBible(FIXTURES, async () => {
    const result = await hydrateScripture(ref("PHP", 4, 6, 7));
    assertEquals(result, {
      status: "verified",
      ref: ref("PHP", 4, 6, 7),
      reference: "Philippians 4:6–7",
      text:
        "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.",
    });
  });
});

Deno.test("a single verse, and a verse that carries its own quotation marks, come through whole", async () => {
  await withBible(FIXTURES, async () => {
    const result = await hydrateScripture(ref("JHN", 3, 16));
    assert(result.status === "verified");
    assertEquals(result.reference, "John 3:16");
    assertEquals(
      result.text,
      "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.",
    );
  });
});

Deno.test("a psalm keeps its lines (Psalm 23:1–3), and the book is written Psalm, not Psalms", async () => {
  await withBible(FIXTURES, async () => {
    const result = await hydrateScripture(ref("PSA", 23, 1, 3));
    assert(result.status === "verified");
    assertEquals(result.reference, "Psalm 23:1–3");
    assertEquals(
      result.text,
      "The LORD is my shepherd;\nI shall not want.\nHe makes me lie down in green pastures;\nHe leads me beside quiet waters.\nHe restores my soul;\nHe guides me in the paths of righteousness\nfor the sake of His name.",
    );
  });
});

Deno.test("Selah, which the API glues on, gets its space (Psalm 46:2–3)", async () => {
  await withBible(FIXTURES, async () => {
    const result = await hydrateScripture(ref("PSA", 46, 2, 3));
    assert(result.status === "verified");
    assert(result.text.endsWith("and the mountains quake in the surge. Selah"), result.text.slice(-60));
    assert(!result.text.includes(".Selah"));
  });
});

Deno.test("verse numbers the BSB leaves out are not verses: Matthew 17:21 is missing, 17:27 is there", async () => {
  await withBible(FIXTURES, async () => {
    const missing = await hydrateScripture(ref("MAT", 17, 20, 22));
    assertEquals(missing, {
      status: "invalid",
      reference: "Matthew 17:20–22",
      reason: "VERSE_MISSING",
      note: "Matthew 17 has no verse 21 in the Berean Standard Bible",
    });
    // The chapter says numberOfVerses 26, and verse 27 exists: the count is not the highest number.
    const last = await hydrateScripture(ref("MAT", 17, 26, 27));
    assert(last.status === "verified", JSON.stringify(last));
  });
});

Deno.test("a verse beyond the end of the chapter is invalid", async () => {
  await withBible(FIXTURES, async () => {
    const result = await hydrateScripture(ref("PSA", 23, 6, 7));
    assert(result.status === "invalid" && result.reason === "VERSE_MISSING");
    assertEquals(result.note, "Psalms 23 has no verse 7 in the Berean Standard Bible");
  });
});

Deno.test("a passage that cannot be real is refused without asking the API", async () => {
  await withBible(FIXTURES, async (calls) => {
    const chapter = await hydrateScripture(ref("PSA", 151, 1));
    assertEquals(chapter, {
      status: "invalid",
      reference: "Psalm 151:1",
      reason: "CHAPTER_OUT_OF_RANGE",
      note: "Psalms has only 150 chapters",
    });
    const single = await hydrateScripture(ref("OBA", 2, 1));
    assert(single.status === "invalid");
    assertEquals(single.note, "Obadiah has only 1 chapter");
    const long = await hydrateScripture(ref("JHN", 3, 14, 30));
    assert(long.status === "invalid" && long.reason === "RANGE_TOO_LONG");
    const backwards = await hydrateScripture(ref("JHN", 3, 16, 14));
    assert(backwards.status === "invalid" && backwards.reason === "BAD_VERSES");
    assertEquals(calls, []);
  });
});

Deno.test("a passage too long for a card is invalid", async () => {
  const verses = Array.from({ length: 6 }, (_, index) => ({
    type: "verse",
    number: index + 1,
    text: `${"word ".repeat(49)}end.`,
  }));
  const chapter = { translation: { id: "BSB" }, book: { id: "JHN" }, chapter: { number: 3, content: verses } };
  await withBible({ "JHN/3": () => json(JSON.stringify(chapter)) }, async () => {
    const six = await hydrateScripture(ref("JHN", 3, 1, 6));
    assert(six.status === "invalid" && six.reason === "TOO_LONG", JSON.stringify(six));
    const four = await hydrateScripture(ref("JHN", 3, 1, 4));
    assert(four.status === "verified");
    assert(four.text.length <= MAX_PASSAGE_CHARS);
  });
});

Deno.test("verses are joined with a line break when either neighbour is poetry, and a space when both are prose", async () => {
  const verse = (number: number, text: string, poetic: boolean) => ({
    type: "verse",
    number,
    text,
    ...(poetic ? { poem: [{ start: 0, end: text.length, level: 1 }] } : {}),
  });
  const chapter = {
    translation: { id: "BSB" },
    book: { id: "GEN" },
    chapter: {
      number: 1,
      content: [
        verse(1, "Prose one.", false),
        verse(2, "Poem one;", true),
        verse(3, "Prose two.", false),
        verse(4, "Prose three.", false),
      ],
    },
  };
  await withBible({ "GEN/1": () => json(JSON.stringify(chapter)) }, async () => {
    const result = await hydrateScripture(ref("GEN", 1, 1, 4));
    assert(result.status === "verified");
    assertEquals(result.text, "Prose one.\nPoem one;\nProse two. Prose three.");
  });
});

Deno.test("when the chapter cannot be read the passage is unavailable, never invalid", async () => {
  const failures: [string, () => Response][] = [
    ["a server error", () => new Response("down", { status: 503 })],
    ["not found", () => new Response("no", { status: 404 })],
    ["not json", () => json("<html>maintenance</html>")],
    [
      "another translation",
      () => json(JSON.stringify({ ...JSON.parse(fixtureText("PSA_23")), translation: { id: "WEB" } })),
    ],
  ];
  for (const [what, serve] of failures) {
    await withBible({ "PSA/23": serve }, async () => {
      assertEquals(
        await hydrateScripture(ref("PSA", 23, 1, 2)),
        { status: "unavailable", ref: ref("PSA", 23, 1, 2), reference: "Psalm 23:1–2" },
        what,
      );
    });
  }
});

Deno.test("hydrating the same chapter twice asks the API once", async () => {
  await withBible(FIXTURES, async (calls) => {
    assert((await hydrateScripture(ref("PSA", 127, 1, 2))).status === "verified");
    assert((await hydrateScripture(ref("PSA", 127, 3, 3))).status === "verified");
    assertEquals(calls, ["PSA/127"]);
  });
});
