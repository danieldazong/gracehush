import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import type { UsfmBookId } from "./books.ts";
import {
  BIBLE_API_BASE,
  bibleTiming,
  CHAPTER_CACHE_SIZE,
  clearChapterCache,
  fetchChapter,
  MAX_RESPONSE_BYTES,
  parseChapter,
  tidyVerse,
} from "./helloao.ts";

// Real chapters from bible.helloao.org/api/BSB/{ID}/{n}.simple.json, trimmed to their verses (fixtures/).
const fixtureText = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.simple.json`, import.meta.url));
const fixtureJson = (name: string) => JSON.parse(fixtureText(name));

const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "Content-Type": "application/json" }, ...init });

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

// Runs `work` with fetch replaced, a fresh cache and short waits; returns the URLs that were asked for.
async function withFetch(handler: Handler, work: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const saved = { ...bibleTiming };
  const calls: string[] = [];
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    calls.push(request.url);
    return Promise.resolve(handler(new URL(request.url), init));
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

const serveFixture = (name: string): Handler => () => json(fixtureText(name));

Deno.test("tidyVerse repairs the spacing the simplified format gets wrong, and nothing else (real verses)", () => {
  const pairs: [string, string, string][] = [
    [
      "a word glued on after Selah (PSA 44:8)",
      "and Your name we will praise forever.Selah",
      "and Your name we will praise forever. Selah",
    ],
    ["Selah after a closing quote (PSA 3:2)", "“God will not deliver him.”Selah", "“God will not deliver him.” Selah"],
    [
      "declares after a closing quote (JER 2:19)",
      "and to have no fear of Me,”declares the Lord GOD of Hosts.",
      "and to have no fear of Me,” declares the Lord GOD of Hosts.",
    ],
    [
      "a refrain glued on (PSA 136:15)",
      "into the Red Sea.His loving devotion endures forever.",
      "into the Red Sea. His loving devotion endures forever.",
    ],
    [
      "a closing quote on its own line (GEN 3:15)",
      "and you will strike his heel.\n”",
      "and you will strike his heel.”",
    ],
    [
      "a space before a closing quote (GEN 12:7)",
      "to your offspring. ” So Abram built",
      "to your offspring.” So Abram built",
    ],
    ["a question mark on its own line (JOB 6:6)", "the white of an egg\n?", "the white of an egg?"],
    ["a closing single quote on its own line (JER 48:6)", "in the desert.\n’", "in the desert.’"],
    [
      "a lone quote between two lines (JER 49:6)",
      "from captivity,\n”\ndeclares the LORD.",
      "from captivity,”\ndeclares the LORD.",
    ],
    ["a space before a question mark (MAT 22:32)", "the God of Jacob’ ? He is not", "the God of Jacob’? He is not"],
    ["a space before a bracket (GEN 14:3)", "(that is, the Salt Sea ).", "(that is, the Salt Sea)."],
    [
      "a speaker label glued on (SNG 1:4)",
      "May the king bring me to his chambers.The Friends\nWe will rejoice and delight in you;",
      "May the king bring me to his chambers. The Friends\nWe will rejoice and delight in you;",
    ],
  ];
  for (const [what, raw, expected] of pairs) assertEquals(tidyVerse(raw), expected, what);
});

Deno.test("tidyVerse leaves good text exactly as it is, line breaks included", () => {
  const good = [
    "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God.",
    "He restores my soul;\nHe guides me in the paths of righteousness\nfor the sake of His name.",
    "God called the light “day,” and the darkness He called “night.”\nAnd there was evening, and there was morning—the first day.",
    "Am I my brother’s keeper?” “Where is your brother Abel?”",
    "In the beginning God created the heavens and the earth.",
  ];
  for (const text of good) assertEquals(tidyVerse(text), text);
  // Running it twice changes nothing more.
  for (const raw of ["peace.Selah", "heel.\n”", "offspring. ”"]) {
    assertEquals(tidyVerse(tidyVerse(raw)), tidyVerse(raw));
  }
});

Deno.test("tidyVerse never changes a letter or a mark", () => {
  const strip = (text: string) => text.replace(/\s+/g, "");
  const raw = "Me,”declares the LORD.\n?Selah heel.\n” offspring. ” Sea ).His love";
  assertEquals(strip(tidyVerse(raw)), strip(raw));
});

Deno.test("parseChapter reads the verses of a real chapter, and whether each is poetry", () => {
  const prose = parseChapter(fixtureJson("PHP_4"), "PHP", 4);
  assert(prose !== null);
  assertEquals(prose.size, 23);
  assertEquals(
    prose.get(6),
    {
      text:
        "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God.",
      poetic: false,
    },
  );
  const psalm = parseChapter(fixtureJson("PSA_23"), "PSA", 23);
  assert(psalm !== null);
  assertEquals(psalm.size, 6);
  assertEquals(psalm.get(1), { text: "The LORD is my shepherd;\nI shall not want.", poetic: true });
});

Deno.test("parseChapter refuses a reply that is not the chapter that was asked for", () => {
  const good = fixtureJson("PHP_4");
  assertEquals(parseChapter(good, "PHP", 3), null, "another chapter");
  assertEquals(parseChapter(good, "PHM", 4), null, "another book");
  assertEquals(parseChapter({ ...good, translation: { id: "KJV" } }, "PHP", 4), null, "another translation");
  assertEquals(parseChapter({ ...good, translation: {} }, "PHP", 4), null);
  assertEquals(parseChapter({ ...good, chapter: { number: 4 } }, "PHP", 4), null, "no content");
  assertEquals(parseChapter({ ...good, chapter: { number: 4, content: [] } }, "PHP", 4), null, "no verses");
  for (const bad of [null, "text", 7, [], {}]) assertEquals(parseChapter(bad, "PHP", 4), null);
  const doubled = { ...good, chapter: { number: 4, content: [...good.chapter.content, good.chapter.content[0]] } };
  assertEquals(parseChapter(doubled, "PHP", 4), null, "a verse listed twice");
  const oddNumber = { ...good, chapter: { number: 4, content: [{ type: "verse", number: 0, text: "x" }] } };
  assertEquals(parseChapter(oddNumber, "PHP", 4), null, "verse number 0");
});

Deno.test("parseChapter treats a verse with no text as absent, and skips what is not a verse", () => {
  const reply = {
    translation: { id: "BSB" },
    book: { id: "PHP" },
    chapter: {
      number: 4,
      content: [
        { type: "heading", text: "Rejoice in the Lord" },
        { type: "line_break" },
        { type: "verse", number: 1, text: "First verse." },
        { type: "verse", number: 2, text: "   " },
        { type: "verse", number: 3, text: "Third verse." },
      ],
    },
  };
  const verses = parseChapter(reply, "PHP", 4);
  assert(verses !== null);
  assertEquals([...verses.keys()], [1, 3]);
});

Deno.test("fetchChapter asks the simplified BSB endpoint for exactly that chapter", async () => {
  await withFetch(serveFixture("PHP_4"), async (calls) => {
    const result = await fetchChapter("PHP", 4);
    assert(result.ok);
    assertEquals(calls, [`${BIBLE_API_BASE}/BSB/PHP/4.simple.json`]);
    assertEquals(result.verses.size, 23);
  });
});

Deno.test("a chapter that was read once is not fetched again", async () => {
  await withFetch(serveFixture("PSA_23"), async (calls) => {
    assert((await fetchChapter("PSA", 23)).ok);
    assert((await fetchChapter("PSA", 23)).ok);
    assertEquals(calls.length, 1);
  });
});

Deno.test("a chapter the API does not have is NOT_FOUND, with no second try", async () => {
  await withFetch(() => new Response("Not Found", { status: 404 }), async (calls) => {
    assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "NOT_FOUND" });
    assertEquals(calls.length, 1);
  });
});

Deno.test("a server error is tried once more: good the second time is fine, bad twice is TRANSIENT", async () => {
  let n = 0;
  await withFetch(
    () => (n += 1) === 1 ? new Response("busy", { status: 503 }) : json(fixtureText("PSA_23")),
    async (calls) => {
      assert((await fetchChapter("PSA", 23)).ok);
      assertEquals(calls.length, 2);
    },
  );
  await withFetch(() => new Response("busy", { status: 503 }), async (calls) => {
    assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "TRANSIENT" });
    assertEquals(calls.length, 2);
  });
  await withFetch(() => new Response("slow down", { status: 429 }), async (calls) => {
    assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "TRANSIENT" });
    assertEquals(calls.length, 2);
  });
});

Deno.test("a dropped connection and a request that never answers are TRANSIENT after one more try", async () => {
  await withFetch(() => Promise.reject(new TypeError("network down")), async (calls) => {
    assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "TRANSIENT" });
    assertEquals(calls.length, 2);
  });
  const hangs: Handler = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  await withFetch(hangs, async (calls) => {
    bibleTiming.requestTimeoutMs = 25;
    const started = Date.now();
    assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "TRANSIENT" });
    assertEquals(calls.length, 2);
    assert(Date.now() - started < 2_000, "the timeout ended each try");
  });
});

Deno.test("a reply that is not the chapter is INVALID and is not tried again", async () => {
  const cases: [string, Handler][] = [
    ["html", () => json("<html>maintenance</html>")],
    ["another translation", () => json(JSON.stringify({ ...fixtureJson("PSA_23"), translation: { id: "WEB" } }))],
    ["another chapter", () => json(fixtureText("PSA_127"))],
    ["a 403", () => new Response("denied", { status: 403 })],
    [
      "too big, said by its header",
      () => json("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
    ],
    ["too big, found by reading it", () => json(" ".repeat(MAX_RESPONSE_BYTES + 1))],
  ];
  for (const [what, handler] of cases) {
    await withFetch(handler, async (calls) => {
      assertEquals(await fetchChapter("PSA", 23), { ok: false, kind: "INVALID" }, what);
      assertEquals(calls.length, 1, what);
    });
  }
});

Deno.test("only a good chapter is kept: a failure is asked for again next time", async () => {
  let n = 0;
  await withFetch(
    () => (n += 1) <= 2 ? new Response("down", { status: 500 }) : json(fixtureText("PSA_23")),
    async (calls) => {
      assertEquals((await fetchChapter("PSA", 23)).ok, false);
      assert((await fetchChapter("PSA", 23)).ok);
      assertEquals(calls.length, 3);
    },
  );
});

Deno.test("the cache holds 64 chapters and lets the least recently used go", async () => {
  const chapterFor: Handler = (url) => {
    const match = /\/BSB\/([^/]+)\/(\d+)\.simple\.json$/.exec(url.pathname);
    if (!match) return new Response("?", { status: 404 });
    return json(JSON.stringify({
      translation: { id: "BSB" },
      book: { id: match[1] },
      chapter: { number: Number(match[2]), content: [{ type: "verse", number: 1, text: "One." }] },
    }));
  };
  await withFetch(chapterFor, async (calls) => {
    const wanted: [UsfmBookId, number][] = [];
    for (let chapter = 1; chapter <= 50; chapter += 1) wanted.push(["GEN", chapter]);
    for (let chapter = 1; chapter <= CHAPTER_CACHE_SIZE - 50 + 1; chapter += 1) wanted.push(["EXO", chapter]);
    assertEquals(wanted.length, CHAPTER_CACHE_SIZE + 1);
    for (const [book, chapter] of wanted) assert((await fetchChapter(book, chapter)).ok);
    assertEquals(calls.length, CHAPTER_CACHE_SIZE + 1);

    // The newest are still there; the first one was pushed out.
    const [lastBook, lastChapter] = wanted[wanted.length - 1];
    assert((await fetchChapter(lastBook, lastChapter)).ok);
    assertEquals(calls.length, CHAPTER_CACHE_SIZE + 1);
    assert((await fetchChapter("GEN", 1)).ok);
    assertEquals(calls.length, CHAPTER_CACHE_SIZE + 2);
  });
});
