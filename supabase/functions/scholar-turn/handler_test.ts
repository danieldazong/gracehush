import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { MAX_ATTEMPTS, timing } from "../process-entry/gemini.ts";
import {
  geminiError,
  geminiOk,
  type GeminiReply,
  installWorld,
  judgeOutput,
  post,
  type Recorded,
  screenOutput,
  seedDevotional,
  SPOKEN,
  TEXT,
  unscopedRequests,
  type World,
} from "../process-entry/testing/fakes.ts";
import type { ScholarLimitError, ScholarTurnError, ScholarTurnResponse } from "../process-entry/contracts.ts";
import { blankLogLine } from "../_shared/log.ts";
import { HEAVY_THINKING_LEVEL, scholarTiming } from "../_shared/scholar/constants.ts";
import { ADULTS_ONLY_TEXT, heavyChatFallback } from "../_shared/scholar/heavyChat.ts";
import { JUDGE_NOTE_PRAYER, JUDGE_NOTE_UNANSWERED } from "../_shared/scholar/judge.ts";
import { TYPED_VERSE_NOTE } from "../_shared/scholar/passages.ts";
import { TITLE_REQUEST } from "../_shared/scholar/prompt.ts";
import { handle } from "./handler.ts";

type Row = Record<string, unknown>;

const USER = "user_test";
const OTHER = "user_other";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const SECOND = "c0a8012e-0000-4000-8000-000000000002";
const MESSAGE = "c0a8012e-0000-4000-8000-0000000000a1";
const NEXT = "c0a8012e-0000-4000-8000-0000000000a2";

const ASK = "What does Psalm 23 mean when it says the Lord is my shepherd?";
// A typed message the phrase list matches (the same made-up sentence process-entry's tests use: a feeling, no method).
const PHRASE_TEXT = "I do not want to be alive anymore. I have been thinking about ending my life.";
// A message the faked screening flags; its words alone decide nothing.
const TIRED = "Everything feels too much tonight and I am so tired of all of it.";

const REPLY =
  "A shepherd in David’s day walked ahead of his flock, found them water and grass, and stayed with them through the night. When David calls the Lord his shepherd, he is saying that God leads him, provides for him and guards him like that. The psalm is a song of trust: whatever the day holds, God’s care is close, and it is enough.";
const PRAYER =
  "Lord, thank you for leading me like a shepherd. Give me trust for today, help me rest in your care tonight, and show me where you are leading me tomorrow. I trust you, because you have never left me alone.";
const HEAVY_REPLY =
  "Thank you for trusting me with this. What you are facing tonight is real, and you do not have to hold it by yourself. God is near to you right now, and he has not turned away from you. Please reach out today to someone you trust, a friend, a pastor or a counselor, and let them sit with you in this. You can keep talking with me here too.";
// A later heavy answer that shares no run of six words with HEAVY_REPLY (scholar-v2 asks again for a repeated one).
const HEAVY_REPLY_2 =
  "I’m here with you. Nothing about this has to be tidy or explained. God is close, closer than this night, and he holds you even when you feel worn down. Please let someone near you know how hard it is today, and keep writing to me whenever you want.";

const PSA_23_1 = { book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 };
const PSA_46_1 = { book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 };

// A clear answer that passes every check: a lead passage, a supporting one, a title (kept only when the turn asked for one).
function answerOutput(over: Row = {}): Row {
  return {
    is_heavy: false,
    title: "The Shepherd Who Stays",
    lead_passage: PSA_23_1,
    passage: PSA_46_1,
    reply: REPLY,
    prayer: null,
    says_under_18: false,
    ...over,
  };
}

// A heavy answer that passes every heavy check (scholar-v2): no quotation, nothing a heavy moment never says, no stock phrase,
// a passage named by its key on the readers' list.
function heavyAnswer(over: Row = {}): Row {
  return {
    is_heavy: true,
    passage_key: "PSA_46_1",
    reply: HEAVY_REPLY,
    prayer: null,
    says_under_18: false,
    ...over,
  };
}

// The readers' written answers, as the server writes them for a person in the US.
const written = (
  variant: "general" | "abuse" | "repeat" | "emergency",
  help: "crisis" | "abuse" | "emergency" = "crisis",
) => heavyChatFallback(variant, { help, region: "us", usedPassages: [] }).reply;
const GENERAL = written("general");

const crisis = (over: Row = {}) => geminiOk(screenOutput({ risk: "crisis", categories: ["suicide"], ...over }));
const blocked = () => geminiError(400, { error: { code: "prohibited_content", message: "Input blocked: x" } });
const everyAttempt = (reply: GeminiReply): GeminiReply[] => Array.from({ length: MAX_ATTEMPTS }, () => reply);

const SCHOLAR_ENV: Record<string, string> = {
  SCHOLAR_ENABLED: "true",
  SCHOLAR_MODEL: "gemini-scholar-model",
  SCHOLAR_SCREENING_MODEL: "gemini-screen-model",
  SCHOLAR_HEAVY_MODEL: "gemini-heavy-model",
};
const SCHOLAR_NAMES = [
  ...Object.keys(SCHOLAR_ENV),
  "SCHOLAR_SCREEN_FIRST",
  "SCHOLAR_FREE_DAILY_BUDGET",
  "GEMINI_THINKING_LEVEL",
];

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const savedEnv = new Map(SCHOLAR_NAMES.map((name) => [name, Deno.env.get(name)]));
    for (const [name, value] of Object.entries(SCHOLAR_ENV)) Deno.env.set(name, value);
    Deno.env.delete("SCHOLAR_SCREEN_FIRST");
    Deno.env.delete("SCHOLAR_FREE_DAILY_BUDGET");
    const savedTiming = { ...timing };
    const savedScholar = structuredClone(scholarTiming);
    timing.retryBackoffMs = 1;
    try {
      await work(world);
      await world.settleBackground();
    } catch (error) {
      // The last log line says why a request failed (it holds no words of anyone's).
      throw new Error(`${error instanceof Error ? error.message : error}
  last log: ${world.logs.at(-1) ?? "none"}`);
    } finally {
      Object.assign(timing, savedTiming);
      Object.assign(scholarTiming, structuredClone(savedScholar));
      for (const [name, value] of savedEnv) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
      world.restore();
    }
  };
}

const typed = (text = ASK, over: Row = {}): Row => ({
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  input: { type: "text", text },
  ...over,
});
const spoken = (over: Row = {}): Row => ({
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  input: { type: "audio", durationMs: 4_000 },
  ...over,
});
const send = (world: World, body: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, body, options);

async function ok(response: Response): Promise<ScholarTurnResponse> {
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text) as ScholarTurnResponse;
}

async function refused(response: Response, status: number, code: string): Promise<ScholarTurnError> {
  const text = await response.text();
  assertEquals(response.status, status, text);
  const body = JSON.parse(text) as ScholarTurnError;
  assertEquals(body.error.code, code);
  return body;
}

const lastLog = (world: World) => JSON.parse(world.logs.at(-1) as string) as Record<string, unknown>;
const modelOf = (call: Recorded) => (call.json as Row).model;
const inputOf = (call: Recorded) => {
  const input = (call.json as Row).input;
  return typeof input === "string" ? input : JSON.stringify(input);
};
const recordingPath = (messageId = MESSAGE) => `${USER}/raw/chat-${messageId}.m4a`;
const utcToday = () => new Date().toISOString().slice(0, 10);
const nextMidnight = () => `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`;
const counted = (world: World, counter: string) =>
  world.rpcCalls.filter((call) => call.name === "bump_scholar_safety" && call.args.p_counter === counter).length;
const usageBumps = (world: World) => world.rpcCalls.filter((call) => call.name === "bump_scholar_usage");
const textBlock = (body: { blocks: { type: string }[] }) =>
  (body.blocks.find((block) => block.type === "text") as { text: string } | undefined)?.text;
const scholarRows = (world: World, replyTo = MESSAGE) => world.messages.filter((row) => row.reply_to === replyTo);
// The reference of an answer's passage card, or null.
const cardOf = (body: { blocks: { type: string }[] }) => {
  const card = body.blocks.find((block) => block.type === "passage") as
    | { scripture: { reference: string } }
    | undefined;
  return card?.scripture.reference ?? null;
};
const userRow = (world: World) => world.users.find((row) => row.id === USER) as Row;
const generation = (call: Recorded) => ((call.json as Row).generation_config ?? {}) as Row;
const messageRow = (world: World, id = MESSAGE) => world.messages.find((row) => row.id === id);

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
  world.seedUser(String(row.user_id));
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

function seedExchange(world: World, question: string, answer: string, conversationId = CONVERSATION): void {
  const asked = seedMessage(world, {
    conversation_id: conversationId,
    content: { blocks: [{ type: "text", text: question }] },
  });
  seedMessage(world, {
    conversation_id: conversationId,
    role: "scholar",
    reply_to: asked.id,
    input_type: null,
    content: { blocks: [{ type: "text", text: answer }] },
  });
}

