import { createAdmin } from "../_shared/admin.ts";
import { AppError } from "../_shared/errors.ts";
import { scholarTiming } from "../_shared/scholar/constants.ts";
import { heavyChatFallback, spokenFallback } from "../_shared/scholar/heavyChat.ts";
import { TYPED_VERSE_NOTE } from "../_shared/scholar/passages.ts";
import { buildScholarSchema, SPOKEN_BLOCK, SPOKEN_RESUME } from "../_shared/scholar/prompt.ts";
import { VOICE_WRITER_THINKING, voiceTiming } from "../_shared/voice/constants.ts";
import type { ScholarTurnResponse } from "../process-entry/contracts.ts";
import { MAX_ATTEMPTS, timing } from "../process-entry/gemini.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  geminiError,
  geminiOk,
  type GeminiReply,
  installWorld,
  type Recorded,
  screenOutput,
  unscopedRequests,
  type World,
} from "../process-entry/testing/fakes.ts";
import {
  newTurnContext,
  readScholarConfig,
  runAfter,
  runTurn,
  type TalkReady,
  type TalkTurn,
  type TurnContext,
  type TurnRequest,
} from "./turn.ts";

// The engine in a live talk (step 39, step 3 of the plan): what `talk` changes in runTurn, each thing with its test. Everything
// else is the code path of a typed message, which handler_test.ts covers through scholar-turn's handler, unchanged.

type Row = Record<string, unknown>;

const USER = "user_test";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const SECOND = "c0a8012e-0000-4000-8000-000000000002";
const MESSAGE = "c0a8012e-0000-4000-8000-0000000000a1";
const NEXT = "c0a8012e-0000-4000-8000-0000000000a2";
const THIRD = "c0a8012e-0000-4000-8000-0000000000a3";
const FOURTH = "c0a8012e-0000-4000-8000-0000000000a4";
const FIFTH = "c0a8012e-0000-4000-8000-0000000000a5";
const SIXTH = "c0a8012e-0000-4000-8000-0000000000a6";
const SEVENTH = "c0a8012e-0000-4000-8000-0000000000a7";
const TALK = "7b1e6a52-3c1d-4f6a-9b2e-0d5c8a7f4e31";

const ASK = "What does Psalm 23 mean when it says the Lord is my shepherd?";
// A turn the phrase list matches (the same made-up sentence the other tests use: a feeling, no method).
const PHRASE_TEXT = "I do not want to be alive anymore. I have been thinking about ending my life.";
// A turn the faked screening flags; its words alone decide nothing.
const TIRED = "Everything feels too much tonight and I am so tired of all of it.";

const REPLY =
  "A shepherd in David’s day walked ahead of his flock, found them water and grass, and stayed with them through the night. When David calls the Lord his shepherd, he is saying that God leads him, provides for him and guards him like that.";
const HEAVY_REPLY =
  "Thank you for trusting me with this. What you are facing tonight is real, and you do not have to hold it by yourself. God is near to you right now, and he has not turned away from you. Please reach out today to someone you trust, a friend, a pastor or a counselor, and let them sit with you in this. You can keep talking with me here too.";

const PSA_23_1 = { book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 };
const PSA_46_1 = { book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 };

function answerOutput(over: Row = {}): Row {
  return {
    is_heavy: false,
    title: "The Shepherd Who Stays",
    lead_passage: PSA_23_1,
    passage: null,
    reply: REPLY,
    prayer: null,
    says_under_18: false,
    ...over,
  };
}

function heavyAnswer(over: Row = {}): Row {
  return { is_heavy: true, passage_key: "PSA_46_1", reply: HEAVY_REPLY, prayer: null, says_under_18: false, ...over };
}

const GENERAL = heavyChatFallback("general", { help: "crisis", region: "us", usedPassages: [] }).reply;
const crisis = (over: Row = {}) => geminiOk(screenOutput({ risk: "crisis", categories: ["suicide"], ...over }));
const everyAttempt = (reply: GeminiReply): GeminiReply[] => Array.from({ length: MAX_ATTEMPTS }, () => reply);
const HANG: GeminiReply = { kind: "hang" };

const SCHOLAR_ENV: Record<string, string> = {
  SCHOLAR_ENABLED: "true",
  SCHOLAR_MODEL: "gemini-scholar-model",
  SCHOLAR_SCREENING_MODEL: "gemini-screen-model",
  SCHOLAR_HEAVY_MODEL: "gemini-heavy-model",
};
const SCHOLAR_NAMES = [
  ...Object.keys(SCHOLAR_ENV),
  "SCHOLAR_SCREEN_FIRST",
  "GEMINI_THINKING_LEVEL",
];

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const savedEnv = new Map(SCHOLAR_NAMES.map((name) => [name, Deno.env.get(name)]));
    for (const [name, value] of Object.entries(SCHOLAR_ENV)) Deno.env.set(name, value);
    Deno.env.delete("SCHOLAR_SCREEN_FIRST");
    const savedTiming = { ...timing };
    const savedScholar = structuredClone(scholarTiming);
    const savedVoice = structuredClone(voiceTiming);
    timing.retryBackoffMs = 1;
    // A look for the answer every 20 ms, so a test that waits is short.
    voiceTiming.joinPollMs = 20;
    // Scholar is Pro's (2026-11-18): a typed message beside a talk's turn is answered for a Pro account, so that is the default
    // here; a test about another plan sets it.
    setPlan(world, "pro");
    try {
      await work(world);
      await world.settleBackground();
    } finally {
      Object.assign(timing, savedTiming);
      Object.assign(scholarTiming, structuredClone(savedScholar));
      Object.assign(voiceTiming, structuredClone(savedVoice));
      for (const [name, value] of savedEnv) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
      world.restore();
    }
  };
}

