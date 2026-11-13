import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  FIXTURE_WAV,
  FIXTURE_WAV_MS,
  type GoogleReply,
  installWorld,
  post,
  SPEECH_VOICE,
  speechOn,
  unscopedRequests,
  type World,
} from "../process-entry/testing/fakes.ts";
import type { ScholarLimitError, ScholarSpeakError, ScholarSpeakResponse } from "../process-entry/contracts.ts";
import { blankLogLine } from "../_shared/log.ts";
import { SPOKEN_HELP_LINE, spokenHelpLine } from "../_shared/scholar/heavyChat.ts";
import { buildScholarSpeech } from "../_shared/scholar/script.ts";
import type { StoredBlock } from "../_shared/scholar/prompt.ts";
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
  "Pro hears an answer in parts, in the devotional's voice; the listen is counted once, on part 0, and nothing is stored",
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
  "a free account is told by its plan on every part, before any speech is made",
  flow(async (world) => {
    seedAnswer(world);
    for (const part of [0, 2]) {
      const body = await refused(await speak(world, part), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
      assertEquals(body.usage, { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: null });
    }
    assertEquals(world.ttsCalls.length, 0);
    assertEquals(lastLog(world).limit, "free_blocked");
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
  "Pro's day of five: part 0 of a sixth answer is refused, and an answer already started is never cut off",
  flow(async (world) => {
    seedAnswer(world);
    setPlan(world, "trial");
    world.scholarUsage.push({ user_id: USER, day: today(), messages: 0, listens: 5 });
    const body = await refused(await speak(world, 0), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
    assertEquals(body.usage.kind, "listen_day");
    assertEquals(body.usage.remaining, 0);
    await ok(await speak(world, 2));
    await world.settleBackground();
    assertEquals(listenBumps(world).length, 0);
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