function setPlan(world: World, tier: string, expires: string | null = null): void {
  world.seedUser(USER);
  const user = world.users.find((row) => row.id === USER) as Row;
  user.subscription_tier = tier;
  user.subscription_expires_at = expires;
}

function seedUsage(world: World, messages: number): void {
  world.seedUser(USER);
  world.scholarUsage.push({ user_id: USER, day: utcToday(), messages, listens: 0 });
}

// ---- The method, the token and the body ------------------------------------------------------------------------------------

Deno.test(
  "the method and the token: OPTIONS 204, GET 405, no token or a made-up one 401, and nothing is read or written",
  flow(async (world) => {
    const preflight = await handle(
      new Request("https://project.supabase.test/functions/v1/scholar-turn", { method: "OPTIONS" }),
    );
    assertEquals(preflight.status, 204);
    await refused(await send(world, typed(), { method: "GET" }), 405, "METHOD_NOT_ALLOWED");
    await refused(await send(world, typed(), { token: null }), 401, "UNAUTHORIZED");
    await refused(await send(world, typed(), { token: "aaa.bbb.ccc" }), 401, "UNAUTHORIZED");
    // A 401 comes before the body: an empty one is a 401 too.
    await refused(await send(world, {}, { token: null }), 401, "UNAUTHORIZED");
    assertEquals(world.requests.filter((request) => request.url.pathname.startsWith("/rest/v1/")).length, 0);
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "the body: ids, sizes and keys are checked before anything is read, and no user id or recording ever travels in it",
  flow(async (world) => {
    const cases: [Row | string, number, string, string][] = [
      [
        typed(ASK, { conversationId: "C0A8012E-0000-4000-8000-000000000001" }),
        400,
        "INVALID_REQUEST",
        "conversation_id",
      ],
      [typed(ASK, { messageId: "c0a8012e-0000-1000-8000-0000000000a1" }), 400, "INVALID_REQUEST", "message_id"],
      [typed("   "), 400, "INVALID_REQUEST", "text_empty"],
      [typed("x".repeat(2_001)), 413, "PAYLOAD_TOO_LARGE", "text_long"],
      [spoken({ input: { type: "audio", durationMs: 999 } }), 400, "INVALID_REQUEST", "duration"],
      [spoken({ input: { type: "audio", durationMs: 125_001 } }), 400, "INVALID_REQUEST", "duration"],
      [spoken({ input: { type: "audio", durationMs: "4000" } }), 400, "INVALID_REQUEST", "duration"],
      [typed(ASK, { input: { type: "video", text: ASK } }), 400, "INVALID_REQUEST", "input_type"],
      [typed(ASK, { entryId: "not-an-id" }), 400, "INVALID_REQUEST", "entry_id"],
      [typed(ASK, { region: "USA" }), 400, "INVALID_REQUEST", "region"],
      [typed(ASK, { region: 7 }), 400, "INVALID_REQUEST", "region"],
      // The user id comes only from the token, and a recording is never in a body.
      [typed(ASK, { userId: OTHER }), 400, "INVALID_REQUEST", "body_keys"],
      [
        spoken({ input: { type: "audio", durationMs: 4_000, audioBase64: "AAAA" } }),
        400,
        "INVALID_REQUEST",
        "input_keys",
      ],
      [`{"conversationId":"${CONVERSATION}","pad":"${"y".repeat(9_000)}"}`, 413, "PAYLOAD_TOO_LARGE", "body_size"],
    ];
    for (const [body, status, code, reason] of cases) {
      const response = typeof body === "string" ? await send(world, null, { raw: body }) : await send(world, body);
      await refused(response, status, code);
      assertEquals(lastLog(world).reason, reason);
    }
    assertEquals(world.conversations.length + world.messages.length, 0);
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
    assertEquals(world.users.filter((row) => row.id === OTHER).length, 0);
  }),
);

// ---- An everyday message ---------------------------------------------------------------------------------------------------

Deno.test(
  "a typed message is screened and answered at the same time; the answer is saved in order, titled and counted",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput({ prayer: PRAYER })));
    const body = await ok(await send(world, typed()));

    // The screening on its model and the answer on the everyday model, the answer's request sent first: neither waited.
    assertEquals(world.screenCalls.map(modelOf), ["gemini-screen-model"]);
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model"]);
    assertEquals(world.callOrder, ["reflection", "screening"]);
    assert(
      inputOf(world.geminiCalls[0]).includes(TITLE_REQUEST),
      "the first answer of a new conversation is asked for a title",
    );

    assertEquals(body.conversation.id, CONVERSATION);
    assertEquals(body.conversation.title, "The Shepherd Who Stays");
    assertEquals(body.conversation.isHeavy, false);
    assertEquals(body.conversation.entryId, null);
    assertEquals(body.message.id, MESSAGE);
    assertEquals(body.message.role, "user");
    assertEquals(body.message.status, "ready");
    assertEquals(body.message.inputType, "text");
    assertEquals(body.message.blocks, [{ type: "text", text: ASK }]);
    assertEquals(body.answer.role, "scholar");
    assertEquals(body.answer.replyTo, MESSAGE);
    assertEquals(body.answer.isHeavy, false);
    // The lead passage, the text, the supporting passage, the prayer; every passage read from the Bible, as BSB.
    assertEquals(body.answer.blocks.map((block) => block.type), ["passage", "text", "passage", "prayer"]);
    const [lead, text, support, prayer] = body.answer.blocks;
    assert(lead.type === "passage" && lead.scripture.reference === "Psalm 23:1" && lead.scripture.verified);
    assert(lead.type === "passage" && (lead.scripture.text ?? "").startsWith("The LORD is my shepherd"));
    assertEquals(lead.type === "passage" ? lead.scripture.translation : null, "BSB");
    assertEquals(text, { type: "text", text: REPLY });
    assert(support.type === "passage" && support.scripture.reference === "Psalm 46:1");
    assertEquals(prayer, { type: "prayer", text: PRAYER });
    assertEquals(body.usage, { kind: "free_day", used: 1, limit: 5, remaining: 4, resetsAt: nextMidnight() });

    const conversation = world.conversations.find((row) => row.id === CONVERSATION) as Row;
    assertEquals(conversation.title, "The Shepherd Who Stays");
    assertEquals(conversation.last_message_at, scholarRows(world)[0].created_at);
    assertEquals(messageRow(world)?.status, "ready");

    await world.settleBackground();
    assertEquals(world.scholarUsage, [{ user_id: USER, day: utcToday(), messages: 1, listens: 0 }]);
    assertEquals(counted(world, "screened"), 1);
    assertEquals(counted(world, "free_answered"), 1);
    for (
      const counter of ["flagged_phrase", "flagged_model", "flagged_uncertain", "flagged_blocked", "flagged_writer"]
    ) {
      assertEquals(counted(world, counter), 0, counter);
    }
    assertEquals(unscopedRequests(world, USER), []);

    const line = lastLog(world);
    assertEquals(Object.keys(line), Object.keys(blankLogLine({ requestId: "x", status: 200 })));
    assertEquals(Object.keys(line).length, 43);
    assertEquals(line.reason, "scholar:answered");
    assertEquals(line.promptVersion, "scholar-v2");
    assertEquals(line.screen, "clear");
    assertEquals(line.inputType, "text");
    assertEquals(line.limit, "free_ok");
    assertEquals(line.limitUsed, 0);
    assertEquals(line.model, "gemini-scholar-model");
    assertEquals(line.attempts, 2);
    assertEquals(line.screenAttempts, 1);
    const written = JSON.stringify(line);
    for (const secret of [ASK, REPLY.slice(0, 40), PRAYER.slice(0, 30), "Shepherd", "Psalm", CONVERSATION, MESSAGE]) {
      assert(!written.includes(secret), `the log holds nothing of ${secret.slice(0, 12)}`);
    }
  }),
);

Deno.test(
  "screen first: the everyday answer is written only after the screening, and a flagged message never reaches it",
  flow(async (world) => {
    Deno.env.set("SCHOLAR_SCREEN_FIRST", "true");
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed()));
    assertEquals(world.callOrder, ["screening", "reflection"]);

    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(TIRED, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(world.geminiCalls.slice(1).map(modelOf), ["gemini-heavy-model"]);
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
  }),
);

