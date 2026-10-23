import { MAX_ATTEMPTS, newStats, timing } from "../../process-entry/gemini.ts";
import { OutputInvalid } from "../../process-entry/output.ts";
import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import {
  geminiError,
  geminiOk,
  type GeminiReply,
  installWorld,
  screenOutput,
  type World,
} from "../../process-entry/testing/fakes.ts";
import {
  type Asked,
  askModel,
  buildScreenSchema,
  interpret,
  parseScreening,
  SCREEN_SAFETY_SETTINGS,
  type ScreenConfig,
  screenEntry,
  type ScreenInput,
  screenTiming,
} from "./screen.ts";

const WRITTEN = "I have been so tired this week and I do not know how to rest.";
const text: ScreenInput = { kind: "text", text: WRITTEN };
const audio: ScreenInput = { kind: "audio", bytes: new Uint8Array([1, 2, 3, 4]) };

function config(over: Partial<ScreenConfig> = {}): ScreenConfig {
  return {
    apiKey: "test-gemini-key",
    model: "gemini-test-model",
    thinkingLevel: "low",
    deadlineAt: Date.now() + 60_000,
    stats: newStats(),
    ...over,
  };
}

function withWorld(replies: GeminiReply[], work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const saved = { ...timing };
    const savedScreen = { ...screenTiming };
    timing.retryBackoffMs = 1;
    world.screenQueue.push(...replies);
    try {
      await work(world);
    } finally {
      Object.assign(timing, saved);
      Object.assign(screenTiming, savedScreen);
      world.restore();
    }
  };
}

// The same reply for every attempt a call may make (an empty screening queue answers "clear", so a failure must fill it).
const everyAttempt = (reply: GeminiReply): GeminiReply[] => Array.from({ length: MAX_ATTEMPTS }, () => reply);

const verdict = (
  over: Partial<{ noSpeech: boolean; transcript: string; risk: "none" | "uncertain" | "crisis" }> = {},
): Asked => ({
  kind: "verdict",
  verdict: { noSpeech: false, transcript: "", risk: "none", ...over },
});

function invalid(value: unknown, kind: "text" | "audio", reason: string) {
  try {
    parseScreening(typeof value === "string" ? value : JSON.stringify(value), kind);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    return;
  }
  throw new Error(`expected "${reason}" but the reply was accepted`);
}

Deno.test("the five adjustable filters are all turned off, and nothing else is set", () => {
  assertEquals(SCREEN_SAFETY_SETTINGS, [
    { type: "harassment", threshold: "off" },
    { type: "hate_speech", threshold: "off" },
    { type: "sexually_explicit", threshold: "off" },
    { type: "dangerous_content", threshold: "off" },
    { type: "jailbreak", threshold: "off" },
  ]);
});

Deno.test("the schema uses only the keywords Google lists, every property is required, and the transcript comes first", () => {
  const schema = buildScreenSchema() as {
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
  assertEquals(Object.keys(schema.properties), ["no_speech", "transcript", "risk", "categories"]);
  assertEquals(schema.required, Object.keys(schema.properties));
  assertEquals(schema.properties.risk, { type: "string", enum: ["none", "uncertain", "crisis"] });
  const categories = schema.properties.categories as { items: { enum: string[] }; maxItems: number };
  assertEquals(categories.items.enum, [
    "self_harm",
    "suicide",
    "harm_to_others",
    "abuse_or_danger_now",
    "medical_emergency",
  ]);
  assertEquals(categories.maxItems, 5);
  const allowed = new Set(["type", "properties", "required", "items", "maxItems", "enum", "description"]);
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(node)) continue;
      assert(allowed.has(key) || key in schema.properties, `unsupported schema keyword: ${key}`);
      walk(value);
    }
  };
  walk(schema);
});

