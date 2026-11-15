import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { matchCrisisGroup } from "../_shared/safety/phrases.ts";
import { ADULTS_ONLY_TEXT, heavyChatFallback, spokenFallback, spokenHelpLine } from "../_shared/scholar/heavyChat.ts";
import { SCHOLAR_SPOKEN_PROMPT_VERSION, type StoredBlock } from "../_shared/scholar/prompt.ts";
import { buildScholarSpeech } from "../_shared/scholar/script.ts";
import { elapsedSeconds, talkCapReached } from "../_shared/voice/allowance.ts";
import { readLlmSecret, readSessionSecret, voiceEnabled } from "../_shared/voice/config.ts";
import { VOICE_REQUEST, voiceTiming } from "../_shared/voice/constants.ts";
import { holdLine, sayNumbers, stopLine, VOICE_LINES } from "../_shared/voice/lines.ts";
import { verifyVoiceSession, type VoiceSession } from "../_shared/voice/session.ts";
import { findSession, markSessionHeavy, recordTurn, type VoiceSessionRow } from "../_shared/voice/sessions.ts";
import { openVoiceStream, type VoiceStream } from "../_shared/voice/sse.ts";
import { isStopOnly } from "../_shared/voice/stop.ts";
import { turnMessageId } from "../_shared/voice/turnId.ts";
import type { ScholarBlock, ScholarTurnResponse } from "../process-entry/contracts.ts";
import { readLimited } from "../process-entry/validate.ts";
import { findConversation } from "../scholar-turn/lifecycle.ts";
import {
  newTurnContext,
  quietly,
  readScholarConfig,
  runAfter,
  runInBackground,
  runTurn,
  type TalkReady,
  type TalkTurn,
  timed,
  type TurnContext,
  turnLogFields,
} from "../scholar-turn/turn.ts";

// scholar-voice-llm (step 39): Scholar's side of a live talk. ElevenLabs hears the person and speaks; it has no model that can
// answer. For each turn it calls this function in the OpenAI chat format and speaks what the function streams back. Every answer
// is written by Scholar's own engine (scholar-turn/turn.ts, runTurn), the one a typed message goes through, so nothing is spoken
// that was not screened first.
//
// The order is fixed, and it is what keeps a person safe:
//   1. POST only, and ElevenLabs' shared secret (the agent's custom LLM key), compared without an early exit. Otherwise 401.
//   2. The body, at most 256 KB. Two things are read from it and nothing else: the person's words since Scholar last spoke
//      (every message of role "user" after the last one of role "assistant"), and elevenlabs_extra_body.session. ElevenLabs' own prompt, history and tools never reach a model of ours: the engine reads the
//      conversation from our database.
//   3. The session: signed by scholar-voice-start, not expired, and its row found for that user and not ended. Otherwise Scholar
//      says the ended line and nothing else happens.
//   4. The words. With no letter or digit in them (a noise), the unheard line, and nothing is saved.
//   5. The phrase list reads the words. When it does not match and the whole turn is only a stop word, the stop line, and nothing
//      is saved.
//   6. The talk's cap and the voice switch, for a conversation that is not heavy. Neither is decided here: the turn goes to the
//      engine with `refuse`, which screens it first and only releases a turn the screening called clear. So a hard moment is
//      answered whatever the cap or the switch.
//   7. The turn. Its message id is worked out from the talk, the turn's number and its words (turnId.ts), so a request ElevenLabs
//      sends again finds the same message. The whole of this function's work runs inside EdgeRuntime.waitUntil, so the answer is
//      finished and saved even when ElevenLabs stops listening (the person spoke again, or the attempt was given up).
//   8. The stream, while the turn runs: a holding line when nothing is ready (voiceTiming), sent so that ElevenLabs speaks it
//      at once (sse.ts, HOLD_PAD), then the answer as the sentences of its Listen script (buildScholarSpeech), with the spoken
//      help line last when the answer carries one. ElevenLabs gives an attempt up after 15 seconds with no new piece, so the
//      moments of a turn are never further apart than that.
//   9. When there is no answer: in a heavy conversation, or for words the phrase list matched, a written answer and the 988 line,
//      never an error and never silence; otherwise the fixed line for what happened (not ready, the cap, switched off, ended).
//  10. After the stream: the talk's row (its last turn, its length, its turns, and heavy when the conversation is).
//  11. A reply is never empty: ElevenLabs takes a reply with no words for a failure and ends the talk at the person's next
//      sentence (measured, 2026-11-13). So every path above says something, a failure of this function's own included.
//
// What a person never hears in a talk: words a model wrote that were not screened, a reading that is not the Berean Standard
// Bible's own text, an error message, or silence where step 38 promises an answer.
//
// The log line is the shared one (43 fields), written when the turn's work is done. Its reason is one word: voice:answered,
// voice:heavy, voice:emergency, voice:fallback:<why>, voice:replayed, voice:joined (the engine's own word with "voice" in front),
// voice:not_ready:<why>, voice:cap, voice:off, voice:adults_only, voice:stop, voice:unheard or voice:ended. It never holds a word
// that was said or spoken, an id, a help line or the voice.