type Ran = { body: ScholarTurnResponse | null; error: AppError | null; context: TurnContext; ms: number };
type Options = {
  words?: string;
  messageId?: string;
  conversationId?: string;
  entryId?: string | null;
  region?: "us" | "other";
  // Null runs the turn as scholar-turn does (a typed message). Otherwise the talk's deadlines, counted from now unless given.
  talk?: Partial<TalkTurn> | null;
};

// One turn through the engine, as its caller runs it: the turn, then the work that follows the response.
async function run(options: Options = {}): Promise<Ran> {
  const context = newTurnContext();
  const request: TurnRequest = {
    conversationId: options.conversationId ?? CONVERSATION,
    messageId: options.messageId ?? MESSAGE,
    input: { type: "text", text: options.words ?? ASK },
    entryId: options.entryId ?? null,
    region: options.region ?? "us",
  };
  const now = Date.now();
  const talk: TalkTurn | null = options.talk === null ? null : {
    talkId: TALK,
    startedAt: now,
    heavyDeadlineAt: now + voiceTiming.heavyTotalMs,
    answerDeadlineAt: now + voiceTiming.answer.totalMs,
    refuse: null,
    ...options.talk,
  };
  context.inputType = talk === null ? "text" : "audio";
  try {
    const body = await runTurn({
      admin: createAdmin(),
      userId: USER,
      request,
      config: readScholarConfig(),
      context,
      talk,
    });
    return { body, error: null, context, ms: Date.now() - now };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { body: null, error, context, ms: Date.now() - now };
  } finally {
    await runAfter(context);
  }
}

const typedRun = (options: Options = {}) => run({ ...options, talk: null });

function answered(ran: Ran): ScholarTurnResponse {
  assert(ran.body !== null, `expected an answer, got ${ran.error?.code}:${ran.error?.reason}`);
  return ran.body as ScholarTurnResponse;
}

function failed(ran: Ran, code: string, reason?: string): AppError {
  assert(ran.error !== null, "expected an error, got an answer");
  assertEquals(ran.error?.code, code, ran.error?.reason);
  if (reason !== undefined) assertEquals(ran.error?.reason, reason);
  return ran.error as AppError;
}

const modelOf = (call: Recorded) => (call.json as Row).model;
const levelOf = (call: Recorded) => ((call.json as Row).generation_config as Row).thinking_level;
const inputOf = (call: Recorded) => {
  const input = (call.json as Row).input;
  return typeof input === "string" ? input : JSON.stringify(input);
};
const counted = (world: World, counter: string) =>
  world.rpcCalls.filter((call) => call.name === "bump_scholar_safety" && call.args.p_counter === counter).length;
const usageBumps = (world: World) => world.rpcCalls.filter((call) => call.name === "bump_scholar_usage");
const spends = (world: World) => world.rpcCalls.filter((call) => call.name === "spend_scholar_credits");
const textBlock = (body: { blocks: { type: string }[] }) =>
  (body.blocks.find((block) => block.type === "text") as { text: string } | undefined)?.text;
const messageRow = (world: World, id = MESSAGE) => world.messages.find((row) => row.id === id);
const answerRows = (world: World, replyTo = MESSAGE) => world.messages.filter((row) => row.reply_to === replyTo);
const storageRequests = (world: World) =>
  world.requests.filter((request) => request.url.pathname.startsWith("/storage/")).length + world.downloads.length +
  world.removals.length;
const later = (ms: number, work: () => void) => setTimeout(work, ms);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function seedConversation(world: World, over: Row = {}): Row {
  const row: Row = {
    id: CONVERSATION,
    user_id: USER,
    entry_id: null,
    title: null,
    is_heavy: false,
    last_message_at: world.now(),
    created_at: world.now(),
    ...over,
  };
  world.seedUser(USER);
  world.conversations.push(row);
  return row;
}

function seedMessage(world: World, over: Row = {}): Row {
  const row: Row = {
    id: crypto.randomUUID(),
    conversation_id: CONVERSATION,
    user_id: USER,
    role: "user",
    reply_to: null,
    input_type: "text",
    status: "ready",
    error_code: null,
    content: { blocks: [{ type: "text", text: "An earlier question." }] },
    is_heavy: false,
    claimed_at: null,
    created_at: world.now(),
    ...over,
  };
  world.messages.push(row);
  return row;
}

// The same turn, being answered by another request right now: its message is claimed and has no answer yet.
function seedBusyTurn(world: World, over: Row = {}): Row {
  return seedMessage(world, {
    id: MESSAGE,
    input_type: "audio",
    status: "pending",
    claimed_at: new Date().toISOString(),
    content: { blocks: [{ type: "text", text: ASK }] },
    ...over,
  });
}

// What the other request does when it finishes: the answer, then the message ready.
function finishBusyTurn(world: World, busy: Row, text = REPLY): Row {
  const answer = seedMessage(world, {
    conversation_id: busy.conversation_id,
    role: "scholar",
    reply_to: busy.id,
    input_type: null,
    content: { blocks: [{ type: "text", text }] },
  });
  busy.status = "ready";
  return answer;
}

function setPlan(world: World, tier: string, expires: string | null = null): void {
  world.seedUser(USER);
  const user = world.users.find((row) => row.id === USER) as Row;
  user.subscription_tier = tier;
  user.subscription_expires_at = expires;
}