Deno.test("parseScreening reads a good reply, trims the transcript and accepts a code fence", () => {
  assertEquals(
    parseScreening(JSON.stringify(screenOutput({ transcript: "  I am here.  " })), "audio"),
    { noSpeech: false, transcript: "I am here.", risk: "none" },
  );
  assertEquals(
    parseScreening(
      "```json\n" + JSON.stringify(screenOutput({ risk: "crisis", categories: ["suicide"] })) + "\n```",
      "text",
    ),
    { noSpeech: false, transcript: "", risk: "crisis" },
  );
  // Silence: no speech, no words.
  assertEquals(parseScreening(JSON.stringify(screenOutput({ no_speech: true })), "audio"), {
    noSpeech: true,
    transcript: "",
    risk: "none",
  });
});

Deno.test("parseScreening refuses a reply it cannot trust", () => {
  invalid("not json", "text", "json");
  invalid([], "text", "shape");
  invalid("null", "text", "shape");
  invalid({ ...screenOutput(), no_speech: "no" }, "text", "no_speech");
  invalid({ ...screenOutput(), transcript: null }, "text", "transcript");
  invalid({ ...screenOutput(), risk: "maybe" }, "text", "risk");
  invalid({ ...screenOutput(), risk: "CRISIS" }, "text", "risk");
  invalid({ ...screenOutput(), risk: undefined }, "text", "risk");
  invalid({ ...screenOutput(), categories: "self_harm" }, "text", "categories");
  invalid({ ...screenOutput(), categories: ["self_harm", "something_else"] }, "text", "categories");
  invalid({ ...screenOutput(), categories: Array(6).fill("suicide") }, "text", "categories");
  invalid({ ...screenOutput(), categories: undefined }, "text", "categories");
  invalid({ ...screenOutput(), transcript: "a".repeat(20_001) }, "audio", "transcript_long");
});

Deno.test("a recording judged none must agree with itself; one that flags a risk is accepted whatever else it says", () => {
  // Speech is words and silence is none.
  invalid(screenOutput({ no_speech: true, transcript: "but here are words" }), "audio", "no_speech_with_words");
  invalid(screenOutput({ no_speech: false, transcript: "   " }), "audio", "transcript_empty");
  // The same contradictions mean nothing for a written entry, which is its own transcript.
  assertEquals(parseScreening(JSON.stringify(screenOutput({ no_speech: true, transcript: "x" })), "text").risk, "none");
  // A crisis is a crisis even if the rest is a mess.
  for (const risk of ["crisis", "uncertain"]) {
    const parsed = parseScreening(JSON.stringify(screenOutput({ risk, no_speech: false, transcript: "" })), "audio");
    assertEquals(parsed.risk, risk);
  }
  const confused = parseScreening(
    JSON.stringify(screenOutput({ risk: "crisis", no_speech: true, transcript: "words" })),
    "audio",
  );
  assertEquals(confused.risk, "crisis");
});

Deno.test("interpret: a failure is a failure, with its reason, and never a clear", () => {
  assertEquals(interpret(text, { kind: "failed", reason: "gemini_http_503" }), {
    status: "failed",
    reason: "gemini_http_503",
  });
  assertEquals(interpret(audio, { kind: "failed", reason: "gemini_network" }), {
    status: "failed",
    reason: "gemini_network",
  });
});

Deno.test("interpret: a block is a crisis; a written entry keeps its words and a recording has none", () => {
  assertEquals(interpret(text, { kind: "blocked" }), { status: "crisis", transcript: WRITTEN, source: "blocked" });
  assertEquals(interpret(audio, { kind: "blocked" }), { status: "crisis", transcript: null, source: "blocked" });
});

Deno.test("interpret: crisis and uncertain are crises, and the words are the person's own for text, the transcript for audio", () => {
  assertEquals(interpret(text, verdict({ risk: "crisis", transcript: "the model wrote this" })), {
    status: "crisis",
    transcript: WRITTEN,
    source: "model",
  });
  assertEquals(interpret(text, verdict({ risk: "uncertain" })), {
    status: "crisis",
    transcript: WRITTEN,
    source: "uncertain",
  });
  assertEquals(interpret(audio, verdict({ risk: "crisis", transcript: "heard words" })), {
    status: "crisis",
    transcript: "heard words",
    source: "model",
  });
  assertEquals(interpret(audio, verdict({ risk: "uncertain", transcript: "heard words" })), {
    status: "crisis",
    transcript: "heard words",
    source: "uncertain",
  });
  // Nothing was heard but a risk was flagged: still a crisis, with no words.
  assertEquals(interpret(audio, verdict({ risk: "crisis", noSpeech: true })), {
    status: "crisis",
    transcript: null,
    source: "model",
  });
});

