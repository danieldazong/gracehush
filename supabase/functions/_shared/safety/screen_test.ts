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
  phraseVerdict,
  SCREEN_SAFETY_SETTINGS,
  type ScreenConfig,
  screenEntry,
  type ScreenInput,
  screenTiming,
  type Verdict,
} from "./screen.ts";
import { HELP_KINDS, helpFromCategories, helpFromPhraseGroup, isHelpKind, regionOf } from "./helpKind.ts";
import { SCREEN_AUDIO_TURN, SCREEN_PROMPT_VERSION, SCREEN_SYSTEM_INSTRUCTION } from "./screenPrompt.ts";
import { SCREEN_AUDIO_TURN_V1, SCREEN_SYSTEM_INSTRUCTION_V1 } from "./eval/screen_prompt_v1.ts";

const WRITTEN = "I have been so tired this week and I do not know how to rest.";

// ---- screen-v2 (step 36): the transcription rule is stronger; screen-v3 (2026-11-11): the categories say what they mean ----

const TRANSCRIPTION_V2 =
  `For audio, first transcribe exactly what was said, word for word, into transcript: in the language and dialect spoken, keeping non-English words, repetitions, false starts and filler words as they were said. Never translate, summarize, tidy the grammar or guess a word: write [unclear] for a word you cannot make out. If there is no intelligible speech, set no_speech to true, transcript to "", risk to "none" and categories to an empty list. For a written entry set no_speech to false and transcript to "".`;

Deno.test("screen-v4: the transcription rule is screen-v2's, word for word", () => {
  assertEquals(SCREEN_PROMPT_VERSION, "screen-v4");
  const paragraphs = SCREEN_SYSTEM_INSTRUCTION.split("\n\n");
  assertEquals(paragraphs.filter((paragraph) => paragraph.startsWith("For audio,")), [TRANSCRIPTION_V2]);
  assertEquals(
    SCREEN_AUDIO_TURN,
    "Transcribe the attached spoken journal entry exactly as it was said, word for word, then classify it.",
  );
  assert(String(SCREEN_AUDIO_TURN) !== String(SCREEN_AUDIO_TURN_V1));
});

const CATEGORIES_V3 =
  `In categories, list each kind of concern you see: self_harm (thoughts of harming themselves, or harm they have done to themselves), suicide (thoughts or plans of ending their life), harm_to_others (an intention to harm another person), abuse_or_danger_now (someone is harming them, or puts them in danger now), medical_emergency (someone needs urgent medical help right now: a medical emergency, or harm already done to the person or to someone else that may need care now). Leave it empty when risk is "none".`;

Deno.test("screen-v3: the categories paragraph says what each kind of concern means, harm already done among them", () => {
  const paragraphs = SCREEN_SYSTEM_INSTRUCTION.split("\n\n");
  assertEquals(paragraphs.filter((paragraph) => paragraph.startsWith("In categories,")), [CATEGORIES_V3]);
  // Each of the five kinds the schema allows is named, once, with its meaning.
  for (const kind of ["self_harm", "suicide", "harm_to_others", "abuse_or_danger_now", "medical_emergency"]) {
    assertEquals(CATEGORIES_V3.split(`${kind} (`).length - 1, 1, kind);
  }
  assert(CATEGORIES_V3.includes("harm already done"), "harm already done is a medical emergency");
});

// screen-v4 (2026-11-11, the readers' answers): very recent abuse or violence is a crisis, and the model names the help line.
const CRISIS_V4 =
  `Set risk to "crisis" when the entry suggests any of these: thoughts or plans of suicide or self-harm, current or very recent; an intention to harm another person; abuse or violence happening now or very recently, or a person in danger now; a medical emergency happening now.`;

const HELP_LINE_V4 =
  `In help_line, name the one help line that fits the person best when risk is not "none": emergency when someone needs urgent help this moment, such as a medical emergency, harm already done that may need care now, or an attack happening now; abuse when another person is harming them or someone in their care, threatens them, or has very recently assaulted them; harm_others when they may harm another person; crisis for thoughts of ending their life or of self-harm, for fear that someone they love may end their life, and whenever none of these clearly fits. Choose emergency over every other line when it fits. Set it to "none" when risk is "none".`;