// ---- 1. A spoken message whose words are known at once ----------------------------------------------------------------------

Deno.test(
  "a talk's turn is saved as a spoken message with its words at once: screened as text, and no recording is read or deleted",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput()));
    const first = await run();
    const body = answered(first);

    const row = messageRow(world) as Row;
    assertEquals(row.input_type, "audio");
    assertEquals(row.status, "ready");
    assertEquals(row.content, { blocks: [{ type: "text", text: ASK }] });
    assertEquals(body.message.inputType, "audio");
    assertEquals(body.message.blocks, [{ type: "text", text: ASK }]);
    // The answer is a typed answer's: the lead reading, then the text.
    assertEquals(body.answer.blocks.map((block) => block.type), ["passage", "text"]);
    assertEquals(textBlock(body.answer), REPLY);
    assertEquals(first.context.outcome, "scholar:answered");

    // The screening read the words as text (a recording would be an array with an audio part), at the same time as the writer.
    assertEquals(world.screenCalls.length, 1);
    assertEquals(typeof (world.screenCalls[0].json as Row).input, "string");
    assert(inputOf(world.screenCalls[0]).includes(ASK));
    assertEquals(world.callOrder, ["reflection", "screening"]);
    assertEquals(storageRequests(world), 0);

    // The same turn asked for again finds its message (stored as spoken) and replays the answer: nothing is written twice.
    const again = await run();
    assertEquals(answered(again).answer.id, body.answer.id);
    assertEquals(again.context.outcome, "scholar:replayed");
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 2);
    assertEquals(answerRows(world).length, 1);
  }),
);

Deno.test(
  "a talk's turn carries its words: a recording in its place is refused before anything is read",
  flow(async (world) => {
    const context = newTurnContext();
    const now = Date.now();
    let caught: unknown = null;
    try {
      await runTurn({
        admin: createAdmin(),
        userId: USER,
        request: {
          conversationId: CONVERSATION,
          messageId: MESSAGE,
          input: { type: "audio", durationMs: 4_000 },
          entryId: null,
          region: "us",
        },
        config: readScholarConfig(),
        context,
        talk: {
          talkId: TALK,
          startedAt: now,
          heavyDeadlineAt: now + 22_000,
          answerDeadlineAt: now + 13_000,
          refuse: null,
        },
      });
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof AppError);
    assertEquals((caught as AppError).code, "INVALID_REQUEST");
    assertEquals((caught as AppError).reason, "talk_input");
    assertEquals(world.requests.length, 0);
  }),
);

Deno.test(
  "a talk's answer is handed to its caller once it has passed its checks and before it is saved, as the saved answer carries it",
  flow(async (world) => {
    const scholarRows = () => world.messages.filter((row) => row.role === "scholar").length;
    const seen: { ready: TalkReady; savedBefore: number }[] = [];
    const onReady = (ready: TalkReady) => seen.push({ ready, savedBefore: scholarRows() });

    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = answered(await run({ talk: { onReady } }));
    assertEquals(seen.length, 1);
    assertEquals(seen[0].savedBefore, 0, "the answer was saved before it was handed over");
    assertEquals(scholarRows(), 1);
    assertEquals(seen[0].ready, { blocks: body.answer.blocks, helpLine: body.answer.helpLine });
    assertEquals(seen[0].ready.helpLine, null);

    // A hard moment's answer is handed over with its help line.
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    const heavy = answered(await run({ words: TIRED, messageId: NEXT, conversationId: SECOND, talk: { onReady } }));
    assertEquals(seen.length, 2);
    assertEquals(seen[1].savedBefore, 1, "the hard moment's answer was saved before it was handed over");
    assertEquals(scholarRows(), 2);
    assertEquals(seen[1].ready, { blocks: heavy.answer.blocks, helpLine: "crisis" });

    // Nothing is handed over for a replay (its answer is the saved one), nor for a turn released at the cap.
    answered(await run({ talk: { onReady } }));
    failed(await run({ messageId: THIRD, talk: { onReady, refuse: "cap" } }), "LIMIT_REACHED", "voice:cap");
    assertEquals(seen.length, 2);
  }),
);

// ---- 2. The limits of a typed message do not apply ---------------------------------------------------------------------------

Deno.test(
  "a talk's turn skips the rate limit, the credits and the plan re-read, and spends nothing",
  flow(async (world) => {
    // A state in which a typed message is refused three times over: thirty messages in the last ten minutes, the credits used
    // up, and a paid plan whose end date has passed (a typed message would ask RevenueCat).
    seedConversation(world, { id: SECOND });
    const recent = new Date(Date.now() - 60_000).toISOString();
    for (let index = 0; index < 30; index += 1) seedMessage(world, { conversation_id: SECOND, created_at: recent });
    const credits: Row = {
      user_id: USER,
      used: 400,
      allowance: 400,
      renews_at: new Date(Date.now() + 3_600_000).toISOString(),
      updated_at: world.now(),
    };
    world.scholarCredits.push(credits);
    setPlan(world, "pro", "2026-01-01T00:00:00.000Z");

    world.geminiQueue.push(geminiOk(answerOutput()));
    const spoken = await run();
    const body = answered(spoken);
    assertEquals(body.usage, null);
    assertEquals(spoken.context.limit, null);
    assertEquals(spoken.context.limitUsed, null);
    assertEquals(spoken.context.billing, null);
    assertEquals(world.revenuecatCalls.length, 0);
    assertEquals(usageBumps(world).length, 0);
    assertEquals(spends(world).length, 0);
    assertEquals(credits.used, 400);
    // The anonymous count of screened messages still runs: it holds no person.
    assertEquals(counted(world, "screened"), 1);

    // A replayed turn carries no usage either.
    assertEquals(answered(await run()).usage, null);

    // An account the plan does not include (it cannot start a talk; the engine does not ask again) spends nothing either.
    setPlan(world, "free");
    world.geminiQueue.push(geminiOk(answerOutput()));
    const free = await run({ messageId: NEXT, words: "And what does the next verse mean?" });
    assertEquals(answered(free).usage, null);
    assertEquals(usageBumps(world).length, 0);
    assertEquals(spends(world).length, 0);

    // The same state refuses a typed message, at its first limit.
    failed(await typedRun({ messageId: THIRD }), "RATE_LIMITED");
  }),
);