const encoder = new TextEncoder();

// Length is not secret (the shared secret has a fixed shape); the bytes are compared without an early exit.
function sameSecret(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let index = 0; index < x.length; index += 1) diff |= x[index] ^ y[index];
  return diff === 0;
}

// ElevenLabs sends the agent's custom LLM key as a bearer token. The two other headers an OpenAI-style client may use are read
// too; whichever is present must be the secret.
function authorized(req: Request, secret: string): boolean {
  const bearer = req.headers.get("authorization");
  const sent = bearer !== null
    ? bearer.replace(/^Bearer\s+/i, "").trim()
    : (req.headers.get("x-api-key") ?? req.headers.get("api-key"))?.trim();
  return sent !== undefined && sameSecret(sent, secret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text of one chat message: a string, or OpenAI's list of parts, of which only the text parts are read.
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((
      part,
    ) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text.trim()] : []))
    .filter((text) => text !== "")
    .join(" ");
}

// The body as JSON, at most 256 KB. The caller is ElevenLabs, already known by the shared secret, so the content type it
// names is not looked at.
async function readBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > VOICE_REQUEST.maxBodyBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", "body_size");
  }
  const text = await readLimited(req, VOICE_REQUEST.maxBodyBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_REQUEST", "json");
  }
}

// What is read of ElevenLabs' request: the person's words since Scholar last spoke, which turn of the talk it is (the user
// messages so far), and the session our own server signed. Nothing else of the body is looked at.
//
// The words are every user message after the last assistant message, joined in the order ElevenLabs sends them. ElevenLabs can
// put more than one there: a sentence and a fragment it heard while the answer was being written, and not always in the order
// they were said (the walk-through of 2026-11-14 saw a heavy sentence listed before a one-word fragment heard four seconds
// earlier). Reading only the last message answered the fragment and never screened the sentence, so a turn is read whole.
//
// `afterStop` is true when the person's previous turn (the user messages just before Scholar's last line) was only a stop word,
// or when this turn itself begins with a stop word and goes on: they stopped Scholar partway and are back, so the writer is told
// to begin with a short recap (prompt.ts, SPOKEN_RESUME). Only isStopOnly reads those earlier words; no model ever sees them.
export type VoiceCall = { words: string; turnNumber: number; afterStop: boolean; session: unknown };

export function readVoiceCall(body: unknown): VoiceCall {
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  let since: string[] = [];
  let before: string[] = [];
  let turnNumber = 0;
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(message)) continue;
    if (message.role === "assistant") {
      if (since.length > 0) before = since;
      since = [];
      continue;
    }
    if (message.role !== "user") continue;
    turnNumber += 1;
    const text = textOf(message.content).trim();
    if (text !== "") since.push(text);
  }
  const extra = body.elevenlabs_extra_body;
  return {
    words: since.join(" ").trim().slice(0, VOICE_REQUEST.maxWordsChars).trim(),
    afterStop: (before.length > 0 && isStopOnly(before.join(" "))) || (since.length > 1 && isStopOnly(since[0])),
    turnNumber,
    session: isRecord(extra) ? extra.session : undefined,
  };
}

// An answer's blocks as the Listen script reads them (a passage's reference and its text).
function storedBlocks(blocks: readonly ScholarBlock[]): StoredBlock[] {
  return blocks.map((block): StoredBlock =>
    block.type === "passage"
      ? { type: "passage", reference: block.scripture.reference, text: block.scripture.text ?? "" }
      : block
  );
}