Deno.test("interpret: none is no_speech for silence, a phrase for the backstop, and clear otherwise", () => {
  assertEquals(interpret(audio, verdict({ noSpeech: true })), { status: "no_speech" });
  assertEquals(interpret(audio, verdict({ transcript: "I am grateful for today." })), {
    status: "clear",
    transcript: "I am grateful for today.",
  });
  assertEquals(interpret(audio, verdict({ transcript: "Honestly, I want to die." })), {
    status: "crisis",
    transcript: "Honestly, I want to die.",
    source: "phrase",
  });
  assertEquals(interpret(text, verdict({ transcript: "ignored, and so is this: I want to die" })), {
    status: "clear",
    transcript: WRITTEN,
  });
  // A recording judged none with speech but no words cannot be read: it is not clear.
  assertEquals(interpret(audio, verdict({ transcript: "" })), { status: "failed", reason: "no_words" });
});

Deno.test(
  "screenEntry: a phrase in a written entry is decided without the model",
  withWorld([], async (world) => {
    const stats = newStats();
    const result = await screenEntry({ kind: "text", text: "I just want to die." }, config({ stats }));
    assertEquals(result, { status: "crisis", transcript: "I just want to die.", source: "phrase" });
    assertEquals(world.screenCalls.length, 0);
    assertEquals(stats.attempts, 0);
  }),
);

Deno.test(
  "screenEntry: a written entry the model calls none is clear, in one attempt, and its tokens are counted",
  withWorld([geminiOk(screenOutput(), { in: 11, out: 22, thought: 33 })], async (world) => {
    const stats = newStats();
    assertEquals(await screenEntry(text, config({ stats })), { status: "clear", transcript: WRITTEN });
    assertEquals(world.screenCalls.length, 1);
    assertEquals(stats.attempts, 1);
    assertEquals(stats.usage, { input: 11, output: 22, thought: 33 });
  }),
);

Deno.test(
  "screenEntry: a recording is sent as audio and its transcript comes back",
  withWorld([geminiOk(screenOutput({ transcript: "I am grateful for today." }))], async (world) => {
    assertEquals(await screenEntry(audio, config()), { status: "clear", transcript: "I am grateful for today." });
    const input = (world.screenCalls[0].json as { input: { type: string; mime_type?: string }[] }).input;
    assertEquals(input.map((part) => part.type), ["text", "audio"]);
    assertEquals(input[1].mime_type, "audio/m4a");
  }),
);

Deno.test(
  "screenEntry: risk crisis, uncertain and a block all come back as a crisis with their source",
  withWorld(
    [
      geminiOk(screenOutput({ risk: "crisis", categories: ["self_harm"] })),
      geminiOk(screenOutput({ risk: "uncertain", categories: ["suicide"] })),
      geminiError(400, { error: { code: "prohibited_content", message: "Input blocked: x" } }),
    ],
    async (world) => {
      const sources: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const result = await screenEntry(text, config());
        assert(result.status === "crisis");
        assertEquals(result.transcript, WRITTEN);
        sources.push(result.source);
      }
      assertEquals(sources, ["model", "uncertain", "blocked"]);
      assertEquals(world.screenCalls.length, 3, "a block is not retried");
    },
  ),
);

Deno.test(
  "screenEntry: a busy service is tried once more, and a second failure is a failure with its reason",
  withWorld([geminiError(429), geminiOk(screenOutput())], async (world) => {
    const stats = newStats();
    assertEquals(await screenEntry(text, config({ stats })), { status: "clear", transcript: WRITTEN });
    assertEquals(world.screenCalls.length, 2);
    assertEquals(stats.attempts, 2);
  }),
);