// ---- 3. The everyday writer: the spoken block, and the talk's own time --------------------------------------------------------

Deno.test(
  "a talk's turn gives the everyday writer the spoken block, and a typed message's writer never",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput()));
    answered(await run());
    const writer = inputOf(world.geminiCalls[0]);
    assertEquals(modelOf(world.geminiCalls[0]), "gemini-scholar-model");
    assert(writer.includes(SPOKEN_BLOCK), "the block, whole");
    assert(writer.indexOf("</message>") < writer.indexOf("<spoken>"), "after the message");
    assert(
      !inputOf(world.screenCalls[0]).includes("<spoken>"),
      "the screening is not told how the answer is delivered",
    );

    // A talk's everyday writer thinks as little as it can; the screening and a typed message's writer keep their level.
    assertEquals(levelOf(world.geminiCalls[0]), VOICE_WRITER_THINKING);
    assertEquals(levelOf(world.screenCalls[0]), "low");

    world.geminiQueue.push(geminiOk(answerOutput()));
    answered(await typedRun({ conversationId: SECOND, messageId: NEXT }));
    assert(!inputOf(world.geminiCalls[1]).includes("<spoken>"));
    assertEquals(levelOf(world.geminiCalls[1]), "low");
    assert(!writer.includes(SPOKEN_RESUME), "an ordinary turn of a talk has no recap");

    // A turn right after a stop word: the spoken block carries the recap.
    world.geminiQueue.push(geminiOk(answerOutput()));
    answered(await run({ messageId: THIRD, words: "Okay, go on.", talk: { resumed: true } }));
    const resumed = inputOf(world.geminiCalls[2]);
    assert(resumed.includes(SPOKEN_RESUME), "the recap, whole");
    assert(resumed.indexOf(SPOKEN_RESUME) < resumed.indexOf("</spoken>"), "inside the spoken block");

    // The model named a reading anyway (answerOutput names Psalm 23:1): a resumed turn shows none, and an ordinary one does.
    world.geminiQueue.push(geminiOk(answerOutput()));
    const back = answered(await run({ messageId: FOURTH, words: "Okay, go on.", talk: { resumed: true } }));
    assertEquals(back.answer.blocks.map((block) => block.type), ["text"]);
    world.geminiQueue.push(geminiOk(answerOutput()));
    const plain = answered(await run({ messageId: FIFTH, words: "Tell me more." }));
    assertEquals(plain.answer.blocks.map((block) => block.type), ["passage", "text"]);

    // spoken-v4: a talk's writer gets the spoken field descriptions, and a supporting passage it names anyway is never read
    // after the answer; a typed message's writer gets the written schema and keeps it.
    const schemaOf = (call: Recorded) => ((call.json as Row).response_format as Row).schema;
    assertEquals(schemaOf(world.geminiCalls[0]), buildScholarSchema({ heavy: false, spoken: true }));
    assertEquals(schemaOf(world.geminiCalls[1]), buildScholarSchema());
    world.geminiQueue.push(geminiOk(answerOutput({ passage: PSA_46_1 })));
    const supported = answered(await run({ messageId: SIXTH, words: "Tell me why." }));
    assertEquals(supported.answer.blocks.map((block) => block.type), ["passage", "text"]);
    assert(
      supported.answer.blocks.every((block) =>
        block.type !== "passage" || block.scripture.reference.startsWith("Psalm 23")
      ),
    );

    // A turn that speaks of prayer keeps the writer's own level: at "minimal" a prayer was skipped about one time in three.
    world.geminiQueue.push(
      geminiOk(answerOutput({
        prayer:
          "Father, you are the God who carries me through every tomorrow. I bring you the worry I feel about the work ahead and the people I will face. Give me a calm heart tonight. Help me rest and trust you with what I cannot control. Show me one faithful step for the morning. You are near, and you hold my days in your hands.",
      })),
    );
    answered(await run({ messageId: SEVENTH, words: "Can you pray with me about tomorrow?" }));
    assertEquals(levelOf(world.geminiCalls.at(-1) as Recorded), "low");
  }),
);

