import { blankLogLine, writeLog } from "../log.ts";
import type { ElevenLabsConfig } from "./config.ts";
import { VOICE_SWEEP } from "./constants.ts";
import { deleteTalk, listTalks } from "./elevenlabs.ts";

// Deleting finished talks at ElevenLabs (step 39, decision 35). ElevenLabs keeps no recording, but until a talk is deleted it
// holds the words that were said and a summary its own model wrote, and there is no switch for either. So after the response of
// every start and every end of a talk, this lists the talks of our eight agents and deletes each one that has ended. No webhook
// and no schedule: the next talk anyone starts or ends cleans up what the last run left.
//
// It never touches a talk that is still running ("initiated", "in-progress") or still being closed by ElevenLabs ("processing"),
// and never anything of another agent in the workspace: an agent is asked for its own talks, and a row is deleted only when it
// names that agent itself. Measured on 2026-11-13: a talk is "done" within a second of its end, a DELETE answers 204 in 1 to 8
// seconds, and the talk then reads 404; a talk that is already gone counts as deleted.

// A talk that has ended. Every other status is a talk ElevenLabs is still working on.
const ENDED: ReadonlySet<string> = new Set(["done", "failed"]);
// How many deletions run at the same time.
const AT_ONCE = 5;

export type SweepResult = {
  // How many ended talks the agents listed, how many of them this run deleted, and how many deletions failed.
  ended: number;
  deleted: number;
  failed: number;
  // The first failure as one short word (a list or a delete that failed), or null. What failed is tried again at the next run.
  reason: string | null;
};

export async function sweepFinishedTalks(config: ElevenLabsConfig): Promise<SweepResult> {
  return (await sweepRound(config)).result;
}

// One run, and how many talks of our agents ElevenLabs is still working on ("initiated", "in-progress", "processing"), which a
// later run may find ended.
async function sweepRound(config: ElevenLabsConfig): Promise<{ result: SweepResult; working: number }> {
  const agents = [...new Set(Object.values(config.agents))];
  const lists = await Promise.all(
    agents.map(async (agentId) => ({
      agentId,
      listed: await listTalks(config.apiKey, agentId, VOICE_SWEEP.requestTimeoutMs),
    })),
  );
  let reason: string | null = null;
  const ended: string[] = [];
  const working = new Set<string>();
  for (const { agentId, listed } of lists) {
    if (!listed.ok) {
      reason ??= listed.reason;
      continue;
    }
    for (const talk of listed.talks) {
      if (talk.agentId !== agentId) continue;
      if (!ENDED.has(talk.status)) working.add(talk.id);
      else if (!ended.includes(talk.id)) ended.push(talk.id);
    }
  }
  const batch = ended.slice(0, VOICE_SWEEP.maxDeletes);
  let deleted = 0;
  let failed = 0;
  for (let index = 0; index < batch.length; index += AT_ONCE) {
    const results = await Promise.all(
      batch.slice(index, index + AT_ONCE).map((id) => deleteTalk(config.apiKey, id, VOICE_SWEEP.requestTimeoutMs)),
    );
    for (const result of results) {
      if (result.ok) deleted += 1;
      else {
        failed += 1;
        reason ??= result.reason;
      }
    }
  }
  return { result: { ended: ended.length, deleted, failed, reason }, working: working.size };
}

// The sweep, then again at each of `retryAtMs` (from the start) while one of our agents still lists a talk ElevenLabs is
// working on. The runs add up: every talk deleted, every deletion failed, the first failure. `runs` says how many there were.
export async function sweepWithRetries(
  config: ElevenLabsConfig,
  retryAtMs: readonly number[],
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<SweepResult & { runs: number }> {
  const started = Date.now();
  let round = await sweepRound(config);
  const total = { ...round.result, runs: 1 };
  for (const at of retryAtMs) {
    if (round.working === 0) break;
    await wait(Math.max(0, started + at - Date.now()));
    round = await sweepRound(config);
    total.runs += 1;
    total.ended += round.result.ended;
    total.deleted += round.result.deleted;
    total.failed += round.result.failed;
    total.reason ??= round.result.reason;
  }
  return total;
}

type EdgeRuntimeLike = { waitUntil?: (promise: Promise<unknown>) => void };

// Runs the sweep behind a response (scholar-voice-start and scholar-voice-end call it once their own line is written; the end
// passes endSweepTiming.retryAtMs, so the talk that just ended is found once ElevenLabs has closed it). It writes a line of its
// own, with the same request id, only when it deleted something or something failed. It never throws.
export function sweepBehind(
  requestId: string,
  userHash: string | null,
  config: ElevenLabsConfig,
  retryAtMs: readonly number[] = [],
): void {
  const started = Date.now();
  const work = sweepWithRetries(config, retryAtMs).then((result) => {
    const reason = sweepReason(result);
    if (reason === null) return;
    writeLog(blankLogLine({ requestId, status: 200, reason, user: userHash, totalMs: Date.now() - started }));
  }).catch(() => undefined);
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil?.(work);
}

// The sweep's outcome as the one word of a log line: "voice:sweep:3" (three talks deleted), or with what went wrong,
// "voice:sweep:1:failed:delete_http_500". Null when there was nothing to delete and nothing failed, which is not logged.
export function sweepReason(result: SweepResult): string | null {
  if (result.deleted === 0 && result.reason === null) return null;
  return `voice:sweep:${result.deleted}${result.reason === null ? "" : `:failed:${result.reason}`}`;
}