Deno.test(
  "screenEntry: a busy service is tried up to four times, and then it is a failure; nothing is made up",
  withWorld(everyAttempt(geminiError(503)), async (world) => {
    const result = await screenEntry(text, config());
    assertEquals(result.status, "failed");
    assertEquals(world.screenCalls.length, MAX_ATTEMPTS);
    assert(result.status === "failed" && result.reason.startsWith("gemini_http_503"));
  }),
);

Deno.test(
  "screenEntry: the fallback model screens every second attempt, with the same instruction and safety settings",
  withWorld(
    [geminiError(503), geminiOk(screenOutput({ risk: "uncertain", categories: ["suicide"] }))],
    async (world) => {
      const stats = newStats();
      const result = await screenEntry(text, config({ fallbackModel: "gemini-fallback-model", stats }));
      assertEquals(result, { status: "crisis", transcript: WRITTEN, source: "uncertain" });
      const [first, second] = world.screenCalls.map((call) => call.json as Record<string, unknown>);
      assertEquals([first.model, second.model], ["gemini-test-model", "gemini-fallback-model"]);
      assertEquals(second.safety_settings, SCREEN_SAFETY_SETTINGS);
      assertEquals({ ...second, model: null }, { ...first, model: null });
      assertEquals([stats.attempts, stats.fallbackAttempts], [2, 1]);
    },
  ),
);

Deno.test(
  "screenEntry: a reply that fails the checks is asked for once more, then it is a failure",
  withWorld(
    [geminiOk({ no_speech: false, transcript: "", risk: "none" }), geminiOk(screenOutput({ risk: "calm" }))],
    async (world) => {
      const result = await screenEntry(text, config());
      assert(result.status === "failed" && result.reason === "output_invalid:risk");
      assertEquals(world.screenCalls.length, 2);
    },
  ),
);

Deno.test(
  "screenEntry: a request Google rejects as a bad request is not a crisis and is not retried",
  withWorld([geminiError(400, { error: { code: "invalid_request", message: "bad" } })], async (world) => {
    const result = await screenEntry(text, config());
    assert(result.status === "failed" && result.reason === "gemini_http_400:invalid_request");
    assertEquals(world.screenCalls.length, 1);
  }),
);

Deno.test(
  "screenEntry: the attempt timeout is the screening's own, and the deadline is the one it is given",
  withWorld(everyAttempt({ kind: "hang" }), async (world) => {
    screenTiming.attemptTimeoutMs = 30;
    const started = Date.now();
    const result = await screenEntry(text, config());
    assert(result.status === "failed" && result.reason === "gemini_timeout");
    assert(Date.now() - started < 5_000, "ended by the short timeout, not the reflection's 45 s");
    assertEquals(world.screenCalls.length, MAX_ATTEMPTS);

    // With no time left the model is not asked at all, and that is a failure too.
    const stats = newStats();
    const late = await screenEntry(text, config({ stats, deadlineAt: Date.now() + 100 }));
    assertEquals(late, { status: "failed", reason: "gemini_budget" });
    assertEquals(stats.attempts, 0);
    assertEquals(world.screenCalls.length, MAX_ATTEMPTS);
  }),
);

Deno.test(
  "askModel: sends the settings, the key in a header and the screening model, never stored",
  withWorld([geminiOk(screenOutput())], async (world) => {
    const asked = await askModel(text, config({ model: "gemini-screen-model", thinkingLevel: "medium" }));
    assertEquals(asked.kind, "verdict");
    const call = world.screenCalls[0];
    const body = call.json as Record<string, unknown>;
    assertEquals(body.model, "gemini-screen-model");
    assertEquals(body.store, false);
    assertEquals((body.generation_config as Record<string, unknown>).thinking_level, "medium");
    assertEquals(body.safety_settings, SCREEN_SAFETY_SETTINGS);
    assertEquals(call.headers.get("x-goog-api-key"), "test-gemini-key");
    assert(!call.text.includes("test-gemini-key"));
  }),
);