// Waits until a moment, or until `stop` settles. True when the moment came first.
function waitUntil(at: number, stop: Promise<unknown>): Promise<boolean> {
  const ms = at - Date.now();
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    stop.then(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

type Settled = { ok: true; value: ScholarTurnResponse } | { ok: false; error: unknown };

// What became of the turn, for the log line: one word, and the engine's error code when it had one.
type Heard = { reason: string; code: string | null };

const word = (error: unknown) =>
  error instanceof AppError ? error.reason : `unhandled:${error instanceof Error ? error.name : "unknown"}`;
const codeOf = (error: unknown) => (error instanceof AppError ? error.code : "INTERNAL");

// The written answer of last resort: said when a hard moment has no answer from the engine at all (it failed, or its time ran
// out). The shorter written answer and the 988 line, in their spoken forms. It is not saved: the engine saves what it finishes.
function lastResort(stream: VoiceStream, region: VoiceSession["region"]): void {
  const written = heavyChatFallback("repeat", { help: "crisis", region, usedPassages: [] });
  const parts = buildScholarSpeech([{ type: "text", text: spokenFallback(written.reply) }], {
    helpLine: spokenHelpLine("crisis", region),
  });
  for (const part of parts) stream.say(sayNumbers(part));
}

async function speakTurn(
  call: VoiceCall,
  sessionSecret: string,
  stream: VoiceStream,
  context: TurnContext,
): Promise<Heard> {
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const fixed = (line: string, reason: string): Heard => {
    stream.say(line);
    stream.end();
    return { reason, code: null };
  };

  // 3. The session.
  const session = await timed(context, "authMs", () => verifyVoiceSession(sessionSecret, call.session));
  if (session === null) return fixed(VOICE_LINES.ended, "voice:ended");
  const userId = session.userId;
  context.userHash = await shortHash(userId);
  const words = call.words;
  // 5 (first half). The phrase list reads the words before anything else is decided about them.
  const phrase = /[\p{L}\p{N}]/u.test(words) && matchCrisisGroup(words) !== null;

  let admin: SupabaseClient | null = null;
  let row: VoiceSessionRow | null = null;
  let heavyKnown = false;
  // The conversation is heavy as far as this request knows: before the turn, by the phrase list, or as the engine found.
  const isHeavy = () => heavyKnown || phrase || context.heavy;

  // 10. After the stream, whatever was said: the talk is alive, and (when this request did a turn's work) one turn further.
  const record = async (counted: boolean) => {
    if (row === null || admin === null) return;
    const [talk, client] = [row, admin];
    const now = Date.now();
    await quietly(
      db(() =>
        recordTurn(client, userId, talk.id, {
          last_turn_at: new Date(now).toISOString(),
          seconds: Math.max(talk.seconds, elapsedSeconds(talk.started_at, now)),
          ...(counted ? { turns: talk.turns + 1 } : {}),
        })
      ),
    );
    if (context.heavy && !talk.is_heavy) await quietly(db(() => markSessionHeavy(client, userId, talk.id)));
  };

  try {
    const client = createAdmin();
    admin = client;
    const [found, conversation] = await db(() =>
      Promise.all([
        findSession(client, userId, session.talkId),
        findConversation(client, userId, session.conversationId),
      ])
    );
    // A talk that has ended (the phone said so, or a newer talk of this account started) answers nothing more.
    if (found === null || found.ended_at !== null) return fixed(VOICE_LINES.ended, "voice:ended");
    row = found;
    heavyKnown = found.is_heavy || conversation?.is_heavy === true;

    // 4. A turn with no word in it.
    if (!/[\p{L}\p{N}]/u.test(words)) {
      const heard = fixed(VOICE_LINES.unheard, "voice:unheard");
      await record(false);
      return heard;
    }

    // 5. A whole turn that is only a stop word.
    if (!phrase && isStopOnly(words)) {
      const heard = fixed(stopLine(heavyKnown), "voice:stop");
      await record(false);
      return heard;
    }

    // 6. The cap and the switch are the engine's to apply, after its screening.
    const refuse: TalkTurn["refuse"] = heavyKnown
      ? null
      : !voiceEnabled()
      ? "off"
      : talkCapReached(found, Date.now())
      ? "cap"
      : null;

    // 7. The turn.
    const t0 = context.startedAt;
    // The answer, the moment it has passed its checks (TalkTurn.onReady): it is spoken while the engine saves it.
    let ready: TalkReady | null = null;
    let markReady = () => {};
    const readied = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const talk: TalkTurn = {
      talkId: session.talkId,
      startedAt: t0,
      answerDeadlineAt: t0 + voiceTiming.answer.totalMs - voiceTiming.settleMs,
      heavyDeadlineAt: t0 + voiceTiming.heavyTotalMs - voiceTiming.settleMs,
      refuse,
      resumed: call.afterStop,
      onReady: (value) => {
        ready = value;
        markReady();
      },
    };
    const config = readScholarConfig();
    const messageId = await turnMessageId(sessionSecret, session.talkId, call.turnNumber, words);
    let result: Settled | null = null;
    const engine: Promise<void> = runTurn({
      admin: client,
      userId,
      request: {
        conversationId: session.conversationId,
        messageId,
        input: { type: "text", text: words },
        entryId: session.reflectionId,
        region: session.region,
      },
      config,
      context,
      talk,
    }).then(
      (value) => {
        result = { ok: true, value };
      },
      (error) => {
        result = { ok: false, error };
      },
    );
    // Whichever comes first: the answer ready to be spoken, or the engine's end (a replay, a joined turn, an error).
    const first: Promise<unknown> = Promise.race([readied, engine]);

    // 8. The holding lines, while nothing is ready. Which one is decided at its own moment: a conversation the screening has
    // just called heavy never hears the everyday line.
    let waiting = true;
    const holding = (async () => {
      let held = false;
      if (!(await waitUntil(t0 + voiceTiming.heavyHoldMs, first)) || !waiting) return;
      if (isHeavy()) {
        stream.hold(VOICE_LINES.holdHeavy);
        held = true;
      }
      if (!(await waitUntil(t0 + voiceTiming.holdMs, first)) || !waiting) return;
      if (!held) stream.hold(holdLine(isHeavy(), false) ?? VOICE_LINES.hold);
      if (!(await waitUntil(t0 + voiceTiming.secondHoldMs, first)) || !waiting) return;
      const second = holdLine(isHeavy(), true);
      if (second !== null) stream.hold(second);
    })();

    // The turn's own time: an everyday answer's, and in a heavy conversation a hard-moment answer's, with room for the engine's
    // written answer to arrive.
    if (await waitUntil(t0 + voiceTiming.answer.totalMs, first) && isHeavy()) {
      await waitUntil(t0 + voiceTiming.heavyTotalMs + voiceTiming.settleMs, first);
    }
    waiting = false;
    const settled = result as Settled | null;

    // 8, 9. What the person hears.
    let heard: Heard;
    const refused = (kind: "cap" | "off"): Heard => {
      stream.say(kind === "cap" ? VOICE_LINES.cap : VOICE_LINES.off);
      return { reason: `voice:${kind}`, code: null };
    };
    // The answer as it was ready (it is saved while it is spoken), or as the engine answered it (a replay, a joined turn).
    const spoken = (ready as TalkReady | null) ?? (settled?.ok ? settled.value.answer : null);
    const parts = spoken === null ? [] : buildScholarSpeech(storedBlocks(spoken.blocks), {
      helpLine: spoken.helpLine === null ? null : spokenHelpLine(spoken.helpLine, session.region),
    });
    const answered = spoken !== null && parts.length > 0;
    if (answered) {
      for (const part of parts) stream.say(sayNumbers(part));
      // The reason is the engine's, once its save has ended (below).
      heard = { reason: "voice:answered", code: null };
    } else {
      const error = settled === null ? null : settled.ok ? new AppError("INTERNAL", "voice:no_words") : settled.error;
      const why = error === null ? "cut" : word(error);
      const code = error === null ? "AI_UNAVAILABLE" : codeOf(error);
      if (isHeavy()) {
        // A hard moment always has an answer: the written one, and the help line.
        lastResort(stream, session.region);
        heard = { reason: `voice:fallback:${error === null ? "cut" : "error"}`, code };
      } else if (code === "LIMIT_REACHED") {
        heard = refused("cap");
      } else if (code === "SCHOLAR_UNAVAILABLE") {
        heard = refused("off");
      } else if (code === "SCHOLAR_ADULTS_ONLY") {
        // Scholar was closed for the account during this talk (the person said they are under 18).
        for (const part of buildScholarSpeech([{ type: "text", text: ADULTS_ONLY_TEXT }], { helpLine: null })) {
          stream.say(part);
        }
        heard = { reason: "voice:adults_only", code };
      } else if (code === "NOT_FOUND") {
        // The conversation or its reflection is gone: this talk cannot go on.
        stream.say(VOICE_LINES.ended);
        heard = { reason: `voice:ended:${why}`, code };
      } else if (refuse !== null) {
        heard = refused(refuse);
      } else {
        stream.say(VOICE_LINES.notReady);
        heard = { reason: `voice:not_ready:${why}`, code };
      }
    }
    stream.end();
    await holding;

    // The engine goes on after the person has heard its answer (it saves it), or after its time is up here (it saves what it
    // finishes); its work is waited for, within a limit, so that the row and the log line say what it did.
    if ((result as Settled | null) === null) await waitUntil(Date.now() + voiceTiming.heavyTotalMs, engine);
    const final = result as Settled | null;
    if (answered) {
      if (final?.ok) {
        const outcome = (context.outcome ?? "scholar:answered").replace(/^scholar:/, "voice:");
        heard = { reason: context.joined && outcome === "voice:replayed" ? "voice:joined" : outcome, code: null };
      } else {
        // The person heard an answer that passed every check, and its save did not end well (the conversation was deleted
        // meanwhile, or the save outlived its time).
        heard = final === null
          ? { reason: "voice:unsaved:timeout", code: "INTERNAL" }
          : { reason: `voice:unsaved:${word(final.error)}`, code: codeOf(final.error) };
      }
    }
    const worked = context.screenStats.attempts + context.writerStats.attempts > 0 || final?.ok === true;
    await record(worked && !context.joined && context.outcome !== "scholar:replayed");
    return heard;
  } catch (error) {
    // Something of this function's own failed (its own settings, a read of the talk's row, a secret of Scholar's): the person
    // still hears a line, and words the phrase list matched still get the written answer. A holding line is not an answer, so
    // it does not count.
    if (stream.said() === 0) {
      if (isHeavy()) lastResort(stream, session.region);
      else stream.say(VOICE_LINES.notReady);
    }
    stream.end();
    await record(false);
    return { reason: `${isHeavy() ? "voice:fallback:error" : "voice:not_ready"}:${word(error)}`, code: codeOf(error) };
  }
}

function writeLine(context: TurnContext, status: number, code: string | null, reason: string | null): void {
  writeLog(blankLogLine({
    requestId: context.requestId,
    status,
    code,
    reason,
    inputType: "audio",
    user: context.userHash,
    totalMs: Date.now() - context.startedAt,
    promptVersion: SCHOLAR_SPOKEN_PROMPT_VERSION,
    ...turnLogFields(context),
  }));
}

export async function handle(req: Request): Promise<Response> {
  const context = newTurnContext();
  context.inputType = "audio";
  let call: VoiceCall;
  let sessionSecret: string;
  try {
    // 1, 2. The method, the shared secret, then the body.
    if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
    if (!authorized(req, readLlmSecret())) throw new AppError("UNAUTHORIZED", "llm_secret");
    sessionSecret = readSessionSecret();
    call = readVoiceCall(await readBody(req));
  } catch (error) {
    const failure = error instanceof AppError ? error : new AppError("INTERNAL", word(error));
    writeLine(context, failure.status, failure.code, failure.reason);
    return errorResponse(failure, context.requestId);
  }

  // From here on the answer is a stream that is open at once (sse.ts says how ElevenLabs reads it). The work runs behind it, and
  // goes on to its end when nobody is listening any more.
  const stream = openVoiceStream();
  runInBackground(
    speakTurn(call, sessionSecret, stream, context)
      .catch((error): Heard => ({ reason: `voice:error:${word(error)}`, code: codeOf(error) }))
      .then(async (heard) => {
        stream.end();
        await runAfter(context);
        writeLine(context, 200, heard.code, heard.reason);
      }),
  );
  return stream.response;
}
