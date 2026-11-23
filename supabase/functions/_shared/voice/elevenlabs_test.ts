import { assertEquals } from "../../process-entry/testing/assert.ts";
import { installWorld, VOICE_TEST, type World } from "../../process-entry/testing/fakes.ts";
import { deleteSpeech, speakInVoice } from "./elevenlabs.ts";
import { VOICE_IDS } from "./voices.ts";

// The two calls of Listen in the chosen voice (2026-11-19), on the test world's fake ElevenLabs. The rest of the file (a talk's
// token, the list of talks and their deletion) is tested through the voice functions.

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

const ITEM = "hist9999999999999999";
const ONCE = { deleteMs: 1_000, deleteEveryMs: 20, deleteForMs: 0 };
const deletes = (world: World) => world.elevenCalls.filter((call) => call.url.pathname.startsWith("/v1/history/"));

// A reading ElevenLabs has just made, as speakInVoice names it.
async function reading(): Promise<string> {
  const read = await speakInVoice(VOICE_TEST.apiKey, VOICE_IDS.warm, "Grace and peace to you.");
  const kept = await read.kept;
  if (kept === null || !("historyId" in kept)) throw new Error("the reading named no item");
  return kept.historyId;
}

Deno.test(
  "deleteSpeech: a refusal keeps ElevenLabs' code, the rest are words of ours, and only a 404 is tried again",
  flow(async (world) => {
    world.elevenHistoryDeleteFails = true;
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, ITEM, { ...ONCE, deleteForMs: 300 }), {
      ok: false,
      reason: "history_http_401:missing_permissions",
    });
    world.elevenHistoryDeleteFails = false;
    world.elevenQueue.push({ kind: "network" });
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, ITEM, { ...ONCE, deleteForMs: 300 }), {
      ok: false,
      reason: "history_network",
    });
    world.elevenQueue.push({ kind: "hang" });
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, ITEM, { ...ONCE, deleteMs: 50 }), {
      ok: false,
      reason: "history_timeout",
    });
    // A word that is not a code of ElevenLabs' shape is not kept (it could be a message).
    world.elevenQueue.push({ kind: "json", status: 500, body: { detail: { status: "Something broke here" } } });
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, ITEM, { ...ONCE, deleteForMs: 300 }), {
      ok: false,
      reason: "history_http_500",
    });
    // None of those is tried again: one DELETE each, to the item's own path.
    assertEquals(world.elevenCalls.map((call) => call.method), ["DELETE", "DELETE", "DELETE", "DELETE"]);
    assertEquals(world.elevenCalls[0].url.pathname, `/v1/history/${ITEM}`);
  }),
);

Deno.test(
  "deleteSpeech: a 404 is an item not saved yet, never one gone; it is tried again until it is deleted, or the time is up",
  flow(async (world) => {
    // Saved 150 ms after the reading answered: the first DELETEs answer 404 and a later one deletes it.
    world.elevenHistorySaveMs = 150;
    const late = await reading();
    assertEquals(
      await deleteSpeech(VOICE_TEST.apiKey, late, { deleteMs: 1_000, deleteEveryMs: 20, deleteForMs: 2_000 }),
      {
        ok: true,
      },
    );
    assertEquals(world.elevenHistory.has(late), false);
    const tries = deletes(world).length;
    assertEquals(tries >= 3, true, `${tries} DELETEs: the first ones came before the item was saved`);
    assertEquals(tries <= 20, true, `${tries} DELETEs: one every 20 ms for about 150 ms, not a loop with no pause`);
    assertEquals(
      deletes(world).every((call) => call.method === "DELETE" && call.url.pathname === `/v1/history/${late}`),
      true,
    );

    // An item already deleted answers 200: deleting it again is done, with one DELETE.
    world.elevenCalls.length = 0;
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, late, ONCE), { ok: true });
    assertEquals(deletes(world).length, 1);

    // An item that is still not saved when the time is up stays, and the failure says so (it is not "done").
    world.elevenCalls.length = 0;
    world.elevenHistorySaveMs = 60_000;
    const never = await reading();
    world.elevenCalls.length = 0;
    const started = Date.now();
    assertEquals(
      await deleteSpeech(VOICE_TEST.apiKey, never, { deleteMs: 1_000, deleteEveryMs: 20, deleteForMs: 200 }),
      {
        ok: false,
        reason: "history_http_404:invalid_parameters",
      },
    );
    const spent = Date.now() - started;
    assertEquals(spent >= 150 && spent < 1_500, true, `tried for ${spent} ms`);
    assertEquals(deletes(world).length >= 4, true, `${deletes(world).length} DELETEs`);
    assertEquals(
      deletes(world).length <= 20,
      true,
      `${deletes(world).length} DELETEs in 200 ms: a pause between tries`,
    );
    assertEquals(world.elevenHistory.has(never), true);

    // With no time to try again, a 404 ends it at once.
    world.elevenCalls.length = 0;
    assertEquals(await deleteSpeech(VOICE_TEST.apiKey, never, ONCE), {
      ok: false,
      reason: "history_http_404:invalid_parameters",
    });
    assertEquals(deletes(world).length, 1);
  }),
);

Deno.test(
  "speakInVoice: a reading names the item ElevenLabs keeps, and a reading given up on still names it when it comes",
  flow(async (world) => {
    const read = await speakInVoice(VOICE_TEST.apiKey, VOICE_IDS.warm, "Grace and peace to you.");
    assertEquals(read.ok, true);
    const kept = await read.kept;
    assertEquals(kept !== null && "historyId" in kept && world.elevenHistory.has(kept.historyId), true);

    world.elevenSpeechDelayMs = 200;
    const slow = await speakInVoice(VOICE_TEST.apiKey, VOICE_IDS.warm, "Grace and peace again.", {
      answerMs: 20,
      capMs: 2_000,
    });
    assertEquals([slow.ok, slow.ok ? null : slow.reason], [false, "speech_timeout"]);
    const late = await slow.kept;
    assertEquals(late !== null && "historyId" in late && world.elevenHistory.has(late.historyId), true);

    // Cut off by its own cap: whether ElevenLabs kept it is not known.
    world.elevenSpeechDelayMs = 0;
    world.elevenQueue.push({ kind: "hang" });
    const cut = await speakInVoice(VOICE_TEST.apiKey, VOICE_IDS.warm, "Grace once more.", { answerMs: 20, capMs: 80 });
    assertEquals([cut.ok, cut.ok ? null : cut.reason], [false, "speech_timeout"]);
    assertEquals(await cut.kept, { lost: "unknown" });
  }),
);