Deno.test("screen-v4: very recent abuse or violence is a crisis, and that is the only change to the risk rules", () => {
  const paragraphs = SCREEN_SYSTEM_INSTRUCTION.split("\n\n");
  assertEquals(paragraphs.filter((paragraph) => paragraph.startsWith('Set risk to "crisis"')), [CRISIS_V4]);
  const v1 = SCREEN_SYSTEM_INSTRUCTION_V1.split("\n\n").find((paragraph) =>
    paragraph.startsWith('Set risk to "crisis"')
  );
  // The words "or very recently" after "abuse or violence happening now" are the whole change.
  assertEquals(v1, CRISIS_V4.replace("happening now or very recently,", "happening now,"));
});

Deno.test("screen-v4: the help line is named by the readers' table, with emergency first", () => {
  const paragraphs = SCREEN_SYSTEM_INSTRUCTION.split("\n\n");
  assertEquals(paragraphs.filter((paragraph) => paragraph.startsWith("In help_line,")), [HELP_LINE_V4]);
  // It comes right after the categories, so the model names the line after the kinds of concern.
  assertEquals(paragraphs.indexOf(HELP_LINE_V4), paragraphs.indexOf(CATEGORIES_V3) + 1);
  // Each of the four lines is named once with what it is for, and none when risk is none.
  const leads: Record<string, string> = {
    emergency: "emergency when",
    abuse: "abuse when",
    harm_others: "harm_others when",
    crisis: "crisis for",
  };
  assertEquals(Object.keys(leads).sort(), [...HELP_KINDS].sort());
  for (const kind of HELP_KINDS) assertEquals(HELP_LINE_V4.split(leads[kind]).length - 1, 1, kind);
  assert(HELP_LINE_V4.includes("Choose emergency over every other line when it fits."));
  assert(HELP_LINE_V4.includes('Set it to "none" when risk is "none".'));
  // The two cases the readers' answers were about: a recent assault is abuse, a parent's fear for their child is the 988 line.
  assert(HELP_LINE_V4.includes("has very recently assaulted them"));
  assert(HELP_LINE_V4.includes("for fear that someone they love may end their life"));
});

Deno.test("screen-v4: every other paragraph is screen-v1's, word for word, in the same place", () => {
  const now = SCREEN_SYSTEM_INSTRUCTION.split("\n\n").filter((paragraph) => paragraph !== HELP_LINE_V4);
  const before = SCREEN_SYSTEM_INSTRUCTION_V1.split("\n\n");
  assertEquals(now.length, before.length);
  let changed = 0;
  for (let index = 0; index < now.length; index += 1) {
    if (now[index] === before[index]) continue;
    changed += 1;
    // Only the transcription paragraph (screen-v2), the categories paragraph (screen-v3) and the crisis rule (screen-v4) may
    // differ, each where it was.
    assert(
      ["For audio,", "In categories,", 'Set risk to "crisis"'].some((start) =>
        before[index].startsWith(start) && now[index].startsWith(start)
      ),
      now[index],
    );
  }
  assertEquals(changed, 3);
  // The other classification rules themselves, named one by one.
  for (const start of ['Set risk to "uncertain"', 'Set risk to "none"', "When you are unsure"]) {
    const rule = now.find((paragraph) => paragraph.startsWith(start));
    assert(rule !== undefined && before.includes(rule), start);
  }
});
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

const verdict = (over: Partial<Verdict> = {}): Asked => ({
  kind: "verdict",
  verdict: { noSpeech: false, transcript: "", risk: "none", categories: [], help: null, ...over },
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
  assertEquals(Object.keys(schema.properties), ["no_speech", "transcript", "risk", "categories", "help_line"]);
  // screen-v4: the help line, named after the kinds of concern, one of the four or none.
  assertEquals(schema.properties.help_line.enum, ["none", "crisis", "abuse", "harm_others", "emergency"]);
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
    { noSpeech: false, transcript: "I am here.", risk: "none", categories: [], help: null },
  );
  assertEquals(
    parseScreening(
      "```json\n" + JSON.stringify(screenOutput({ risk: "crisis", categories: ["suicide"] })) + "\n```",
      "text",
    ),
    { noSpeech: false, transcript: "", risk: "crisis", categories: ["suicide"], help: null },
  );
  // Silence: no speech, no words.
  assertEquals(parseScreening(JSON.stringify(screenOutput({ no_speech: true })), "audio"), {
    noSpeech: true,
    transcript: "",
    risk: "none",
    categories: [],
    help: null,
  });
});