Deno.test(
  "a talk's turn ends the everyday writer and the screening by the talk's own time, and releases the message",
  flow(async (world) => {
    // One attempt of the writer lasts voiceTiming.answer.attemptMs, not a typed message's fifteen seconds.
    voiceTiming.answer.attemptMs = 60;
    timing.minAttemptMs = 40;
    world.geminiQueue.push(...everyAttempt(HANG));
    const slow = await run();
    failed(slow, "AI_UNAVAILABLE", "gemini_timeout");
    assertEquals(world.geminiCalls.length, MAX_ATTEMPTS);
    // Every second attempt goes to the heavy model, which refuses "minimal" (HTTP 400): it keeps the request's own level.
    assertEquals(world.geminiCalls.map(modelOf), [
      "gemini-scholar-model",
      "gemini-heavy-model",
      "gemini-scholar-model",
      "gemini-heavy-model",
    ]);
    assertEquals(world.geminiCalls.map(levelOf), [VOICE_WRITER_THINKING, "low", VOICE_WRITER_THINKING, "low"]);
    assert(slow.ms < 3_000, `four attempts of 60 ms, not of a typed message's time: ${slow.ms} ms`);
    // The message is released as a failed typed message is, and its words stay.
    assertEquals(messageRow(world)?.status, "failed");
    assertEquals(messageRow(world)?.error_code, "AI_UNAVAILABLE");
    assertEquals(messageRow(world)?.content, { blocks: [{ type: "text", text: ASK }] });
    assertEquals(answerRows(world).length, 0);
    assertEquals(slow.context.heavy, false);

    // The writer's last moment is the talk's answerDeadlineAt: no attempt goes past it, and none starts without time.
    voiceTiming.answer.attemptMs = 13_000;
    world.geminiQueue.push(HANG);
    const before = world.geminiCalls.length;
    const late = await run({ messageId: NEXT, talk: { answerDeadlineAt: Date.now() + 250 } });
    failed(late, "AI_UNAVAILABLE", "gemini_timeout");
    assertEquals(world.geminiCalls.length - before, 1);
    assert(late.ms >= 200 && late.ms < 2_000, `ended at the deadline: ${late.ms} ms`);

    // In a conversation that is clear so far the screening ends by answerDeadlineAt too: with no answer from it, nothing is said.
    world.screenQueue.push(HANG);
    world.geminiQueue.push(geminiOk(answerOutput()));
    const unscreened = await run({ messageId: THIRD, talk: { answerDeadlineAt: Date.now() + 250 } });
    const error = failed(unscreened, "AI_UNAVAILABLE");
    assert(error.reason.startsWith("screen:"), error.reason);
    assert(unscreened.ms < 2_000, `the screening did not run to a typed message's six seconds: ${unscreened.ms} ms`);
    assertEquals(answerRows(world, THIRD).length, 0, "nothing is written for a turn that was not screened");
  }),
);

Deno.test(
  "a talk's turn asks again for a reply that repeats a passage's words only while there is time, and keeps it otherwise",
  flow(async (world) => {
    const typedVerse = answerOutput({ reply: `${REPLY} The Lord is my shepherd, I shall not want.` });
    // Time enough: asked once more with the note, as for a typed message.
    world.geminiQueue.push(geminiOk(typedVerse), geminiOk(answerOutput()));
    const retried = await run();
    assertEquals(textBlock(answered(retried).answer), REPLY);
    assertEquals(world.geminiCalls.length, 2);
    assert(inputOf(world.geminiCalls[1]).includes(`<correction>\n${TYPED_VERSE_NOTE}\n</correction>`));
    assert(inputOf(world.geminiCalls[1]).includes(SPOKEN_BLOCK), "the second request is a spoken turn too");
    assertEquals(retried.context.outcome, "scholar:answered");

    // No time for another attempt before answerDeadlineAt: the reply is kept and spoken, never "say it again".
    timing.minAttemptMs = 400;
    world.geminiQueue.push(geminiOk(typedVerse, undefined, 300));
    const kept = await run({ messageId: NEXT, conversationId: SECOND, talk: { answerDeadlineAt: Date.now() + 600 } });
    assertEquals(textBlock(answered(kept).answer), `${REPLY} The Lord is my shepherd, I shall not want.`);
    assertEquals(world.geminiCalls.length, 3);
    assertEquals(kept.context.outcome, "scholar:answered:typed_verse");
  }),
);

// ---- 4. A hard moment: the request's deadline, and the spoken forms -----------------------------------------------------------

Deno.test(
  "a talk's hard moment is written by the heavy model with the block's spoken sentence, and never with the spoken block",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    const ran = await run({ words: TIRED });
    const body = answered(ran);
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
    assertEquals(body.answer.isHeavy, true);
    assertEquals(body.answer.helpLine, "crisis");
    assertEquals(body.conversation.isHeavy, true);
    assertEquals(body.usage, null);
    assertEquals(ran.context.heavy, true);
    assertEquals(ran.context.outcome, "scholar:heavy");
    assertEquals(ran.context.limit, "exempt");

    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model", "gemini-heavy-model"]);
    const heavy = inputOf(world.geminiCalls[1]);
    assert(heavy.includes("<heavy_moment>"));
    assert(
      heavy.includes("is on their screen and is read aloud after your answer"),
      "where the help line is in a talk",
    );
    assert(!heavy.includes("The help line under your answer"));
    assert(!heavy.includes("<spoken>"), "a heavy answer keeps the heavy rules' own length");
    assertEquals(usageBumps(world).length, 0);

    // A typed hard moment keeps the written form.
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    answered(await typedRun({ words: TIRED, conversationId: SECOND, messageId: NEXT }));
    const typedHeavy = inputOf(world.geminiCalls[3]);
    assert(typedHeavy.includes("The help line under your answer"));
    assert(!typedHeavy.includes("on their screen"));
  }),
);