Deno.test(
  "the writer sees the last twenty ready messages and the screening the last six",
  flow(async (world) => {
    seedConversation(world, { title: "Questions About the Psalms" });
    for (let index = 1; index <= 13; index += 1) {
      seedExchange(world, `Question number ${index}.`, `Answer number ${index}.`);
    }
    // A message that got no answer is not part of the conversation either one sees.
    seedMessage(world, {
      status: "failed",
      error_code: "AI_UNAVAILABLE",
      content: { blocks: [{ type: "text", text: "Lost." }] },
    });
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed()));

    const turn = inputOf(world.geminiCalls[0]);
    assert(!turn.includes("Question number 3.") && !turn.includes("Answer number 3."), "older than twenty is left out");
    assert(turn.includes("Question number 4.") && turn.includes("Answer number 13."), "the last twenty are there");
    assert(!turn.includes("Lost."));
    assert(!turn.includes(TITLE_REQUEST), "a conversation with a title is not asked for one");
    const screening = inputOf(world.screenCalls[0]);
    assert(screening.includes("Question number 11.") && screening.includes("Answer number 13."));
    assert(!screening.includes("Question number 10.") && !screening.includes("Answer number 10."));
    assert(!screening.includes("Lost."));
    // A titled conversation keeps its title.
    assertEquals(world.conversations[0].title, "Questions About the Psalms");
  }),
);

Deno.test(
  "a passage that cannot be read is left out, never shown unverified",
  flow(async (world) => {
    world.geminiQueue.push(
      geminiOk(
        answerOutput({ lead_passage: { book_id: "ROM", chapter: 8, verse_start: 28, verse_end: 28 }, passage: null }),
      ),
    );
    const body = await ok(await send(world, typed()));
    assertEquals(body.answer.blocks.map((block) => block.type), ["text"]);
  }),
);

Deno.test(
  "the typed-verse guard: a reply that types a verse is asked for once more, and a second such reply is kept",
  flow(async (world) => {
    const typedVerse = answerOutput({ reply: `${REPLY} The Lord is my shepherd, I shall not want.` });
    world.geminiQueue.push(geminiOk(typedVerse), geminiOk(answerOutput()));
    const body = await ok(await send(world, typed()));
    assertEquals(textBlock(body.answer), REPLY);
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model", "gemini-scholar-model"]);
    assert(!inputOf(world.geminiCalls[0]).includes("<correction>"));
    assert(inputOf(world.geminiCalls[1]).includes(`<correction>\n${TYPED_VERSE_NOTE}\n</correction>`));
    assertEquals(lastLog(world).reason, "scholar:answered");

    // The retry still repeats the passage's words: that second reply is kept and shown, never "try again" (a question such as
    // "What is the fruit of the Spirit?" cannot be answered without the passage's own words).
    const keptReply = `The Lord is my shepherd, I shall not want. ${REPLY}`;
    world.geminiQueue.push(geminiOk(typedVerse), geminiOk(answerOutput({ reply: keptReply })));
    const before = world.geminiCalls.length;
    const kept = await ok(await send(world, typed(ASK, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(world.geminiCalls.length - before, 2);
    assert(inputOf(world.geminiCalls[before + 1]).includes(`<correction>\n${TYPED_VERSE_NOTE}\n</correction>`));
    assertEquals(textBlock(kept.answer), keptReply);
    assertEquals(kept.answer.isHeavy, false);
    assertEquals(lastLog(world).reason, "scholar:answered:typed_verse");
    assertEquals(messageRow(world, NEXT)?.status, "ready");
    assertEquals(scholarRows(world, NEXT).length, 1);
  }),
);

Deno.test(
  "an everyday answer that cannot be had is AI_UNAVAILABLE, and the message is released for a retry",
  flow(async (world) => {
    world.geminiQueue.push(...everyAttempt(geminiError(503)));
    await refused(await send(world, typed()), 503, "AI_UNAVAILABLE");
    assertEquals(messageRow(world)?.status, "failed");
    assertEquals(messageRow(world)?.error_code, "AI_UNAVAILABLE");
    assertEquals(scholarRows(world).length, 0);
    // The second attempt of an everyday answer goes to the heavy model.
    assertEquals(world.geminiCalls.map(modelOf).slice(0, 2), ["gemini-scholar-model", "gemini-heavy-model"]);

    // Sent again, it is claimed again and answered.
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, typed()));
    assertEquals(body.message.status, "ready");
    assertEquals(scholarRows(world).length, 1);
  }),
);

// ---- Heavy moments -----------------------------------------------------------------------------------------------------------

Deno.test(
  "the answer is held until the screening says clear: a flagged message's everyday answer is thrown away, the heavy model writes",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(TIRED)));

    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model", "gemini-heavy-model"]);
    assert(inputOf(world.geminiCalls[1]).includes("<heavy_moment>"));
    assert(!inputOf(world.geminiCalls[1]).includes(TITLE_REQUEST));
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
    assert(!JSON.stringify(world.messages).includes(REPLY.slice(0, 40)), "the everyday answer is never saved");
    assertEquals(body.message.isHeavy, true);
    assertEquals(body.answer.isHeavy, true);
    assertEquals(body.conversation.isHeavy, true);
    assertEquals(body.conversation.title, null);
    assertEquals(body.usage, null);

    await world.settleBackground();
    assertEquals(usageBumps(world).length, 0);
    assertEquals(counted(world, "screened"), 1);
    assertEquals(counted(world, "flagged_model"), 1);
    assertEquals(counted(world, "free_answered"), 0);
    assertEquals(unscopedRequests(world, USER), []);
    const line = lastLog(world);
    assertEquals(line.reason, "scholar:heavy");
    assertEquals(line.screen, "crisis");
    assertEquals(line.crisisSource, "model");
    assertEquals(line.limit, "exempt");
    assertEquals(line.model, "gemini-heavy-model");
    assert(!JSON.stringify(line).includes(TIRED.slice(0, 20)));
  }),
);

Deno.test(
  "the phrase list decides at once: no screening call, no everyday answer, only the heavy model",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(PHRASE_TEXT)));
    assertEquals(world.screenCalls.length, 0);
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-heavy-model"]);
    assertEquals(body.answer.isHeavy, true);
    assertEquals(lastLog(world).crisisSource, "phrase");
    await world.settleBackground();
    assertEquals(counted(world, "flagged_phrase"), 1);
  }),
);

Deno.test(
  "uncertain and a blocked screening are heavy, each with its counter",
  flow(async (world) => {
    world.screenQueue.push(geminiOk(screenOutput({ risk: "uncertain", categories: ["self_harm"] })));
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    const first = await ok(await send(world, typed(TIRED)));
    assertEquals(first.answer.isHeavy, true);
    assertEquals(lastLog(world).crisisSource, "uncertain");

    world.screenQueue.push(blocked());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    const second = await ok(await send(world, typed(TIRED, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(second.answer.isHeavy, true);
    assertEquals(lastLog(world).crisisSource, "blocked");
    await world.settleBackground();
    assertEquals(counted(world, "flagged_uncertain"), 1);
    assertEquals(counted(world, "flagged_blocked"), 1);
  }),
);

Deno.test(
  "the writer's own flag: its reply is thrown away, and the heavy model writes the answer",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput({ is_heavy: true })), geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model", "gemini-heavy-model"]);
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
    assertEquals(body.message.isHeavy, true);
    assertEquals(body.conversation.isHeavy, true);
    const line = lastLog(world);
    assertEquals(line.screen, "clear");
    assertEquals(line.crisisSource, "model");
    await world.settleBackground();
    assertEquals(counted(world, "flagged_writer"), 1);
    assertEquals(usageBumps(world).length, 0);
  }),
);

Deno.test(
  "a safety block on the everyday writer is heavy too",
  flow(async (world) => {
    world.geminiQueue.push(blocked(), geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
    assertEquals(lastLog(world).crisisSource, "blocked");
    await world.settleBackground();
    assertEquals(counted(world, "flagged_writer"), 1);
  }),
);

Deno.test(
  "a heavy answer that fails its checks twice is the written fallback, every attempt on the heavy model",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    const quoted = heavyAnswer({ reply: `You wrote “it is all too much” and I hear you. ${HEAVY_REPLY}` });
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(quoted), geminiOk(quoted));
    const body = await ok(await send(world, typed(TIRED)));

    const heavyCalls = world.geminiCalls.slice(1);
    assertEquals(heavyCalls.map(modelOf), ["gemini-heavy-model", "gemini-heavy-model"]);
    assert(inputOf(heavyCalls[1]).includes("<correction>"), "the retry says what to fix");
    assertEquals(body.answer.blocks.map((block) => block.type), ["text", "passage"]);
    assertEquals(textBlock(body.answer), GENERAL);
    const passage = body.answer.blocks[1];
    assert(passage.type === "passage" && passage.scripture.reference === "Isaiah 41:10");
    assert(passage.type === "passage" && (passage.scripture.text ?? "").startsWith("Do not fear"));
    assertEquals(body.answer.isHeavy, true);
    const line = lastLog(world);
    assertEquals(line.reason, "scholar:fallback:unwritten");
    assertEquals(line.fallbackAttempts, 0);
    await world.settleBackground();
    assertEquals(counted(world, "fallbacks"), 1);
  }),
);