Deno.test("parseScreening reads the help line the model named, and a missing, none or unknown one as no line", () => {
  const help = (value: unknown) =>
    parseScreening(JSON.stringify(screenOutput({ risk: "crisis", categories: ["suicide"], help_line: value })), "text")
      .help;
  for (const kind of HELP_KINDS) assertEquals(help(kind), kind);
  for (const value of ["none", "shelter", "CRISIS", "", 3, null, undefined]) {
    assertEquals(help(value), null, String(value));
  }
  // A reply that flags a risk is never refused over its help line.
  assertEquals(
    parseScreening(JSON.stringify(screenOutput({ risk: "uncertain", help_line: "rainn" })), "text").risk,
    "uncertain",
  );
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
  assertEquals(interpret(text, { kind: "blocked" }), {
    status: "crisis",
    transcript: WRITTEN,
    source: "blocked",
    help: "crisis",
  });
  assertEquals(interpret(audio, { kind: "blocked" }), {
    status: "crisis",
    transcript: null,
    source: "blocked",
    help: "crisis",
  });
});

Deno.test("interpret: crisis and uncertain are crises, and the words are the person's own for text, the transcript for audio", () => {
  assertEquals(interpret(text, verdict({ risk: "crisis", transcript: "the model wrote this" })), {
    status: "crisis",
    transcript: WRITTEN,
    source: "model",
    help: "crisis",
  });
  assertEquals(interpret(text, verdict({ risk: "uncertain" })), {
    status: "crisis",
    transcript: WRITTEN,
    source: "uncertain",
    help: "crisis",
  });
  assertEquals(interpret(audio, verdict({ risk: "crisis", transcript: "heard words" })), {
    status: "crisis",
    transcript: "heard words",
    source: "model",
    help: "crisis",
  });
  assertEquals(interpret(audio, verdict({ risk: "uncertain", transcript: "heard words" })), {
    status: "crisis",
    transcript: "heard words",
    source: "uncertain",
    help: "crisis",
  });
  // Nothing was heard but a risk was flagged: still a crisis, with no words.
  assertEquals(interpret(audio, verdict({ risk: "crisis", noSpeech: true })), {
    status: "crisis",
    transcript: null,
    source: "model",
    help: "crisis",
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
    help: "crisis",
  });
  assertEquals(interpret(text, verdict({ transcript: "ignored, and so is this: I want to die" })), {
    status: "clear",
    transcript: WRITTEN,
  });
  // A recording judged none with speech but no words cannot be read: it is not clear.
  assertEquals(interpret(audio, verdict({ transcript: "" })), { status: "failed", reason: "no_words" });
});

Deno.test("helpFromCategories: the most urgent kind the screening named wins, and nothing named is the 988 line", () => {
  assertEquals(helpFromCategories([]), "crisis");
  assertEquals(helpFromCategories(["suicide"]), "crisis");
  assertEquals(helpFromCategories(["self_harm", "suicide"]), "crisis");
  assertEquals(helpFromCategories(["harm_to_others"]), "harm_others");
  assertEquals(helpFromCategories(["suicide", "harm_to_others"]), "harm_others");
  assertEquals(helpFromCategories(["abuse_or_danger_now"]), "abuse");
  assertEquals(helpFromCategories(["harm_to_others", "abuse_or_danger_now", "suicide"]), "abuse");
  assertEquals(helpFromCategories(["medical_emergency"]), "emergency");
  assertEquals(helpFromCategories(["abuse_or_danger_now", "medical_emergency"]), "emergency");
  assertEquals(helpFromCategories(["something_new"]), "crisis");
  assertEquals(helpFromPhraseGroup("self"), "crisis");
  assertEquals(helpFromPhraseGroup("others"), "harm_others");
  assertEquals([...HELP_KINDS], ["crisis", "abuse", "harm_others", "emergency"]);
  for (const kind of HELP_KINDS) assert(isHelpKind(kind), kind);
  for (const value of ["shelter", "", "CRISIS", null, 3, undefined]) assert(!isHelpKind(value), String(value));
});