Deno.test(
  "a talk's hard moment that is not written by heavyDeadlineAt gets the written answer in its spoken form: never an error",
  flow(async (world) => {
    // The heavy writer never answers: its time ends at the talk's heavyDeadlineAt, and the written answer follows.
    timing.minAttemptMs = 40;
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), HANG);
    const ran = await run({ words: TIRED, talk: { heavyDeadlineAt: Date.now() + 300 } });
    const body = answered(ran);
    assert(ran.ms >= 250 && ran.ms < 2_500, `at the heavy deadline, not a typed message's 25 seconds: ${ran.ms} ms`);
    assertEquals(textBlock(body.answer), spokenFallback(GENERAL));
    assert(textBlock(body.answer)?.includes("or call or text the line on your screen."));
    assert(!textBlock(body.answer)?.includes("under this message"));
    assertEquals(body.answer.helpLine, "crisis");
    assertEquals(ran.context.outcome, "scholar:fallback:unwritten");
    assertEquals(ran.context.heavy, true);
    // What was said is what is saved.
    const saved = answerRows(world)[0].content as { blocks: { type: string; text: string }[]; fallback: string };
    assertEquals(saved.blocks.find((block) => block.type === "text")?.text, spokenFallback(GENERAL));
    assertEquals(saved.fallback, "general");

    // The phrase list decides with no model, and a second written answer in the conversation is the shorter one, spoken too.
    world.geminiQueue.push(HANG);
    const phrase = await run({ words: PHRASE_TEXT, messageId: NEXT, talk: { heavyDeadlineAt: Date.now() + 200 } });
    const repeat = heavyChatFallback("repeat", { help: "crisis", region: "us", usedPassages: [] }).reply;
    assertEquals(textBlock(answered(phrase).answer), spokenFallback(repeat));
    assert(textBlock(answered(phrase).answer)?.includes("since you last spoke"));

    // A typed message keeps the readers' written words.
    world.screenQueue.push(...everyAttempt(geminiError(503)));
    const typedHeavy = await typedRun({ conversationId: CONVERSATION, messageId: THIRD });
    assert(textBlock(answered(typedHeavy).answer)?.includes("under this message"));
  }),
);

Deno.test(
  "a talk's turn in a heavy conversation whose screening has no answer still gets the written answer",
  flow(async (world) => {
    timing.minAttemptMs = 40;
    seedConversation(world, { is_heavy: true });
    world.screenQueue.push(HANG);
    // In a heavy conversation the screening has the heavy answer's time, not the everyday one's.
    const ran = await run({ talk: { answerDeadlineAt: Date.now() + 50, heavyDeadlineAt: Date.now() + 300 } });
    const body = answered(ran);
    assert(ran.ms >= 250, `the screening was given until the heavy deadline: ${ran.ms} ms`);
    assertEquals(textBlock(body.answer), spokenFallback(GENERAL));
    assertEquals(ran.context.outcome, "scholar:fallback:screen_failed");
    assertEquals(world.geminiCalls.length, 0);
    assertEquals(ran.context.heavy, true);
  }),
);

// ---- 5. A turn that is already being answered is waited for --------------------------------------------------------------------

Deno.test(
  "a talk's turn that is already being answered is waited for and replayed; a typed message is still refused",
  flow(async (world) => {
    seedConversation(world);
    const busy = seedBusyTurn(world);
    let answerId = "";
    later(120, () => {
      answerId = String(finishBusyTurn(world, busy).id);
    });
    const joined = await run();
    const body = answered(joined);
    assertEquals(body.answer.id, answerId);
    assertEquals(textBlock(body.answer), REPLY);
    assertEquals(body.usage, null);
    assert(joined.ms >= 100, `it waited for the other request: ${joined.ms} ms`);
    assertEquals(joined.context.joined, true);
    assertEquals(joined.context.outcome, "scholar:replayed");
    // Nothing was screened, written or counted a second time.
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
    assertEquals(answerRows(world).length, 1);
    assertEquals(usageBumps(world).length, 0);

    // The same state for a typed message: refused at once, as before.
    seedMessage(world, { id: NEXT, status: "pending", claimed_at: new Date().toISOString() });
    const refused = await typedRun({ messageId: NEXT, words: "An earlier question." });
    failed(refused, "ALREADY_PROCESSING", "message_busy");
    assertEquals(refused.context.joined, false);
  }),
);

Deno.test(
  "a talk's turn whose other request gave up answers the turn itself",
  flow(async (world) => {
    seedConversation(world);
    const busy = seedBusyTurn(world);
    later(100, () => {
      busy.status = "failed";
      busy.error_code = "AI_UNAVAILABLE";
    });
    world.geminiQueue.push(geminiOk(answerOutput()));
    const ran = await run();
    const body = answered(ran);
    assertEquals(textBlock(body.answer), REPLY);
    assertEquals(ran.context.joined, true);
    assertEquals(ran.context.outcome, "scholar:answered");
    assertEquals(world.geminiCalls.length, 1);
    assertEquals(messageRow(world)?.status, "ready");
    assertEquals(messageRow(world)?.error_code, null);
    assertEquals(answerRows(world).length, 1);
  }),
);

Deno.test(
  "a talk's turn stops waiting when an everyday answer's time is up, and leaves the other request's message alone",
  flow(async (world) => {
    seedConversation(world);
    const busy = seedBusyTurn(world);
    const claimedAt = busy.claimed_at;
    const ran = await run({ talk: { answerDeadlineAt: Date.now() + 200 } });
    failed(ran, "AI_UNAVAILABLE", "voice:join_timeout");
    assert(ran.ms >= 150 && ran.ms < 2_000, `it waited until the everyday deadline: ${ran.ms} ms`);
    // The message is still the other request's: not failed, not claimed again.
    assertEquals(busy.status, "pending");
    assertEquals(busy.claimed_at, claimedAt);
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
    assertEquals(ran.context.heavy, false);
  }),
);