Deno.test(
  "a busy heavy model is never swapped for another: every attempt stays on it, then the written fallback",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), ...everyAttempt(geminiError(503)));
    const body = await ok(await send(world, typed(TIRED)));
    const heavyCalls = world.geminiCalls.slice(1);
    assertEquals(heavyCalls.length, MAX_ATTEMPTS);
    assert(heavyCalls.every((call) => modelOf(call) === "gemini-heavy-model"));
    assertEquals(textBlock(body.answer), GENERAL);
    assertEquals(lastLog(world).reason, "scholar:fallback:unwritten");
  }),
);

Deno.test(
  "a heavy reply that types a verse is asked for once more when there is time, and is the fallback when there is not",
  flow(async (world) => {
    const typedVerse = heavyAnswer({
      passage_key: "ISA_41_10",
      reply: `${HEAVY_REPLY} Do not fear, for I am with you; do not be afraid, for I am your God.`,
    });
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(typedVerse), geminiOk(heavyAnswer()));
    const first = await ok(await send(world, typed(TIRED)));
    assertEquals(textBlock(first.answer), HEAVY_REPLY);
    assert(inputOf(world.geminiCalls[2]).includes(TYPED_VERSE_NOTE));

    // Less than twelve seconds of the heavy budget: no second attempt, the written fallback.
    scholarTiming.heavy.totalMs = 11_000;
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(typedVerse));
    const before = world.geminiCalls.length;
    const second = await ok(await send(world, typed(TIRED, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(world.geminiCalls.length - before, 2);
    assertEquals(textBlock(second.answer), GENERAL);
  }),
);

Deno.test(
  "the readers' passages: a key this situation excludes is never read, the first heavy answer gets its default, none twice",
  flow(async (world) => {
    // Someone is hurting the person: Isaiah 41:10 ("do not fear") is excluded, and the first answer gets Psalm 9:9–10.
    world.screenQueue.push(crisis({ categories: ["abuse_or_danger_now"] }));
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer({ passage_key: "ISA_41_10" })));
    const first = await ok(await send(world, typed(TIRED)));
    assert(
      !world.bibleCalls.some((call) => call.url.pathname.includes("/ISA/41")),
      "an excluded passage is not even read",
    );
    const passage = first.answer.blocks.find((block) => block.type === "passage");
    assert(passage?.type === "passage" && passage.scripture.reference === "Psalm 9:9–10");
    assert(inputOf(world.geminiCalls[1]).includes("Passages you may not use now: ISA_41_10, DEU_31_8."));

    // The conversation is heavy now: the next answer is the heavy model's even for a clear message, with no help line, the
    // passage it already showed never shown again, no default added to a later answer, and nothing counted.
    world.geminiQueue.push(geminiOk(heavyAnswer({ passage_key: "PSA_9_9_10", reply: HEAVY_REPLY_2 })));
    const next = await ok(await send(world, typed("Thank you for staying with me.", { messageId: NEXT })));
    assertEquals(world.geminiCalls.slice(2).map(modelOf), ["gemini-heavy-model"]);
    assert(inputOf(world.geminiCalls[2]).includes("Passages you may not use now: ISA_41_10, DEU_31_8, PSA_9_9_10."));
    assertEquals(next.answer.blocks.map((block) => block.type), ["text"]);
    assertEquals(next.message.isHeavy, false);
    assertEquals(next.answer.isHeavy, false);
    assertEquals(next.answer.helpLine, null);
    assertEquals(next.usage, null);
    assertEquals(lastLog(world).reason, "scholar:heavy");
    await world.settleBackground();
    assertEquals(usageBumps(world).length, 0);
  }),
);

Deno.test(
  "a heavy message over the day's limit is answered and never counted",
  flow(async (world) => {
    seedUsage(world, 5);
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(body.answer.isHeavy, true);
    assertEquals(body.usage, null);
    // The stored plan had nothing left, so no everyday answer was started.
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-heavy-model"]);
    await world.settleBackground();
    assertEquals(usageBumps(world).length, 0);
    assertEquals(world.scholarUsage[0].messages, 5);
  }),
);

// ---- Spoken messages -----------------------------------------------------------------------------------------------------------