Deno.test("regionOf: the US and its territories are the US; any other region is not; a region it cannot read is the US", () => {
  for (const code of ["US", "us", "PR", "GU", "VI", "AS", "MP", "UM"]) assertEquals(regionOf(code), "us", code);
  for (const code of ["NG", "GB", "CA", "gb", "AU"]) assertEquals(regionOf(code), "other", code);
  for (const code of [null, undefined, "", "USA", "U", "1A", "u s"]) assertEquals(regionOf(code), "us", String(code));
});

Deno.test("interpret: the help line the model named wins over its kinds of concern, for crisis and uncertain alike", () => {
  const help = (asked: Asked, input: ScreenInput = text) => {
    const result = interpret(input, asked);
    return result.status === "crisis" ? result.help : null;
  };
  // A parent afraid their son wants to die: the kinds can say danger now, the model's line says the 988 line.
  assertEquals(help(verdict({ risk: "crisis", categories: ["abuse_or_danger_now"], help: "crisis" })), "crisis");
  assertEquals(help(verdict({ risk: "crisis", categories: ["medical_emergency"], help: "crisis" })), "crisis");
  // A recent assault named as abuse, whatever the kinds say.
  assertEquals(help(verdict({ risk: "crisis", categories: ["self_harm"], help: "abuse" })), "abuse");
  assertEquals(help(verdict({ risk: "uncertain", categories: [], help: "emergency" })), "emergency");
  assertEquals(help(verdict({ risk: "crisis", categories: ["suicide"], help: "harm_others" }), audio), "harm_others");
  // A line on a reply that calls the risk none changes nothing: it is clear.
  assertEquals(interpret(text, verdict({ help: "abuse" })), { status: "clear", transcript: WRITTEN });
  // A block is still the 988 line, and a phrase still follows its group (no model line is involved).
  assertEquals(help({ kind: "blocked" }), "crisis");
  assertEquals(help(verdict({ transcript: "Honestly, I want to hurt him.", help: "crisis" }), audio), "harm_others");
});

Deno.test("interpret: without a line from the model, the help line follows the kinds it named, and a phrase its group", () => {
  const help = (asked: Asked, input: ScreenInput = text) => {
    const result = interpret(input, asked);
    return result.status === "crisis" ? result.help : null;
  };
  assertEquals(help(verdict({ risk: "crisis", categories: ["abuse_or_danger_now", "self_harm"] })), "abuse");
  assertEquals(help(verdict({ risk: "uncertain", categories: ["abuse_or_danger_now"] })), "abuse");
  assertEquals(help(verdict({ risk: "crisis", categories: ["harm_to_others"] })), "harm_others");
  assertEquals(help(verdict({ risk: "crisis", categories: ["medical_emergency", "suicide"] })), "emergency");
  assertEquals(help(verdict({ risk: "crisis", categories: [] })), "crisis");
  // A recording the model calls none whose words hold a phrase: the phrase's group decides.
  assertEquals(help(verdict({ transcript: "Honestly, I want to hurt him." }), audio), "harm_others");
  assertEquals(help(verdict({ transcript: "Honestly, I want to hurt myself." }), audio), "crisis");
  // Categories on a reply that calls the risk none change nothing: it is clear.
  assertEquals(interpret(text, verdict({ categories: ["abuse_or_danger_now"] })), {
    status: "clear",
    transcript: WRITTEN,
  });
});

Deno.test("phraseVerdict: a written text is decided by the backstop alone, and its group picks the help line", () => {
  assertEquals(phraseVerdict("I am going to hurt someone."), {
    status: "crisis",
    transcript: "I am going to hurt someone.",
    source: "phrase",
    help: "harm_others",
  });
  assertEquals(phraseVerdict("I want to die."), {
    status: "crisis",
    transcript: "I want to die.",
    source: "phrase",
    help: "crisis",
  });
  // The person's own life comes first when both groups match.
  const both = phraseVerdict("I want to hurt him and then I want to die.");
  assert(both !== null && both.status === "crisis" && both.help === "crisis");
  assertEquals(phraseVerdict("I am grateful for a quiet morning."), null);
});

Deno.test(
  "screenEntry: a phrase in a written entry is decided without the model",
  withWorld([], async (world) => {
    const stats = newStats();
    const result = await screenEntry({ kind: "text", text: "I just want to die." }, config({ stats }));
    assertEquals(result, { status: "crisis", transcript: "I just want to die.", source: "phrase", help: "crisis" });
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
      assertEquals(result, { status: "crisis", transcript: WRITTEN, source: "uncertain", help: "crisis" });
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