Deno.test(
  "a talk's turn in a heavy conversation waits until the heavy deadline and then answers with the written answer: never silence",
  flow(async (world) => {
    // Heavy from the start.
    seedConversation(world, { is_heavy: true });
    const busy = seedBusyTurn(world);
    const ran = await run({ talk: { answerDeadlineAt: Date.now() + 80, heavyDeadlineAt: Date.now() + 250 } });
    const body = answered(ran);
    assert(ran.ms >= 200 && ran.ms < 2_500, `it waited until the heavy deadline: ${ran.ms} ms`);
    assertEquals(textBlock(body.answer), spokenFallback(GENERAL));
    assertEquals(body.answer.helpLine, "crisis");
    assertEquals(ran.context.joined, true);
    assertEquals(ran.context.heavy, true);
    assertEquals(busy.status, "ready");
    assertEquals(answerRows(world).length, 1);
    assertEquals(world.geminiCalls.length, 0);

    // Found heavy by the other request while this one waited: the wait goes on past the everyday deadline.
    const clear = seedConversation(world, { id: SECOND });
    const flagged = seedBusyTurn(world, { id: NEXT, conversation_id: SECOND });
    later(60, () => {
      clear.is_heavy = true;
    });
    const second = await run({
      conversationId: SECOND,
      messageId: NEXT,
      talk: { answerDeadlineAt: Date.now() + 120, heavyDeadlineAt: Date.now() + 300 },
    });
    assert(second.ms >= 250, `it waited on, past the everyday deadline: ${second.ms} ms`);
    assertEquals(textBlock(answered(second).answer), spokenFallback(GENERAL));
    assertEquals(flagged.status, "ready");
    assertEquals(second.context.heavy, true);

    // And when the other request's answer arrives while it waits, that answer is the one replayed.
    const third = seedConversation(world, { id: "c0a8012e-0000-4000-8000-000000000003", is_heavy: true });
    const slow = seedBusyTurn(world, { id: THIRD, conversation_id: third.id });
    later(150, () => finishBusyTurn(world, slow, HEAVY_REPLY));
    const replayed = await run({
      conversationId: String(third.id),
      messageId: THIRD,
      talk: { answerDeadlineAt: Date.now() + 60, heavyDeadlineAt: Date.now() + 2_000 },
    });
    assertEquals(textBlock(answered(replayed).answer), HEAVY_REPLY);
    assertEquals(replayed.context.outcome, "scholar:replayed");
  }),
);

Deno.test(
  "the same turn of a talk asked for twice at once is screened, written and saved once",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput(), undefined, 150));
    const [one, two] = await Promise.all([run(), run()]);
    const first = answered(one);
    const second = answered(two);
    assertEquals(first.answer.id, second.answer.id);
    assertEquals(first.conversation.id, second.conversation.id);
    assertEquals(world.geminiCalls.length, 1);
    assertEquals(world.screenCalls.length, 1);
    assertEquals(answerRows(world).length, 1);
    assertEquals(world.messages.filter((row) => row.role === "user").length, 1);
    assertEquals(world.conversations.length, 1);
    assertEquals([one.context.joined, two.context.joined].filter(Boolean).length, 1, "one wrote it, the other waited");
    assertEquals([one.context.outcome, two.context.outcome].sort(), ["scholar:answered", "scholar:replayed"]);
    await sleep(0);
  }),
);

// ---- 6. A turn the caller will not answer: the talk's cap, or voice switched off --------------------------------------------

Deno.test(
  "a turn past the talk's cap is screened first: a clear one is released with its words and no answer is written",
  flow(async (world) => {
    const ran = await run({ talk: { refuse: "cap" } });
    failed(ran, "LIMIT_REACHED", "voice:cap");
    // One call, the screening. The writer was never started: its answer would only have been thrown away.
    assertEquals(world.screenCalls.length, 1);
    assertEquals(world.geminiCalls.length, 0);
    // The turn is in the conversation with its words, released with the limit's code, as a message the day's limit held.
    const row = messageRow(world) as Row;
    assertEquals([row.status, row.error_code, row.input_type], ["failed", "LIMIT_REACHED", "audio"]);
    assertEquals(row.content, { blocks: [{ type: "text", text: ASK }] });
    assertEquals(answerRows(world).length, 0);
    assertEquals(ran.context.heavy, false);
    assertEquals(usageBumps(world).length, 0);

    // Voice switched off while the talk ran: the same, with the switch's own code.
    const off = await run({ messageId: NEXT, talk: { refuse: "off" } });
    failed(off, "SCHOLAR_UNAVAILABLE", "voice:off");
    assertEquals(world.screenCalls.length, 2);
    assertEquals(world.geminiCalls.length, 0);
    assertEquals((messageRow(world, NEXT) as Row).error_code, "SCHOLAR_UNAVAILABLE");
  }),
);

