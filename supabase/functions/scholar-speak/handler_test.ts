import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  ELEVEN_WAV,
  ELEVEN_WAV_MS,
  FIXTURE_WAV,
  FIXTURE_WAV_MS,
  type GoogleReply,
  installWorld,
  listenVoiceOn,
  post,
  SPEECH_VOICE,
  speechOn,
  unscopedRequests,
  VOICE_TEST,
  type World,
} from "../process-entry/testing/fakes.ts";
import type { ScholarLimitError, ScholarSpeakError, ScholarSpeakResponse } from "../process-entry/contracts.ts";
import { blankLogLine } from "../_shared/log.ts";
import { SPOKEN_HELP_LINE, spokenHelpLine } from "../_shared/scholar/heavyChat.ts";
import { buildScholarSpeech } from "../_shared/scholar/script.ts";
import { listenCost } from "../_shared/scholar/usage.ts";
import type { StoredBlock } from "../_shared/scholar/prompt.ts";
import { listenSpeechTiming, SPEECH } from "../_shared/voice/constants.ts";
import { VOICES } from "../_shared/voice/voices.ts";
import { handle } from "./handler.ts";

type Row = Record<string, unknown>;

const USER = "user_test";
const OTHER = "user_other";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const QUESTION = "c0a8012e-0000-4000-8000-0000000000a1";
const ANSWER = "c0a8012e-0000-4000-8000-0000000000b1";

const REPLY =
  "A shepherd in David’s day walked ahead of his flock, found them water and grass, and stayed with them through the night. When David calls the Lord his shepherd, he is saying that God leads him, provides for him and guards him like that. The psalm is a song of trust: whatever the day holds, God’s care is close, and it is enough.";