Deno.test(
  "a spoken message is transcribed and screened first, answered from its words; the recording and stray takes go",
  flow(async (world) => {
    world.seedUser(USER);
    const stray = `${USER}/raw/chat-${crypto.randomUUID()}.m4a`;
    const fresh = `${USER}/raw/chat-${crypto.randomUUID()}.m4a`;
    const reflection = `${USER}/raw/${crypto.randomUUID()}.m4a`;
    for (const path of [recordingPath(), stray, fresh, reflection]) {
      world.storage.set(path, new Uint8Array([1, 2, 3, 4]));
    }
    world.storageTimes.set(fresh, new Date().toISOString());
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, spoken()));

    assertEquals(world.callOrder, ["screening", "reflection"]);
    assert((world.screenCalls[0].json as Row).input instanceof Array, "the screening heard the recording");
    assert(inputOf(world.geminiCalls[0]).includes(`<message>\n${SPOKEN}\n</message>`));
    assertEquals(body.message.inputType, "audio");
    assertEquals(body.message.blocks, [{ type: "text", text: SPOKEN }]);
    assertEquals(world.storage.has(recordingPath()), false);
    await world.settleBackground();
    assertEquals(world.storage.has(stray), false);
    assertEquals(world.storage.has(fresh), true);
    assertEquals(world.storage.has(reflection), true);
    assertEquals(lastLog(world).inputType, "audio");
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "a spoken message whose recording is missing is AUDIO_NOT_FOUND, released for a retry, with no model call",
  flow(async (world) => {
    await refused(await send(world, spoken()), 422, "AUDIO_NOT_FOUND");
    assertEquals(messageRow(world)?.status, "failed");
    assertEquals(messageRow(world)?.error_code, "AUDIO_NOT_FOUND");
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "nothing heard is NO_SPEECH: the message fails and the recording goes",
  flow(async (world) => {
    world.seedUser(USER);
    world.storage.set(recordingPath(), new Uint8Array([1, 2, 3, 4]));
    world.screenQueue.push(geminiOk(screenOutput({ no_speech: true, transcript: "" })));
    await refused(await send(world, spoken()), 422, "NO_SPEECH");
    assertEquals(messageRow(world)?.error_code, "NO_SPEECH");
    assertEquals(world.storage.has(recordingPath()), false);
    assertEquals(world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "a recording the screening was blocked from is answered with the written fallback, and the recording goes",
  flow(async (world) => {
    world.seedUser(USER);
    world.storage.set(recordingPath(), new Uint8Array([1, 2, 3, 4]));
    world.screenQueue.push(blocked());
    const body = await ok(await send(world, spoken()));
    assertEquals(world.geminiCalls.length, 0);
    assertEquals(textBlock(body.answer), GENERAL);
    assertEquals(body.message.blocks, []);
    assertEquals(world.storage.has(recordingPath()), false);
    assertEquals(lastLog(world).reason, "scholar:fallback:blocked");
    await world.settleBackground();
    assertEquals(counted(world, "flagged_blocked"), 1);
    assertEquals(counted(world, "fallbacks"), 1);
  }),
);

Deno.test(
  "a held spoken message is answered from its saved words: the recording is not read again",
  flow(async (world) => {
    seedUsage(world, 5);
    world.storage.set(recordingPath(), new Uint8Array([1, 2, 3, 4]));
    const held = await refused(await send(world, spoken()), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
    assertEquals(held.usage, { kind: "free_day", used: 5, limit: 5, remaining: 0, resetsAt: nextMidnight() });
    assertEquals(messageRow(world)?.status, "failed");
    assertEquals(messageRow(world)?.error_code, "LIMIT_REACHED");
    assertEquals((messageRow(world)?.content as Row).blocks, [{ type: "text", text: SPOKEN }]);
    assertEquals(world.storage.has(recordingPath()), false);
    assertEquals(world.geminiCalls.length, 0);

    setPlan(world, "pro");
    world.geminiQueue.push(geminiOk(answerOutput()));
    const downloads = world.downloads.length;
    const body = await ok(await send(world, spoken()));
    assertEquals(world.downloads.length, downloads);
    assertEquals(typeof (world.screenCalls[1].json as Row).input, "string", "screened from its words, as text");
    assert(inputOf(world.screenCalls[1]).includes(SPOKEN));
    assertEquals(body.message.blocks, [{ type: "text", text: SPOKEN }]);
    assertEquals(body.usage?.kind, "pro_day");
    assertEquals(body.usage?.used, 6);
  }),
);

// ---- Limits --------------------------------------------------------------------------------------------------------------------

Deno.test(
  "the day's allowance: five for free and forty for Pro, after the screening, with nothing written and no answer started",
  flow(async (world) => {
    seedUsage(world, 5);
    const free = await refused(await send(world, typed()), 402, "LIMIT_REACHED") as unknown as ScholarLimitError;
    assertEquals(free.usage.kind, "free_day");
    assertEquals(free.usage.remaining, 0);
    assertEquals(world.screenCalls.length, 1, "the limit comes after the screening");
    assertEquals(world.geminiCalls.length, 0, "no answer is started for a plan with nothing left");
    assertEquals(messageRow(world)?.error_code, "LIMIT_REACHED");
    assertEquals(lastLog(world).limit, "free_blocked");

    world.scholarUsage[0].messages = 40;
    setPlan(world, "pro");
    const pro = await refused(
      await send(world, typed(ASK, { conversationId: SECOND, messageId: NEXT })),
      402,
      "LIMIT_REACHED",
    ) as unknown as ScholarLimitError;
    assertEquals(pro.usage, { kind: "pro_day", used: 40, limit: 40, remaining: 0, resetsAt: nextMidnight() });

    world.scholarUsage[0].messages = 39;
    setPlan(world, "trial");
    world.geminiQueue.push(geminiOk(answerOutput()));
    const trial = await ok(await send(world, typed(ASK, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(trial.usage, { kind: "pro_day", used: 40, limit: 40, remaining: 0, resetsAt: nextMidnight() });
    await world.settleBackground();
    assertEquals(counted(world, "free_answered"), 0);
  }),
);

Deno.test(
  "a paid plan whose end date has passed is read again from RevenueCat before the allowance",
  flow(async (world) => {
    seedUsage(world, 5);
    setPlan(world, "pro", "2026-01-01T00:00:00.000Z");
    await refused(await send(world, typed()), 402, "LIMIT_REACHED");
    assertEquals(world.revenuecatCalls.length, 1);
    const line = lastLog(world);
    assertEquals(line.billing, "synced");
    assertEquals(line.limit, "free_blocked");
  }),
);

Deno.test(
  "the free budget: past the day's ceiling a free account's clear message rests; Pro and a heavy message are not affected",
  flow(async (world) => {
    Deno.env.set("SCHOLAR_FREE_DAILY_BUDGET", "2");
    const day: Row = { day: utcToday(), free_answered: 2 };
    for (const counter of ["screened", "flagged_phrase", "flagged_model", "flagged_uncertain"]) day[counter] = 0;
    for (const counter of ["flagged_blocked", "flagged_writer", "fallbacks", "screen_failed"]) day[counter] = 0;
    world.safetyDaily.push(day);
    await refused(await send(world, typed()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "scholar:budget");
    assertEquals(messageRow(world)?.error_code, "SCHOLAR_UNAVAILABLE");
    assertEquals(world.geminiCalls.length, 0);

    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const heavy = await ok(await send(world, typed(TIRED, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(heavy.answer.isHeavy, true);

    setPlan(world, "pro");
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed()));
  }),
);

Deno.test(
  "the rate limit: thirty messages in ten minutes, whatever they were",
  flow(async (world) => {
    seedConversation(world, { id: SECOND });
    const recent = new Date(Date.now() - 60_000).toISOString();
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    for (let index = 0; index < 29; index += 1) seedMessage(world, { conversation_id: SECOND, created_at: recent });
    for (let index = 0; index < 5; index += 1) seedMessage(world, { conversation_id: SECOND, created_at: old });
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed()));

    seedMessage(world, { conversation_id: SECOND, created_at: recent });
    await refused(await send(world, typed(ASK, { messageId: NEXT })), 429, "RATE_LIMITED");
    assertEquals(messageRow(world, NEXT), undefined);
  }),
);

// ---- The switch and the secrets ---------------------------------------------------------------------------------------------

Deno.test(
  "the switch off: no model, nothing written for a clear message, the written fallback for a heavy one",
  flow(async (world) => {
    Deno.env.set("SCHOLAR_ENABLED", "false");
    Deno.env.delete("SCHOLAR_MODEL");
    await refused(await send(world, typed()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "scholar:off");
    assertEquals(world.conversations.length + world.messages.length, 0);

    world.storage.set(recordingPath(), new Uint8Array([1, 2, 3, 4]));
    await refused(await send(world, spoken()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(world.storage.has(recordingPath()), true, "the recording is left for a retry");

    const flagged = await ok(await send(world, typed(PHRASE_TEXT, { conversationId: SECOND, messageId: NEXT })));
    assertEquals(textBlock(flagged.answer), GENERAL);
    assertEquals(cardOf(flagged.answer), "Isaiah 41:10");
    assertEquals(flagged.answer.helpLine, "crisis");
    assertEquals(flagged.message.isHeavy, true);
    assertEquals(flagged.answer.isHeavy, true);
    assertEquals(flagged.conversation.isHeavy, true);
    assertEquals(lastLog(world).reason, "scholar:fallback:off");

    // A heavy conversation: a clear message and a spoken one get the fallback too, and the unread recording goes.
    const later = await ok(
      await send(
        world,
        typed("Are you still there?", {
          conversationId: SECOND,
          messageId: crypto.randomUUID(),
        }),
      ),
    );
    // A second written answer in the conversation is the shorter one, and no card is shown twice.
    assertEquals(textBlock(later.answer), written("repeat"));
    assertEquals(cardOf(later.answer), "Deuteronomy 31:8");
    const voice = crypto.randomUUID();
    world.storage.set(recordingPath(voice), new Uint8Array([1, 2, 3, 4]));
    const heard = await ok(await send(world, spoken({ conversationId: SECOND, messageId: voice })));
    assertEquals(textBlock(heard.answer), written("repeat"));
    assertEquals(cardOf(heard.answer), "Psalm 46:1");
    assertEquals(world.storage.has(recordingPath(voice)), false);

    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
    await world.settleBackground();
    assertEquals(counted(world, "flagged_phrase"), 1);
    assertEquals(counted(world, "fallbacks"), 3);
  }),
);

Deno.test(
  "a missing or malformed model name while the switch is on is a 500 that names the secret, with nothing written",
  flow(async (world) => {
    Deno.env.delete("SCHOLAR_HEAVY_MODEL");
    await refused(await send(world, typed()), 500, "INTERNAL");
    assertEquals(lastLog(world).reason, "bad_config:SCHOLAR_HEAVY_MODEL");
    Deno.env.set("SCHOLAR_HEAVY_MODEL", "not a model!");
    await refused(await send(world, typed()), 500, "INTERNAL");
    assertEquals(lastLog(world).reason, "bad_config:SCHOLAR_HEAVY_MODEL");
    assertEquals(world.conversations.length + world.messages.length, 0);
  }),
);

Deno.test(
  "the screening down: an everyday message is AI_UNAVAILABLE with nothing written, a heavy conversation gets the fallback",
  flow(async (world) => {
    world.screenQueue.push(...everyAttempt(geminiError(503)));
    world.geminiQueue.push(geminiOk(answerOutput()));
    await refused(await send(world, typed()), 503, "AI_UNAVAILABLE");
    assertEquals(messageRow(world)?.error_code, "AI_UNAVAILABLE");
    assertEquals(scholarRows(world).length, 0, "nothing is written for a message that was not screened");

    world.seedUser(USER);
    world.storage.set(recordingPath(NEXT), new Uint8Array([1, 2, 3, 4]));
    world.screenQueue.push(...everyAttempt(geminiError(503)));
    await refused(await send(world, spoken({ conversationId: SECOND, messageId: NEXT })), 503, "AI_UNAVAILABLE");
    assertEquals(world.storage.has(recordingPath(NEXT)), true, "the recording is kept for a retry");

    const heavy = "c0a8012e-0000-4000-8000-000000000003";
    seedConversation(world, { id: heavy, is_heavy: true });
    world.screenQueue.push(...everyAttempt(geminiError(503)));
    const body = await ok(await send(world, typed(ASK, { conversationId: heavy, messageId: crypto.randomUUID() })));
    assertEquals(textBlock(body.answer), GENERAL);
    assertEquals(lastLog(world).reason, "scholar:fallback:screen_failed");
    await world.settleBackground();
    assertEquals(counted(world, "screen_failed"), 3);
  }),
);

// ---- Conversations and reflections -------------------------------------------------------------------------------------------

Deno.test(
  "a conversation opened from a reflection takes its title, and the writer sees the reflection, never asked for a title",
  flow(async (world) => {
    const entry = seedDevotional(world, USER, { scripture_reference: "Philippians 4:6–7", scripture_verified: true });
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, typed(ASK, { entryId: entry.id })));
    assertEquals(body.conversation.entryId, entry.id);
    assertEquals(body.conversation.title, "Peace in the Waiting");
    const turn = inputOf(world.geminiCalls[0]);
    assert(turn.includes("<reflection>"));
    assert(turn.includes("The title: Peace in the Waiting"));
    assert(turn.includes(TEXT));
    assert(turn.includes("The passage: Philippians 4:6–7"));
    assert(!turn.includes(TITLE_REQUEST));
    assertEquals(unscopedRequests(world, USER), []);

    // The next message of that conversation does not need to send the entry again.
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed("And what does the next verse mean?", { messageId: NEXT })));
    assert(inputOf(world.geminiCalls[1]).includes("<reflection>"));
  }),
);

Deno.test(
  "a conversation opened from a heavy reflection starts heavy and untitled, and only the heavy model answers",
  flow(async (world) => {
    const entry = seedDevotional(world, USER, { is_crisis: true });
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const body = await ok(await send(world, typed(ASK, { entryId: entry.id })));
    assertEquals(body.conversation.isHeavy, true);
    assertEquals(body.conversation.title, null);
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-heavy-model"]);
    assertEquals(body.usage, null);
    assertEquals(lastLog(world).reason, "scholar:heavy");
    await world.settleBackground();
    assertEquals(usageBumps(world).length, 0);
    assertEquals(counted(world, "flagged_model") + counted(world, "flagged_writer"), 0, "the message was not flagged");
  }),
);

Deno.test(
  "the person's conversation about a reflection is used again, whatever id the phone made",
  flow(async (world) => {
    const entry = seedDevotional(world, USER);
    seedConversation(world, { id: SECOND, entry_id: entry.id, title: "Peace in the Waiting" });
    seedExchange(world, "Why this passage?", "Because it speaks of peace.", SECOND);
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, typed(ASK, { entryId: entry.id })));
    assertEquals(body.conversation.id, SECOND);
    assertEquals(body.message.conversationId, SECOND);
    assertEquals(world.conversations.filter((row) => row.id === CONVERSATION).length, 0);
    assert(inputOf(world.geminiCalls[0]).includes("Why this passage?"), "the conversation's history is the one used");
  }),
);

Deno.test(
  "another person's reflection, a missing one and one not ready are NOT_FOUND, with nothing written",
  flow(async (world) => {
    const theirs = seedDevotional(world, OTHER);
    const preparing = seedDevotional(world, USER, { processing_status: "processing", devotional_script: null });
    for (const entryId of [theirs.id, crypto.randomUUID(), preparing.id]) {
      await refused(await send(world, typed(ASK, { entryId })), 404, "NOT_FOUND");
    }
    assertEquals(world.conversations.length + world.messages.length, 0);
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "another person's conversation id is NOT_FOUND, and theirs is untouched",
  flow(async (world) => {
    seedConversation(world, { user_id: OTHER, title: "Theirs" });
    await refused(await send(world, typed()), 404, "NOT_FOUND");
    assertEquals(world.messages.length, 0);
    assertEquals(world.conversations.length, 1);
    assertEquals(world.conversations[0].title, "Theirs");
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "a message of another conversation, an answer's id, or another input type is refused",
  flow(async (world) => {
    seedConversation(world, { id: SECOND });
    seedMessage(world, { id: MESSAGE, conversation_id: SECOND, status: "failed" });
    await refused(await send(world, typed()), 400, "INVALID_REQUEST");
    assertEquals(lastLog(world).reason, "message_conversation");

    const answerId = crypto.randomUUID();
    seedMessage(world, { id: answerId, conversation_id: SECOND, role: "scholar", reply_to: MESSAGE, input_type: null });
    await refused(
      await send(world, typed(ASK, { conversationId: SECOND, messageId: answerId })),
      400,
      "INVALID_REQUEST",
    );
    assertEquals(lastLog(world).reason, "message_role");

    // A typed message with no answer yet, sent again as a spoken one.
    seedMessage(world, { id: NEXT, conversation_id: SECOND, status: "failed" });
    await refused(await send(world, spoken({ conversationId: SECOND, messageId: NEXT })), 400, "INVALID_REQUEST");
    assertEquals(lastLog(world).reason, "message_input");
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);
  }),
);

// ---- The claim, the replay and the save ------------------------------------------------------------------------------------

Deno.test(
  "the claim: a message being answered is ALREADY_PROCESSING; a failed or lapsed one is claimed again and moves to the end",
  flow(async (world) => {
    seedConversation(world);
    const busy = seedMessage(world, { id: MESSAGE, status: "pending", claimed_at: new Date().toISOString() });
    await refused(await send(world, typed()), 409, "ALREADY_PROCESSING");
    assertEquals(world.screenCalls.length + world.geminiCalls.length, 0);

    busy.claimed_at = new Date(Date.now() - 2 * 60_000).toISOString();
    const lapsedAt = String(busy.created_at);
    world.geminiQueue.push(geminiOk(answerOutput()));
    const lapsed = await ok(await send(world, typed()));
    assert(lapsed.message.createdAt > lapsedAt, "a message claimed again moves to the end");

    const failed = seedMessage(world, { id: NEXT, status: "failed", error_code: "AI_UNAVAILABLE" });
    const failedAt = String(failed.created_at);
    world.geminiQueue.push(geminiOk(answerOutput()));
    const again = await ok(await send(world, typed("A question asked again.", { messageId: NEXT })));
    assert(again.message.createdAt > failedAt);
    assertEquals(again.message.errorCode, null);
    assertEquals(again.message.blocks, [{ type: "text", text: "A question asked again." }]);
  }),
);

Deno.test(
  "a replay answers the saved answer with no model call and nothing counted, even with the switch off",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput()));
    const first = await ok(await send(world, typed()));
    await world.settleBackground();
    const calls = world.screenCalls.length + world.geminiCalls.length;
    const counters = world.rpcCalls.length;

    const again = await ok(await send(world, typed()));
    assertEquals(again.answer.id, first.answer.id);
    assertEquals(again.usage, { kind: "free_day", used: 1, limit: 5, remaining: 4, resetsAt: nextMidnight() });
    assertEquals(lastLog(world).reason, "scholar:replayed");

    Deno.env.set("SCHOLAR_ENABLED", "false");
    const off = await ok(await send(world, typed()));
    assertEquals(off.answer.id, first.answer.id);
    await world.settleBackground();
    assertEquals(world.screenCalls.length + world.geminiCalls.length, calls);
    assertEquals(world.rpcCalls.length, counters);
    assertEquals(scholarRows(world).length, 1);
  }),
);

Deno.test(
  "an answer another request saved first is returned, not saved twice",
  flow(async (world) => {
    world.beforeReply = () => {
      world.messages.push({
        id: crypto.randomUUID(),
        conversation_id: CONVERSATION,
        user_id: USER,
        role: "scholar",
        reply_to: MESSAGE,
        input_type: null,
        status: "ready",
        error_code: null,
        content: { blocks: [{ type: "text", text: "Answered by the other request." }] },
        is_heavy: false,
        claimed_at: null,
        created_at: world.now(),
      });
    };
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, typed()));
    assertEquals(textBlock(body.answer), "Answered by the other request.");
    assertEquals(body.message.status, "ready");
    assertEquals(scholarRows(world).length, 1);
    assertEquals(lastLog(world).reason, "scholar:replayed");
  }),
);

Deno.test(
  "a conversation deleted while its answer is written answers NOT_FOUND and leaves nothing behind",
  flow(async (world) => {
    world.beforeReply = () => {
      world.conversations.splice(0, world.conversations.length);
      world.messages.splice(0, world.messages.length);
    };
    world.geminiQueue.push(geminiOk(answerOutput()));
    await refused(await send(world, typed()), 404, "NOT_FOUND");
    assertEquals(world.conversations.length + world.messages.length, 0);
    await world.settleBackground();
    assertEquals(usageBumps(world).length, 0);
  }),
);

// ---- scholar-v2 (2026-11-11, after the readers' review) ------------------------------------------------------------------------

Deno.test(
  "scholar-v2: the help line follows what was found, is saved with the answer, and the heavy model is told it",
  flow(async (world) => {
    // Someone is hurting the person: the National Domestic Violence Hotline, with 911 for danger now.
    world.screenQueue.push(crisis({ categories: ["abuse_or_danger_now", "self_harm"] }));
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer({ passage_key: "PSA_9_9_10" })));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals([body.answer.isHeavy, body.answer.helpLine, body.message.isHeavy], [true, "abuse", true]);
    const saved = scholarRows(world)[0].content as Row;
    assertEquals(saved.help, "abuse");
    assertEquals(Object.keys(saved).sort(), ["blocks", "help"]);
    const heavyTurn = inputOf(world.geminiCalls[1]);
    assert(heavyTurn.includes("The help line under your answer: the National Domestic Violence Hotline"), heavyTurn);
    assert(heavyTurn.includes("If they are in danger right now: 911."));
    assert(heavyTurn.includes("never tell them not to be afraid"));

    // A phrase about harming someone else is decided at once: 988 with 911.
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const others = await ok(
      await send(world, typed("I am going to hurt someone.", { conversationId: SECOND, messageId: NEXT })),
    );
    assertEquals(others.answer.helpLine, "harm_others");
    assert(inputOf(world.geminiCalls[2]).includes("the 988 Suicide & Crisis Lifeline"));

    // The writer's own flag carries the 988 line, and a clear answer carries none.
    assertEquals(scholarRows(world, NEXT)[0].is_heavy, true);
    // No help line, category or phrase is ever in a log line.
    for (const line of world.logs) {
      for (const word of ["abuse", "harm_others", "emergency", "self_harm", "hurt someone"]) {
        assert(!String(line).includes(word), word);
      }
    }
  }),
);

Deno.test(
  "scholar-v2: harm already underway gets the written emergency answer at once, before any model writes, and stays open",
  flow(async (world) => {
    world.screenQueue.push(crisis({ categories: ["medical_emergency", "suicide"] }));
    // The everyday answer started with the screening, and is thrown away.
    world.geminiQueue.push(geminiOk(answerOutput()));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(textBlock(body.answer), written("emergency", "emergency"));
    assertEquals(world.screenCalls.length, 1, "a first message's emergency is not confirmed: nothing came before it");
    assert(textBlock(body.answer)?.startsWith("Please call 911 right now."));
    assertEquals(body.answer.blocks.map((block) => block.type), ["text"], "nothing stands before the number");
    assertEquals([body.answer.helpLine, body.answer.isHeavy, body.conversation.isHeavy], ["emergency", true, true]);
    assertEquals(world.geminiCalls.map(modelOf), ["gemini-scholar-model"], "no heavy model was asked");
    assertEquals(world.judgeCalls.length, 0);
    assertEquals((scholarRows(world)[0].content as Row).fallback, "emergency");
    assertEquals(lastLog(world).reason, "scholar:emergency");
    await world.settleBackground();
    assertEquals(counted(world, "fallbacks"), 0, "an emergency answer is not a failure to write one");
    assertEquals(counted(world, "flagged_model"), 1);

    // The conversation stays open: the next message is answered by the heavy model, told the emergency line.
    world.geminiQueue.push(geminiOk(heavyAnswer({ reply: HEAVY_REPLY_2 })));
    const next = await ok(await send(world, typed("I called. They are on their way.", { messageId: NEXT })));
    assertEquals(textBlock(next.answer), HEAVY_REPLY_2);
    assertEquals(modelOf(world.geminiCalls[1]), "gemini-heavy-model");
    assert(inputOf(world.geminiCalls[1]).includes("The help line under your answer: 911."));
  }),
);

// screen-chat-v4 (the step 38 walk-through's B9): a thank-you after two disclosures was named an emergency in the light of the
// conversation half the time, and the written emergency answer skips the model, so the person was told to call for help instead
// of being given the verse they asked for. An emergency named with earlier messages before it is confirmed on the message alone.
Deno.test(
  "screen-chat-v4: an emergency named only in the light of earlier messages, and clear alone, gets a real heavy answer",
  flow(async (world) => {
    // The first message is decided by the phrase list (no screening call), and the heavy model answers it with the 988 line.
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const first = await ok(await send(world, typed(PHRASE_TEXT)));
    assertEquals(first.answer.helpLine, "crisis");
    assertEquals(world.screenCalls.length, 0);

    // In the light of the conversation the follow-up is named an emergency; alone it is clear (the queue's default).
    world.screenQueue.push(crisis({ categories: ["medical_emergency"] }));
    world.geminiQueue.push(geminiOk(heavyAnswer({ reply: HEAVY_REPLY_2, passage_key: "none" })));
    const next = await ok(await send(world, typed("Thank you. Can you show me a verse?", { messageId: NEXT })));
    assertEquals(world.screenCalls.length, 2, "screened with the conversation, then confirmed alone");
    assert(inputOf(world.screenCalls[0]).includes("<conversation>"), "the first screening reads the conversation");
    assert(!inputOf(world.screenCalls[1]).includes("<conversation>"), "the confirmation reads the message alone");
    assertEquals(textBlock(next.answer), HEAVY_REPLY_2, "the heavy model answered the person");
    assertEquals(
      [next.answer.isHeavy, next.answer.helpLine],
      [true, "crisis"],
      "the conversation's own line, never emergency",
    );
    assertEquals(modelOf(world.geminiCalls[1]), "gemini-heavy-model");
    assert(!inputOf(world.geminiCalls[1]).includes("The help line under your answer: 911."));
    assertEquals((scholarRows(world, NEXT)[0].content as Row).fallback, undefined, "no written answer");
    assertEquals(lastLog(world).reason, "scholar:heavy");
  }),
);

Deno.test(
  "screen-chat-v4: an emergency the message alone also names keeps the written emergency answer, at once",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    await ok(await send(world, typed(PHRASE_TEXT)));
    world.screenQueue.push(
      crisis({ categories: ["medical_emergency"] }),
      crisis({ categories: ["medical_emergency"] }),
    );
    const calls = world.geminiCalls.length;
    const next = await ok(await send(world, typed("Please help me now.", { messageId: NEXT })));
    assertEquals(world.screenCalls.length, 2);
    assertEquals(textBlock(next.answer), written("emergency", "emergency"));
    assertEquals([next.answer.isHeavy, next.answer.helpLine], [true, "emergency"]);
    assertEquals(world.geminiCalls.length, calls, "no model wrote it");
    assertEquals(lastLog(world).reason, "scholar:emergency");

    // After that emergency answer, a message named an emergency only in its light, and clear alone, gets the 988 line: danger
    // told earlier never makes a later message an emergency by itself.
    const THIRD = "c0a8012e-0000-4000-8000-0000000000a3";
    world.screenQueue.push(crisis({ categories: ["medical_emergency"] }));
    world.geminiQueue.push(geminiOk(heavyAnswer({ reply: HEAVY_REPLY_2, passage_key: "none" })));
    const after = await ok(await send(world, typed("Thank you. They are here now.", { messageId: THIRD })));
    assertEquals([after.answer.isHeavy, after.answer.helpLine], [true, "crisis"]);
    assertEquals(textBlock(after.answer), HEAVY_REPLY_2);
    assertEquals(lastLog(world).reason, "scholar:heavy");
  }),
);