Deno.test(
  "a hard moment is answered whatever the cap or the switch: the screening, the phrase list and a heavy conversation go on",
  flow(async (world) => {
    // The screening flags a turn past the cap: the heavy model answers it, and the conversation is heavy from here on.
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const flagged = await run({ words: TIRED, talk: { refuse: "cap" } });
    const first = answered(flagged);
    assertEquals(first.answer.isHeavy, true);
    assertEquals(first.answer.helpLine, "crisis");
    assertEquals(flagged.context.outcome, "scholar:heavy");
    assertEquals(flagged.context.heavy, true);

    // A later turn of that conversation, with voice switched off: still answered.
    world.geminiQueue.push(geminiOk(heavyAnswer({ passage_key: "none" })));
    const later = await run({ messageId: NEXT, talk: { refuse: "off" } });
    assertEquals(answered(later).conversation.isHeavy, true);

    // The phrase list, in a new conversation, past the cap.
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const phrase = await run({ conversationId: SECOND, messageId: THIRD, words: PHRASE_TEXT, talk: { refuse: "cap" } });
    assertEquals(answered(phrase).answer.isHeavy, true);
    assertEquals(phrase.context.crisisSource, "phrase");
  }),
);

Deno.test(
  "a turn past the cap whose screening has no answer is released as any clear turn is, and a typed message is never refused this way",
  flow(async (world) => {
    world.screenQueue.push(...everyAttempt(geminiError(503)));
    const ran = await run({ talk: { refuse: "cap" } });
    failed(ran, "AI_UNAVAILABLE");
    assertEquals(world.geminiCalls.length, 0);
    assertEquals((messageRow(world) as Row).status, "failed");

    // scholar-turn passes no talk, so nothing of this applies to a typed message.
    world.geminiQueue.push(geminiOk(answerOutput()));
    assertEquals(textBlock(answered(await typedRun({ messageId: NEXT })).answer), REPLY);
  }),
);

// ---- The thirty-in-ten-minutes rule after a talk (decision 23) ------------------------------------------------------------

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function seedPastTalk(world: World, over: Row = {}): Row {
  const row: Row = {
    id: TALK,
    user_id: USER,
    conversation_id: CONVERSATION,
    voice: "warm",
    started_at: ago(8 * 60_000),
    last_turn_at: ago(2 * 60_000),
    ended_at: ago(2 * 60_000),
    cap_seconds: 600,
    seconds: 360,
    turns: 30,
    is_heavy: false,
    ...over,
  };
  world.voiceSessions.push(row);
  return row;
}

Deno.test(
  "a talk's turns do not count against a typed message that follows it: thirty in ten minutes counts everything else",
  flow(async (world) => {
    seedConversation(world);
    // A talk that began before the ten minutes did and ended two minutes ago.
    seedPastTalk(world, { started_at: ago(14 * 60_000) });
    // Thirty turns of that talk, each a spoken message made while it ran.
    for (let index = 0; index < 30; index += 1) {
      seedMessage(world, { input_type: "audio", created_at: ago(7 * 60_000 - index * 8_000) });
    }
    world.geminiQueue.push(geminiOk(answerOutput()));
    assertEquals(textBlock(answered(await typedRun()).answer), REPLY);
    // The two reads behind it name this person, as every query does.
    assertEquals(unscopedRequests(world, USER), []);

    // Typed messages still count, also the ones typed while the talk ran: with this one, thirty of them refuse the next.
    for (let index = 0; index < 29; index += 1) seedMessage(world, { created_at: ago(5 * 60_000) });
    failed(await typedRun({ messageId: NEXT }), "RATE_LIMITED", "rate_limited");
    assertEquals(messageRow(world, NEXT), undefined);

    // Another person's spoken messages, made while this person's talk ran, are nobody's turns here.
    world.seedUser("user_other");
    for (let index = 0; index < 30; index += 1) {
      seedMessage(world, {
        user_id: "user_other",
        conversation_id: SECOND,
        input_type: "audio",
        created_at: ago(6 * 60_000 - index * 4_000),
      });
    }
    failed(await typedRun({ messageId: NEXT }), "RATE_LIMITED", "rate_limited");
  }),
);

Deno.test(
  "a spoken message made outside any talk counts toward thirty in ten minutes, as it always did",
  flow(async (world) => {
    seedConversation(world);
    // A talk that ended six minutes ago; the thirty spoken messages came after it (recorded messages, not its turns).
    seedPastTalk(world, { started_at: ago(9 * 60_000), last_turn_at: ago(6 * 60_000), ended_at: ago(6 * 60_000) });
    for (let index = 0; index < 30; index += 1) {
      seedMessage(world, { input_type: "audio", created_at: ago(4 * 60_000 - index * 5_000) });
    }
    failed(await typedRun(), "RATE_LIMITED", "rate_limited");

    // Another person's talk explains nothing either.
    world.voiceSessions.splice(0, world.voiceSessions.length);
    world.seedUser("user_other");
    seedPastTalk(world, { user_id: "user_other", started_at: ago(9 * 60_000), ended_at: ago(60_000) });
    failed(await typedRun(), "RATE_LIMITED", "rate_limited");
  }),
);

Deno.test(
  "a talk that never said it ended covers its turns up to now, and a read that fails leaves the old rule",
  flow(async (world) => {
    seedConversation(world);
    seedPastTalk(world, { started_at: ago(5 * 60_000), last_turn_at: null, ended_at: null });
    for (let index = 0; index < 30; index += 1) {
      seedMessage(world, { input_type: "audio", created_at: ago(4 * 60_000 - index * 5_000) });
    }
    world.geminiQueue.push(geminiOk(answerOutput()));
    assertEquals(textBlock(answered(await typedRun()).answer), REPLY);

    // The talks cannot be read: the count stands as it is, and the message is refused as before.
    world.fail.talksRead = 1;
    failed(await typedRun({ messageId: NEXT }), "RATE_LIMITED", "rate_limited");
  }),
);