const BLOCKS: StoredBlock[] = [
  { type: "passage", reference: "Psalm 23:1", text: "The LORD is my shepherd;\nI shall not want." },
  { type: "text", text: REPLY },
  { type: "prayer", text: "Lord, thank you for leading me. Give me trust for today, and rest tonight." },
];

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      speechOn(world);
      await work(world);
      await world.settleBackground();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}\n  last log: ${world.logs.at(-1) ?? "none"}`);
    } finally {
      world.restore();
    }
  };
}

// A conversation of the person's, with one question and Scholar's answer to it.
function seedAnswer(world: World, over: { conversation?: Row; answer?: Row; user?: string } = {}): void {
  const user = over.user ?? USER;
  world.seedUser(user);
  world.conversations.push({
    id: CONVERSATION,
    user_id: user,
    entry_id: null,
    title: null,
    is_heavy: false,
    last_message_at: world.now(),
    created_at: world.now(),
    ...over.conversation,
  });
  const base = {
    conversation_id: CONVERSATION,
    user_id: user,
    error_code: null,
    is_heavy: false,
    claimed_at: null,
  };
  world.messages.push({
    ...base,
    id: QUESTION,
    role: "user",
    reply_to: null,
    input_type: "text",
    status: "ready",
    content: { blocks: [{ type: "text", text: "What does Psalm 23 mean?" }] },
    created_at: world.now(),
  });
  world.messages.push({
    ...base,
    id: ANSWER,
    role: "scholar",
    reply_to: QUESTION,
    input_type: null,
    status: "ready",
    content: { blocks: BLOCKS },
    created_at: world.now(),
    ...over.answer,
  });
}

function setPlan(world: World, tier: string, expires: string | null = null): void {
  const user = world.users.find((row) => row.id === USER) as Row;
  user.subscription_tier = tier;
  user.subscription_expires_at = expires;
}

const ask = (world: World, body: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, body, options);
const speak = (world: World, part: number, messageId = ANSWER) => ask(world, { messageId, part });

async function ok(response: Response): Promise<ScholarSpeakResponse> {
  const text = await response.text();
  assertEquals(response.status, 200, text.slice(0, 300));
  return JSON.parse(text) as ScholarSpeakResponse;
}

async function refused(response: Response, status: number, code: string): Promise<ScholarSpeakError> {
  const text = await response.text();
  assertEquals(response.status, status, text);
  const body = JSON.parse(text) as ScholarSpeakError;
  assertEquals(body.error.code, code);
  return body;
}

const lastLog = (world: World) => JSON.parse(world.logs.at(-1) as string) as Record<string, unknown>;
const listenBumps = (world: World) => world.rpcCalls.filter((call) => call.name === "bump_scholar_usage");
const spends = (world: World) => world.rpcCalls.filter((call) => call.name === "spend_scholar_credits");
// What the whole answer costs to hear (usage.ts listenCost: by the length of its whole script).
const answerCost = (script: string[]) => listenCost(script.reduce((sum, part) => sum + part.length, 0));
// The person's credits: `used` of 400, in a window that renews in six hours.
function seedCredits(world: World, used: number): Row {
  const row: Row = {
    user_id: USER,
    used,
    allowance: 400,
    renews_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    updated_at: world.now(),
  };
  world.scholarCredits.push(row);
  return row;
}
const spokenMarkup = (world: World, index: number) =>
  (world.ttsCalls[index].json as { input: { markup: string } }).input.markup;
const today = () => new Date().toISOString().slice(0, 10);

Deno.test(
  "the method, the token and the body: nothing is read for a request that is not one",
  flow(async (world) => {
    seedAnswer(world);
    await refused(await ask(world, { messageId: ANSWER, part: 0 }, { method: "GET" }), 405, "METHOD_NOT_ALLOWED");
    await refused(await ask(world, { messageId: ANSWER, part: 0 }, { token: null }), 401, "UNAUTHORIZED");
    for (
      const body of [
        { messageId: "not-an-id", part: 0 },
        { messageId: ANSWER, part: -1 },
        { messageId: ANSWER, part: 1.5 },
        { messageId: ANSWER, part: "0" },
        { messageId: ANSWER, part: 0, userId: OTHER },
        { messageId: ANSWER, part: 0, region: "USA" },
        { messageId: ANSWER, part: 0, region: 1 },
        { messageId: ANSWER, part: 0, region: "" },
      ]
    ) {
      await refused(await ask(world, body), 400, "INVALID_REQUEST");
    }
    assertEquals(world.ttsCalls.length, 0);
  }),
);

Deno.test(
  "Pro hears an answer in parts, in the devotional's voice; it is paid for once, on part 0, and nothing is stored",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    const script = buildScholarSpeech(BLOCKS, { helpLine: null });
    assert(script.length >= 3, "the answer is read in several parts");

    const first = await ok(await speak(world, 0));
    assertEquals(first.part, 0);
    assertEquals(first.parts, script.length);
    assertEquals(first.durationMs, FIXTURE_WAV_MS);
    const audio = Uint8Array.from(atob(first.audioBase64), (char) => char.charCodeAt(0));
    assertEquals(audio.length, FIXTURE_WAV.length);
    assertEquals(spokenMarkup(world, 0), script[0]);
    assert(script[0].startsWith("A reading from Psalm 23, verse 1."));
    const request = world.ttsCalls[0].json as { voice: { name: string }; audioConfig: { audioEncoding: string } };
    assertEquals(request.voice.name, SPEECH_VOICE);
    assertEquals(request.audioConfig.audioEncoding, "LINEAR16");

    const second = await ok(await speak(world, 1));
    assertEquals(second.part, 1);
    assertEquals(spokenMarkup(world, 1), script[1]);
    await world.settleBackground();
    // The whole answer is paid for on part 0, by the length of its whole script; part 1 spends nothing. The day keeps its record.
    assertEquals(spends(world).map((call) => call.args), [
      { p_user: USER, p_cost: answerCost(script), p_allowance: 400, p_window_seconds: 86_400 },
    ]);
    assertEquals(world.scholarCredits.map((row) => row.used), [answerCost(script)]);
    assertEquals(listenBumps(world).map((call) => call.args), [{
      p_user: USER,
      p_day: today(),
      p_messages: 0,
      p_listens: 1,
    }]);
    assertEquals(world.uploads.length, 0);
    assertEquals(unscopedRequests(world, USER), []);

    const line = lastLog(world);
    assertEquals(Object.keys(line), Object.keys(blankLogLine({ requestId: "x", status: 200 })));
    assertEquals(line.reason, "scholar:spoken");
    assertEquals(line.tts, "ok");
    assertEquals(line.audioMs, FIXTURE_WAV_MS);
    assertEquals(line.ttsChars, script[1].length);
    assertEquals(line.limit, "pro_ok");
    const written = JSON.stringify(line);
    for (const secret of [script[1].slice(0, 30), "Psalm", ANSWER, CONVERSATION]) assert(!written.includes(secret));
  }),
);

Deno.test(
  "the free plan and a trial are told by their plan on every part, before any speech is made",
  flow(async (world) => {
    seedAnswer(world);
    for (const part of [0, 2]) {
      const body = await refused(await speak(world, part), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
      assertEquals(body.usage, { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: null });
    }
    assertEquals([lastLog(world).limit, lastLog(world).limitUsed], ["free_blocked", null]);
    // A trial is told the day its plan begins, when listening opens.
    const ends = new Date(Date.now() + 2 * 86_400_000).toISOString();
    setPlan(world, "trial", ends);
    for (const part of [0, 2]) {
      const body = await refused(await speak(world, part), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
      assertEquals(body.usage, { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: ends });
    }
    assertEquals([lastLog(world).limit, lastLog(world).limitUsed], ["trial_blocked", null]);
    assertEquals(world.ttsCalls.length, 0);
    await world.settleBackground();
    assertEquals(spends(world).length + listenBumps(world).length, 0);
  }),
);

Deno.test(
  "in a heavy conversation anyone may listen, nothing is counted, and an answer to a flagged message ends with the help line",
  flow(async (world) => {
    seedAnswer(world, { conversation: { is_heavy: true }, answer: { is_heavy: true } });
    // An answer saved before 2026-11-11 carries no help kind: it is the 988 line, as it was.
    const script = buildScholarSpeech(BLOCKS, { helpLine: SPOKEN_HELP_LINE });
    assertEquals(script.at(-1), SPOKEN_HELP_LINE.replace(/’/g, "'"));
    const last = await ok(await speak(world, script.length - 1));
    assertEquals(last.parts, script.length);
    assert(spokenMarkup(world, 0).includes("nine eight eight"));
    await ok(await speak(world, 0));
    await world.settleBackground();
    assertEquals(listenBumps(world).length, 0);
    assertEquals(spends(world).length, 0);
    assertEquals(lastLog(world).limit, "exempt");
  }),
);

Deno.test(
  "the spoken help line follows the answer's saved help kind and the phone's region, and a clear answer has none",
  flow(async (world) => {
    seedAnswer(world, {
      conversation: { is_heavy: true },
      answer: { is_heavy: true, content: { blocks: BLOCKS, help: "abuse", fallback: "abuse" } },
    });
    const usScript = buildScholarSpeech(BLOCKS, { helpLine: spokenHelpLine("abuse", "us") });
    const last = await ok(await ask(world, { messageId: ANSWER, part: usScript.length - 1, region: "US" }));
    assertEquals(last.parts, usScript.length);
    const spoken = spokenMarkup(world, 0);
    assert(spoken.includes("National Domestic Violence Hotline"), spoken);
    assert(spoken.includes("nine one one") && !spoken.includes("nine eight eight"), spoken);
    // A region that is not given is the US.
    await ok(await ask(world, { messageId: ANSWER, part: usScript.length - 1 }));
    assertEquals(spokenMarkup(world, 1), spoken);
    // Outside the US the voice names no US number.
    const otherScript = buildScholarSpeech(BLOCKS, { helpLine: spokenHelpLine("abuse", "other") });
    await ok(await ask(world, { messageId: ANSWER, part: otherScript.length - 1, region: "ng" }));
    const elsewhere = spokenMarkup(world, 2);
    assert(
      elsewhere.includes("your local emergency number") && !/nine one one|eight hundred/.test(elsewhere),
      elsewhere,
    );
    // An emergency answer speaks 911 first.
    const emergency = world.messages.find((row) => row.id === ANSWER) as Row;
    emergency.content = { blocks: BLOCKS, help: "emergency", fallback: "emergency" };
    const emergencyScript = buildScholarSpeech(BLOCKS, { helpLine: spokenHelpLine("emergency", "us") });
    await ok(await ask(world, { messageId: ANSWER, part: emergencyScript.length - 1, region: "PR" }));
    assertEquals(spokenMarkup(world, 3), spokenHelpLine("emergency", "us").replace(/’/g, "'"));
    // A help kind the server does not know is read as the 988 line, never dropped.
    emergency.content = { blocks: BLOCKS, help: "shelter" };
    const crisisScript = buildScholarSpeech(BLOCKS, { helpLine: SPOKEN_HELP_LINE });
    await ok(await speak(world, crisisScript.length - 1));
    assert(spokenMarkup(world, 4).includes("nine eight eight"));
    // A clear answer in a heavy conversation (its own message was screened clear) has no help sentence.
    emergency.is_heavy = false;
    emergency.content = { blocks: BLOCKS, help: "abuse" };
    const clear = await ok(await speak(world, 0));
    assertEquals(clear.parts, buildScholarSpeech(BLOCKS, { helpLine: null }).length);
  }),
);

Deno.test(
  "Pro's credits: part 0 with none left is refused, and an answer already started is never cut off",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    const credits = seedCredits(world, 400);
    const body = await refused(await speak(world, 0), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
    assertEquals(body.usage, { kind: "credits", used: 400, limit: 400, remaining: 0, resetsAt: credits.renews_at });
    assertEquals([lastLog(world).limit, lastLog(world).limitUsed], ["pro_blocked", 400]);
    await ok(await speak(world, 2));
    await world.settleBackground();
    assertEquals(spends(world).length + listenBumps(world).length, 0);
    assertEquals(credits.used, 400);
  }),
);

Deno.test(
  "Pro's credits: an answer may be heard while one credit is left, and the whole answer is paid for",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    const credits = seedCredits(world, 399);
    const script = buildScholarSpeech(BLOCKS, { helpLine: null });
    await ok(await speak(world, 0));
    assertEquals([lastLog(world).limit, lastLog(world).limitUsed], ["pro_ok", 399]);
    await world.settleBackground();
    assertEquals(credits.used, 399 + answerCost(script));
  }),
);

Deno.test(
  "Pro: a spend that fails after the response changes nothing the person heard, and the day keeps its record",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    world.fail.spend = 1;
    assertEquals((await ok(await speak(world, 0))).part, 0);
    await world.settleBackground();
    assertEquals(spends(world).length, 1);
    assertEquals(world.scholarCredits.length, 0);
    assertEquals(listenBumps(world).length, 1);
  }),
);

Deno.test(
  "a paid plan whose end date has passed is read again before the plan is checked",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro", "2026-01-01T00:00:00.000Z");
    await refused(await speak(world, 0), 402, "LIMIT_REACHED");
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals(lastLog(world).billing, "synced");
  }),
);

Deno.test(
  "only the person's own ready answer can be heard; a part outside the script is refused",
  flow(async (world) => {
    seedAnswer(world, { user: OTHER });
    world.seedUser(USER);
    setPlan(world, "pro");
    await refused(await speak(world, 0), 404, "NOT_FOUND");
    world.messages.splice(0, world.messages.length);
    world.conversations.splice(0, world.conversations.length);

    seedAnswer(world);
    await refused(await speak(world, 0, QUESTION), 404, "NOT_FOUND");
    await refused(await speak(world, 0, crypto.randomUUID()), 404, "NOT_FOUND");
    await refused(await speak(world, 40), 400, "INVALID_REQUEST");
    assertEquals(world.ttsCalls.length, 0);
  }),
);

Deno.test(
  "speech off, set up wrong, or Google failing is AI_UNAVAILABLE, and nothing is counted",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    world.ttsQueue.push(
      {
        kind: "json",
        status: 403,
        body: {
          error: { code: 403, message: "x", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] },
        },
      } as GoogleReply,
    );
    await refused(await speak(world, 0), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).tts, "failed:tts_http_403:PERMISSION_DENIED/SERVICE_DISABLED");

    Deno.env.set("TTS_VOICE_NAME", "a voice that is not one");
    await refused(await speak(world, 0), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).tts, "bad_config:TTS_VOICE_NAME");

    Deno.env.delete("TTS_VOICE_NAME");
    Deno.env.delete("GOOGLE_TTS_CREDENTIALS_B64");
    await refused(await speak(world, 0), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).tts, "off");
    await world.settleBackground();
    assertEquals(listenBumps(world).length, 0);
  }),
);

// Listen in the chosen voice (2026-11-19): a request that names one of the eight voices of a live talk is read by ElevenLabs
// while SCHOLAR_LISTEN_VOICE_ENABLED is on, and by the devotional's Google voice when that reading fails. What ElevenLabs keeps
// of each reading is deleted after the response.

const readVoice = (world: World, part: number, voice: unknown, region?: string) =>
  ask(world, region === undefined ? { messageId: ANSWER, part, voice } : { messageId: ANSWER, part, voice, region });
const readings = (world: World) =>
  world.elevenCalls.filter((call) => call.url.pathname.startsWith("/v1/text-to-speech/"));
const deletions = (world: World) => world.elevenCalls.filter((call) => call.url.pathname.startsWith("/v1/history/"));
const voiceLines = (world: World) =>
  world.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) =>
    String(line.reason).startsWith("voice:")
  );
// A voice's ElevenLabs id, from the list itself (VOICE_IDS is what the handler reads, so it is not what a test compares with).
const voiceId = (key: string) => VOICES.find((voice) => voice.key === key)?.elevenLabsVoiceId ?? "no such voice";
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

Deno.test(
  "Listen in the chosen voice: ElevenLabs reads the part, the same credits are paid, and what it kept is deleted",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    const script = buildScholarSpeech(BLOCKS, { helpLine: null });

    const first = await ok(await readVoice(world, 0, "storyteller"));
    assertEquals(first.part, 0);
    assertEquals(first.parts, script.length);
    assertEquals(first.durationMs, ELEVEN_WAV_MS);
    assert(sameBytes(bytesOf(first.audioBase64), ELEVEN_WAV), "the part is ElevenLabs' own WAV");
    assertEquals(world.ttsCalls.length, 0);
    // One reading, in the voice the key names, as the agents speak (the same model and settings), of exactly this part.
    const [reading] = readings(world);
    assertEquals(reading.method, "POST");
    assertEquals(reading.url.pathname, `/v1/text-to-speech/${voiceId("storyteller")}`);
    assertEquals(reading.url.searchParams.get("output_format"), "wav_24000");
    assertEquals(reading.headers.get("xi-api-key"), VOICE_TEST.apiKey);
    assertEquals(reading.json, {
      text: script[0],
      model_id: SPEECH.model,
      voice_settings: { stability: SPEECH.stability, similarity_boost: SPEECH.similarity, speed: SPEECH.speed },
    });

    const line = lastLog(world);
    assertEquals(Object.keys(line), Object.keys(blankLogLine({ requestId: "x", status: 200 })));
    assertEquals(line.reason, "scholar:spoken");
    assertEquals(line.tts, "voice");
    assertEquals(line.ttsAttempts, 1);
    assertEquals(line.ttsChars, script[0].length);
    assertEquals(line.audioMs, ELEVEN_WAV_MS);
    assertEquals(line.limit, "pro_ok");

    await ok(await readVoice(world, 1, "storyteller"));
    assertEquals(readings(world).length, 2);
    assertEquals((readings(world)[1].json as { text: string }).text, script[1]);
    await world.settleBackground();
    // Both readings are deleted from ElevenLabs' history, with the same key; no second log line is needed.
    assertEquals(world.elevenHistory.size, 0);
    assertEquals(deletions(world).length, 2);
    assert(deletions(world).every((call) => call.method === "DELETE"));
    assertEquals(voiceLines(world), []);
    // The same as the devotional's voice: the whole answer is paid for on part 0, and the day keeps its record.
    assertEquals(spends(world).map((call) => call.args), [
      { p_user: USER, p_cost: answerCost(script), p_allowance: 400, p_window_seconds: 86_400 },
    ]);
    assertEquals(listenBumps(world).length, 1);
    assertEquals(world.uploads.length, 0);
    assertEquals(unscopedRequests(world, USER), []);
    // No line names the voice, its id, ElevenLabs' item or a word of the script.
    const written = world.logs.join("\n");
    for (const secret of ["storyteller", voiceId("storyteller"), "hist0", script[0].slice(0, 30), ANSWER]) {
      assert(!written.includes(secret), secret);
    }
  }),
);

Deno.test(
  "the devotional's voice reads the part while the switch is not on, and when the request names no voice",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    const off = await ok(await readVoice(world, 0, "deep"));
    assertEquals(off.durationMs, FIXTURE_WAV_MS);
    assertEquals(lastLog(world).tts, "ok");
    // Only "true" is on.
    Deno.env.set("SCHOLAR_LISTEN_VOICE_ENABLED", "TRUE");
    Deno.env.set("ELEVENLABS_API_KEY", VOICE_TEST.apiKey);
    await ok(await readVoice(world, 1, "deep"));
    assertEquals(lastLog(world).tts, "ok");
    listenVoiceOn();
    await ok(await speak(world, 2));
    assertEquals(lastLog(world).tts, "ok");
    assertEquals(world.elevenCalls.length, 0);
    assertEquals(world.ttsCalls.length, 3);
  }),
);

Deno.test(
  "a reading in the chosen voice that fails is read by the devotional's voice, and the log says why",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    const script = buildScholarSpeech(BLOCKS, { helpLine: null });
    const cases: { name: string; arrange: () => void; tts: string; kept: boolean }[] = [
      {
        // The production key has no Text to Speech until it is given it.
        name: "a key without Text to Speech",
        arrange: () =>
          world.elevenQueue.push({
            kind: "json",
            status: 401,
            body: { detail: { status: "missing_permissions", message: "missing the permission text_to_speech" } },
          }),
        tts: "voice_fallback:speech_http_401:missing_permissions",
        kept: false,
      },
      {
        name: "ElevenLabs out of reach",
        arrange: () => world.elevenQueue.push({ kind: "network" }),
        tts: "voice_fallback:speech_network",
        kept: false,
      },
      {
        name: "an answer with a message that is not a code",
        arrange: () =>
          world.elevenQueue.push({ kind: "json", status: 500, body: { detail: "Something broke: Psalm" } }),
        tts: "voice_fallback:speech_http_500",
        kept: false,
      },
      {
        name: "a reading that is not a WAV",
        arrange: () => {
          world.elevenSpeechBytes = new Uint8Array(4_096);
        },
        tts: "voice_fallback:speech_not_wav",
        kept: true,
      },
      {
        name: "a reading with no sound",
        arrange: () => {
          world.elevenSpeechBytes = new Uint8Array(16);
        },
        tts: "voice_fallback:speech_empty",
        kept: true,
      },
      {
        name: "a key that is not set up right",
        arrange: () => {
          world.elevenSpeechBytes = null;
          Deno.env.set("ELEVENLABS_API_KEY", "not-a-key");
        },
        tts: "voice_fallback:bad_config:ELEVENLABS_API_KEY",
        kept: false,
      },
    ];
    for (const [index, { name, arrange, tts, kept }] of cases.entries()) {
      const before = world.elevenCalls.length;
      const ttsBefore = world.ttsCalls.length;
      arrange();
      const read = await ok(await readVoice(world, 0, "clear"));
      assertEquals(read.durationMs, FIXTURE_WAV_MS, name);
      assertEquals(world.ttsCalls.length, ttsBefore + 1, name);
      assertEquals(spokenMarkup(world, ttsBefore), script[0], name);
      const line = lastLog(world);
      assertEquals(line.tts, tts, name);
      assertEquals(line.reason, "scholar:spoken", name);
      // The reading in the chosen voice counts as an attempt, unless the key could not even be read.
      assertEquals(line.ttsAttempts, tts.includes("bad_config") ? 1 : 2, name);
      assertEquals(line.audioMs, FIXTURE_WAV_MS, name);
      await world.settleBackground();
      // A reading ElevenLabs kept is deleted all the same.
      assertEquals(world.elevenHistory.size, 0, name);
      const made = world.elevenCalls.slice(before);
      assertEquals(made.filter((call) => call.url.pathname.startsWith("/v1/history/")).length, kept ? 1 : 0, name);
      assertEquals(made.length, tts.includes("bad_config") ? 0 : kept ? 2 : 1, `${name} (${index})`);
    }
    assertEquals(voiceLines(world), []);
    assert(!world.logs.join("\n").includes("Something broke"), "ElevenLabs' own words are never logged");
  }),
);

Deno.test(
  "a slow reading is left for the devotional's voice, and the reading that comes late is still deleted",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    Object.assign(listenSpeechTiming, { answerMs: 50, capMs: 3_000 });
    world.elevenSpeechDelayMs = 800;
    const read = await ok(await readVoice(world, 0, "warm"));
    assertEquals(read.durationMs, FIXTURE_WAV_MS);
    assertEquals(lastLog(world).tts, "voice_fallback:speech_timeout");
    assertEquals(deletions(world).length, 0);
    await world.settleBackground();
    assertEquals(world.elevenHistory.size, 0);
    assertEquals(deletions(world).length, 1);
    assertEquals(voiceLines(world), []);
  }),
);

Deno.test(
  "a reading ElevenLabs saves a moment after it answers is still deleted, and one never saved in time is logged, not called gone",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    // As measured on 2026-11-21: the item is saved about a second after the reading, and a DELETE before then answers 404.
    world.elevenHistorySaveMs = 120;
    await ok(await readVoice(world, 0, "warm"));
    await world.settleBackground();
    assertEquals(world.elevenHistory.size, 0);
    assert(
      deletions(world).length >= 2,
      `${deletions(world).length} DELETEs: the first came before the item was saved`,
    );
    assertEquals(voiceLines(world), []);

    // Never saved within the time the deletion is tried for: the reading stays at ElevenLabs, and a second line says so.
    world.elevenHistorySaveMs = 60_000;
    const before = world.logs.length;
    await ok(await readVoice(world, 1, "warm"));
    await world.settleBackground();
    assertEquals(world.elevenHistory.size, 1);
    const lines = world.logs.slice(before).map((line) => JSON.parse(line) as Record<string, unknown>);
    assertEquals(lines.map((line) => line.reason), ["scholar:spoken", "voice:history_http_404:invalid_parameters"]);
    assertEquals(lines[1].requestId, lines[0].requestId);
    assert(!world.logs.join("\n").includes("hist0"), "no line names ElevenLabs' item");
  }),
);

Deno.test(
  "a reading that never answers, a deletion that fails and a reading ElevenLabs names no item for each write a second line",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    Object.assign(listenSpeechTiming, { answerMs: 50, capMs: 150 });
    // The request's own line comes first; the second line may follow at once, before the background work has settled.
    const second = async (part: number, voice: string, reason: string, tts: string) => {
      const before = world.logs.length;
      await ok(await readVoice(world, part, voice));
      await world.settleBackground();
      const lines = world.logs.slice(before).map((line) => JSON.parse(line) as Record<string, unknown>);
      assertEquals(lines.length, 2, reason);
      const [first, next] = lines;
      assertEquals([first.reason, first.tts], ["scholar:spoken", tts], reason);
      assertEquals(Object.keys(next), Object.keys(blankLogLine({ requestId: "x", status: 200 })), reason);
      assertEquals([next.requestId, next.status, next.reason, next.user], [
        first.requestId,
        200,
        reason,
        first.user,
      ]);
      assertEquals([next.tts, next.limit, next.audioMs, next.ttsAttempts], [null, null, null, 0], reason);
    };

    // It never answered: whether ElevenLabs kept the reading is not known.
    world.elevenQueue.push({ kind: "hang" });
    await second(0, "bright", "voice:history_unknown", "voice_fallback:speech_timeout");
    // The key may not delete what ElevenLabs keeps (History write): the reading stays there, and the log says so.
    world.elevenHistoryDeleteFails = true;
    await second(1, "bright", "voice:history_http_401:missing_permissions", "voice");
    assertEquals(world.elevenHistory.size, 1);
    world.elevenHistoryDeleteFails = false;
    world.elevenHistory.clear();
    // ElevenLabs read the part but named no item, so it cannot be deleted.
    world.elevenSpeechNoHistoryId = true;
    await second(2, "bright", "voice:history_missing", "voice");
    assertEquals(voiceLines(world).length, 3);
    assert(!world.logs.join("\n").includes("hist0"), "no line names ElevenLabs' item");
  }),
);

Deno.test(
  "a voice the server does not know is the default voice, and a voice that is not a key is refused",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    await ok(await readVoice(world, 0, "angel"));
    assertEquals(readings(world)[0].url.pathname, `/v1/text-to-speech/${voiceId("warm")}`);
    for (const voice of ["Warm", "", "a".repeat(33), 7, null, "voice-1"]) {
      await refused(await readVoice(world, 0, voice), 400, "INVALID_REQUEST");
      assertEquals(lastLog(world).reason, "voice");
    }
    assertEquals(readings(world).length, 1);
  }),
);

Deno.test(
  "the plan comes before any voice: the free plan is told so, and in a heavy conversation anyone hears the chosen voice",
  flow(async (world) => {
    seedAnswer(world);
    listenVoiceOn();
    await refused(await readVoice(world, 0, "wise"), 402, "LIMIT_REACHED");
    assertEquals(world.elevenCalls.length, 0);

    const conversation = world.conversations[0];
    conversation.is_heavy = true;
    const answer = world.messages.find((row) => row.id === ANSWER) as Row;
    answer.is_heavy = true;
    answer.content = { blocks: BLOCKS, help: "crisis", fallback: "crisis" };
    const script = buildScholarSpeech(BLOCKS, { helpLine: spokenHelpLine("crisis", "us") });
    const last = await ok(await readVoice(world, script.length - 1, "wise", "US"));
    assertEquals(last.parts, script.length);
    const text = (readings(world)[0].json as { text: string }).text;
    assertEquals(text, script.at(-1));
    assert(text.includes("nine eight eight"), text);
    assertEquals(lastLog(world).tts, "voice");
    assertEquals(lastLog(world).limit, "exempt");
    await world.settleBackground();
    assertEquals(spends(world).length + listenBumps(world).length, 0);
    assertEquals(world.elevenHistory.size, 0);
  }),
);

Deno.test(
  "when both voices fail the person is told to try again, nothing is counted, and what ElevenLabs kept is deleted",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "pro");
    listenVoiceOn();
    world.elevenSpeechBytes = new Uint8Array(4_096);
    world.ttsQueue.push(
      {
        kind: "json",
        status: 403,
        body: {
          error: { code: 403, message: "x", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] },
        },
      } as GoogleReply,
    );
    await refused(await readVoice(world, 0, "steady"), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).tts, "failed:tts_http_403:PERMISSION_DENIED/SERVICE_DISABLED");
    await world.settleBackground();
    assertEquals(world.elevenHistory.size, 0);
    assertEquals(deletions(world).length, 1);
    assertEquals(spends(world).length + listenBumps(world).length, 0);
  }),
);

// The free conversation (2026-11-20): an account that is not Pro hears the answers of its free conversation for free, the free
// plan in the default voice (Hannah) whatever it asks for, a trial in the voice it chose; elsewhere the plan says no.

function holdFree(world: World, conversationId = CONVERSATION): Row {
  const row: Row = {
    user_id: USER,
    conversation_id: conversationId,
    messages: 3,
    created_at: world.now(),
    updated_at: world.now(),
  };
  world.scholarFree.push(row);
  return row;
}

Deno.test(
  "the free conversation's answers are heard for free: in Hannah's voice on the free plan, nothing spent, the day recorded once",
  flow(async (world) => {
    seedAnswer(world);
    holdFree(world);
    listenVoiceOn();
    const script = buildScholarSpeech(BLOCKS, { helpLine: null });
    const first = await ok(await readVoice(world, 0, "storyteller"));
    assertEquals(first.parts, script.length);
    assertEquals(readings(world)[0].url.pathname, `/v1/text-to-speech/${voiceId("warm")}`);
    assertEquals([lastLog(world).limit, lastLog(world).limitUsed, lastLog(world).tts], ["free_ok", null, "voice"]);
    await ok(await readVoice(world, 1, "deep"));
    assertEquals(readings(world)[1].url.pathname, `/v1/text-to-speech/${voiceId("warm")}`);
    // With no voice asked for, the devotional's voice reads it, as for anyone.
    await ok(await speak(world, 2));
    assertEquals(lastLog(world).tts, "ok");
    await world.settleBackground();
    assertEquals(spends(world).length, 0, "a free answer spends no credits");
    assertEquals(listenBumps(world).map((call) => call.args.p_listens), [1], "part 0 goes in the day's record, once");
    assertEquals(world.elevenHistory.size, 0);
  }),
);

Deno.test(
  "the free conversation: a trial hears the voice it chose, and an answer of another conversation is the plan's to refuse",
  flow(async (world) => {
    seedAnswer(world);
    const free = holdFree(world);
    const ends = new Date(Date.now() + 2 * 86_400_000).toISOString();
    setPlan(world, "trial", ends);
    listenVoiceOn();
    await ok(await readVoice(world, 0, "storyteller"));
    assertEquals(readings(world)[0].url.pathname, `/v1/text-to-speech/${voiceId("storyteller")}`);
    assertEquals(lastLog(world).limit, "trial_ok");

    free.conversation_id = "c0a8012e-0000-4000-8000-000000000009";
    for (const part of [0, 2]) {
      const body = await refused(
        await readVoice(world, part, "storyteller"),
        402,
        "LIMIT_REACHED",
      ) as unknown as ScholarLimitError;
      assertEquals(body.usage, { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: ends });
    }
    assertEquals(lastLog(world).limit, "trial_blocked");
    assertEquals(readings(world).length, 1, "nothing is read for a refused part");
    await world.settleBackground();
    assertEquals(spends(world).length, 0);
  }),
);