Deno.test(
  "screen-chat-v4: a confirmation that cannot be had keeps the emergency answer; another line alone is used as it is",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    await ok(await send(world, typed(PHRASE_TEXT)));

    // The confirmation fails on every attempt: the safe answer stands.
    world.screenQueue.push(crisis({ categories: ["medical_emergency"] }), ...everyAttempt(geminiError(503)));
    const failed = await ok(await send(world, typed("Please help me now.", { messageId: NEXT })));
    assertEquals([failed.answer.helpLine, textBlock(failed.answer)], ["emergency", written("emergency", "emergency")]);
    assertEquals(lastLog(world).reason, "scholar:emergency");

    // Alone, the message names another line: the heavy model answers with that line.
    const THIRD = "c0a8012e-0000-4000-8000-0000000000a3";
    world.screenQueue.push(
      crisis({ categories: ["medical_emergency"] }),
      crisis({ categories: ["abuse_or_danger_now"] }),
    );
    world.geminiQueue.push(geminiOk(heavyAnswer({ reply: HEAVY_REPLY_2, passage_key: "none" })));
    const other = await ok(await send(world, typed("He is still shouting downstairs.", { messageId: THIRD })));
    assertEquals([other.answer.isHeavy, other.answer.helpLine], [true, "abuse"]);
    assertEquals(textBlock(other.answer), HEAVY_REPLY_2);
    assert(inputOf(world.geminiCalls.at(-1) as Recorded).includes("the National Domestic Violence Hotline"));
    assertEquals(lastLog(world).reason, "scholar:heavy");

    // Then a message named an emergency only in the light of the conversation, and clear alone, keeps the conversation's own
    // line: the domestic violence line of the answer before it, not 988.
    const FOURTH = "c0a8012e-0000-4000-8000-0000000000a4";
    world.screenQueue.push(crisis({ categories: ["medical_emergency"] }));
    world.geminiQueue.push(geminiOk(heavyAnswer({ reply: HEAVY_REPLY_2, passage_key: "none" })));
    const kept = await ok(await send(world, typed("Thank you for staying with me.", { messageId: FOURTH })));
    assertEquals([kept.answer.isHeavy, kept.answer.helpLine], [true, "abuse"]);
  }),
);

