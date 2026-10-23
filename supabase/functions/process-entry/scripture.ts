import { hydrateScripture } from "../_shared/bible/hydrate.ts";
import type { ScriptureRef } from "../_shared/bible/reference.ts";
import { AppError } from "../_shared/errors.ts";
import type { ScriptureOutcome } from "../_shared/log.ts";
import { GeminiBlocked, type GeminiStats, generate } from "./gemini.ts";
import { parseScripturePick } from "./output.ts";
import { buildReplacementInstruction, buildReplacementTurn } from "./prompt.ts";
import { buildScriptureSchema } from "./schema.ts";

// The model says where a passage is; this turns that into what is stored. The words themselves always come from the
// Berean Standard Bible (_shared/bible), never from the model, and nothing here ever stores a fallback verse.
//
//   verified     the passage exists: its exact text is stored, scripture_verified is true
//   replaced     it did not exist; one small follow-up request chose another, which exists
//   unverified   the Bible text could not be read right now: the reference is kept without its text, and
//                confirm-scripture checks it again later
//   dropped      no valid passage was found: the reflection is still saved, without one

export type ResolvedScripture = {
  outcome: ScriptureOutcome;
  reference: string | null;
  text: string | null;
  verified: boolean;
  // Time spent reading the Bible text. The follow-up request to the model counts as model time, in the stats.
  bibleMs: number;
};

export type ResolveArgs = {
  ref: ScriptureRef;
  // What the follow-up request is told about the reflection. Never the person's words.
  title: string;
  emotion: string;
  gemini: { apiKey: string; model: string; thinkingLevel: string };
  deadlineAt: number;
  stats: GeminiStats;
};

// The follow-up answers a few numbers. Thinking is counted in this cap, so it is generous for what it needs.
const REPLACEMENT_MAX_OUTPUT_TOKENS = 1_024;

export async function resolveScripture(args: ResolveArgs): Promise<ResolvedScripture> {
  let bibleMs = 0;
  const look = async (ref: ScriptureRef) => {
    const started = Date.now();
    try {
      return await hydrateScripture(ref);
    } finally {
      bibleMs += Date.now() - started;
    }
  };

  const first = await look(args.ref);
  if (first.status === "verified") {
    return { outcome: "verified", reference: first.reference, text: first.text, verified: true, bibleMs };
  }
  if (first.status === "unavailable") {
    return { outcome: "unverified", reference: first.reference, text: null, verified: false, bibleMs };
  }

  // The passage does not exist. Ask once for another, in the time that is left; if that cannot be done, the reflection
  // goes without a passage. (A blocked request, an unusable reply and a spent time budget all end up here.)
  let pick: ScriptureRef;
  try {
    pick = await generate({
      ...args.gemini,
      system: buildReplacementInstruction(),
      input: {
        kind: "text",
        text: buildReplacementTurn({
          reference: first.reference,
          note: first.note,
          title: args.title,
          emotion: args.emotion,
        }),
      },
      schema: buildScriptureSchema(),
      deadlineAt: args.deadlineAt,
      validate: parseScripturePick,
      maxAttempts: 1,
      maxOutputTokens: REPLACEMENT_MAX_OUTPUT_TOKENS,
    }, args.stats);
  } catch (error) {
    if (error instanceof AppError || error instanceof GeminiBlocked) {
      return { outcome: "dropped", reference: null, text: null, verified: false, bibleMs };
    }
    throw error;
  }

  const second = await look(pick);
  if (second.status === "verified") {
    return { outcome: "replaced", reference: second.reference, text: second.text, verified: true, bibleMs };
  }
  if (second.status === "unavailable") {
    return { outcome: "unverified", reference: second.reference, text: null, verified: false, bibleMs };
  }
  return { outcome: "dropped", reference: null, text: null, verified: false, bibleMs };
}