Deno.test(
  "scholar-v2: a person who says they are under 18 gets a kind answer, Scholar closes, and a heavy message is still answered",
  flow(async (world) => {
    world.geminiQueue.push(geminiOk(answerOutput({ says_under_18: true, prayer: PRAYER })));
    const body = await ok(await send(world, typed("I am fifteen. What does Psalm 23 mean?")));
    assertEquals(textBlock(body.answer), ADULTS_ONLY_TEXT);
    assertEquals(body.answer.blocks.map((block) => block.type), ["text"]);
    assertEquals(body.conversation.title, null);
    assertEquals(lastLog(world).reason, "scholar:adults_only");
    const closedAt = userRow(world).scholar_closed_at;
    assertEquals(closedAt, body.answer.createdAt);

    // A clear message from the account is screened, then refused, and no everyday answer is started.
    const calls = world.geminiCalls.length;
    const refusedBody = await refused(await send(world, typed(ASK, { messageId: NEXT })), 403, "SCHOLAR_ADULTS_ONLY");
    assert(refusedBody.error.message.includes("support@nouvrix.com"));
    assertEquals(world.geminiCalls.length, calls);
    assertEquals(world.screenCalls.length, 2);
    assertEquals(messageRow(world, NEXT)?.error_code, "SCHOLAR_ADULTS_ONLY");
    assertEquals(lastLog(world).reason, "scholar:adults_only");

    // A heavy message from the account is answered in full, under the heavy rules.
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(heavyAnswer()));
    const heavy = await ok(await send(world, typed(TIRED, { conversationId: SECOND, messageId: crypto.randomUUID() })));
    assertEquals(textBlock(heavy.answer), HEAVY_REPLY);
    assertEquals(heavy.answer.helpLine, "crisis");
    assertEquals(lastLog(world).reason, "scholar:heavy");
    assertEquals(userRow(world).scholar_closed_at, closedAt, "the first closing time stays");
  }),
);

Deno.test(
  "scholar-v2: in a heavy moment a person under 18 gets full care first, and Scholar closes after the answer",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer({ says_under_18: true })));
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(textBlock(body.answer), HEAVY_REPLY);
    assertEquals(body.answer.helpLine, "crisis");
    assertEquals(lastLog(world).reason, "scholar:heavy:closed");
    assertEquals(userRow(world).scholar_closed_at, body.answer.createdAt);
  }),
);

Deno.test(
  "scholar-v2: a written answer follows the situation: the answer for someone being hurt and its card, then the shorter one",
  flow(async (world) => {
    world.screenQueue.push(crisis({ categories: ["abuse_or_danger_now"] }));
    world.geminiQueue.push(geminiOk(answerOutput()), ...everyAttempt(geminiError(503)));
    const first = await ok(await send(world, typed(TIRED)));
    assertEquals(textBlock(first.answer), written("abuse", "abuse"));
    assertEquals(cardOf(first.answer), "Psalm 9:9–10");
    assertEquals(first.answer.helpLine, "abuse");
    assertEquals((scholarRows(world)[0].content as Row).fallback, "abuse");
    assertEquals(lastLog(world).reason, "scholar:fallback:unwritten");

    world.geminiQueue.push(...everyAttempt(geminiError(503)));
    const second = await ok(await send(world, typed("Are you still there?", { messageId: NEXT })));
    assertEquals(textBlock(second.answer), written("repeat", "abuse"));
    assertEquals(cardOf(second.answer), "Psalm 46:1");
    assertEquals(second.answer.helpLine, "abuse", "a written answer always carries the line");
    assertEquals((scholarRows(world, NEXT)[0].content as Row).fallback, "repeat");
  }),
);

Deno.test(
  "scholar-v2: outside the US the heavy model and the written answers name no US number",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.geminiQueue.push(geminiOk(answerOutput()), geminiOk(heavyAnswer()));
    await ok(await send(world, typed(TIRED, { region: "NG" })));
    const turn = inputOf(world.geminiCalls[1]);
    const block = turn.slice(turn.indexOf("<heavy_moment>"));
    assert(block.includes("a link to a directory of help lines in their country"), block);
    assert(block.includes("their local emergency number (never name a number)"));
    assert(!/\b(?:988|911)\b/.test(block), block);

    Deno.env.set("SCHOLAR_ENABLED", "false");
    const elsewhere = await ok(
      await send(world, typed(PHRASE_TEXT, { conversationId: SECOND, messageId: NEXT, region: "GB" })),
    );
    const text = textBlock(elsewhere.answer) ?? "";
    assertEquals(text, heavyChatFallback("general", { help: "crisis", region: "other", usedPassages: [] }).reply);
    assert(!/\b(?:988|911)\b/.test(text) && text.includes("the link under this message"), text);
    // A US territory is the US.
    const territory = await ok(
      await send(
        world,
        typed(PHRASE_TEXT, {
          conversationId: "c0a8012e-0000-4000-8000-000000000003",
          messageId: crypto.randomUUID(),
          region: "PR",
        }),
      ),
    );
    assertEquals(textBlock(territory.answer), GENERAL);
  }),
);

Deno.test(
  "scholar-v2: a heavy answer thinks at its own level, and is told the local time, the turn, and how plainly it may be named",
  flow(async (world) => {
    // Whatever level the everyday writer is given, the heavy answer thinks at its own (HEAVY_THINKING_LEVEL).
    Deno.env.set("GEMINI_THINKING_LEVEL", "high");
    world.seedUser(USER);
    userRow(world).timezone = "Africa/Lagos";
    world.geminiQueue.push(
      geminiOk(heavyAnswer({ reply: `${HEAVY_REPLY} I am so sorry you have had thoughts of ending your life.` })),
    );
    const first = await ok(await send(world, typed(PHRASE_TEXT)));
    assertEquals(world.screenCalls.length, 0, "the phrase list decided");
    const heavyCall = world.geminiCalls[0];
    assertEquals(generation(heavyCall).thinking_level, HEAVY_THINKING_LEVEL);
    const heavyLevel: string = HEAVY_THINKING_LEVEL;
    assert(heavyLevel !== "high", "the test tells the two levels apart");
    const turn = inputOf(heavyCall);
    assert(/Their local time: \d{1,2}:\d{2} [AP]M \((?:night|morning|afternoon|evening)\)\./.test(turn), turn);
    assert(turn.includes("This is the first heavy answer in this conversation."));
    assert(turn.includes("Plain naming: allowed once in this conversation, only as thoughts of ending your life."));
    assert(textBlock(first.answer)?.endsWith("thoughts of ending your life."));

    // The next turn: a later answer, plain naming spent, and the passage it showed is not offered again.
    world.geminiQueue.push(geminiOk(heavyAnswer({ passage_key: "none", reply: HEAVY_REPLY_2 })));
    await ok(await send(world, typed(PHRASE_TEXT, { messageId: NEXT })));
    const later = inputOf(world.geminiCalls[1]);
    assert(later.includes("You have answered 1 message in this conversation already"), later);
    assert(later.includes("Plain naming: not allowed."));
    assert(later.includes("Passages you may not use now: PSA_46_1."));

    // An everyday answer keeps the everyday thinking level (the GEMINI_THINKING_LEVEL secret, set above).
    world.geminiQueue.push(geminiOk(answerOutput()));
    await ok(await send(world, typed(ASK, { conversationId: SECOND, messageId: crypto.randomUUID() })));
    assertEquals(generation(world.geminiCalls[2]).thinking_level, "high");
  }),
);

Deno.test(
  "scholar-v2: the judge: an answer that missed the question is written once more, and one that missed a prayer gets one",
  flow(async (world) => {
    world.screenQueue.push(crisis());
    world.judgeQueue.push(geminiOk(judgeOutput({ asked: true, addressed: false })));
    const answered = `${HEAVY_REPLY} You asked whether God still hears you tonight, and he does.`;
    world.geminiQueue.push(
      geminiOk(answerOutput()),
      geminiOk(heavyAnswer()),
      geminiOk(heavyAnswer({ reply: answered })),
    );
    const body = await ok(await send(world, typed(TIRED)));
    assertEquals(world.judgeCalls.length, 1);
    assertEquals(modelOf(world.judgeCalls[0]), "gemini-screen-model");
    assert(inputOf(world.judgeCalls[0]).includes(TIRED), "the judge reads the person's message");
    assert(inputOf(world.geminiCalls[2]).includes(JUDGE_NOTE_UNANSWERED));
    assertEquals(textBlock(body.answer), answered);

    // Asked to pray and no prayer: once more with the prayer note; a try that cannot be had keeps the answer it has.
    world.judgeQueue.push(geminiOk(judgeOutput({ asked: true, addressed: true, prayer_requested: true })));
    world.geminiQueue.push(
      geminiOk(heavyAnswer({ passage_key: "none", reply: HEAVY_REPLY_2 })),
      ...everyAttempt(geminiError(503)),
    );
    const kept = await ok(await send(world, typed("Will you pray for me?", { messageId: NEXT })));
    assert(inputOf(world.geminiCalls[4]).includes(JUDGE_NOTE_PRAYER));
    assertEquals(textBlock(kept.answer), HEAVY_REPLY_2);
    assertEquals(lastLog(world).reason, "scholar:heavy");

    // A judgment that cannot be had changes nothing.
    world.judgeQueue.push(geminiError(503));
    world.geminiQueue.push(
      geminiOk(
        heavyAnswer({
          passage_key: "none",
          reply:
            "God is with you in the dark tonight, and he is not far from you at all. Please tell one person you trust how hard today has been, and keep writing to me here whenever you need to. He has carried you through every hour so far, and he is with you in this one too.",
        }),
      ),
    );
    const before = world.geminiCalls.length;
    await ok(await send(world, typed("Are you still there?", { messageId: crypto.randomUUID() })));
    assertEquals(world.geminiCalls.length - before, 1);
  }),
);
