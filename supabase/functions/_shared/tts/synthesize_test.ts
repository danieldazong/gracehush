import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import type { TtsConfig } from "./config.ts";
import { clearTokenCache } from "./googleAuth.ts";
import { synthesize, SYNTHESIZE_URL, ttsTiming } from "./synthesize.ts";
import { googleError, installGoogle, makeServiceAccount, synthOk, tokenOk } from "./testing.ts";

const { account } = await makeServiceAccount();
const config: TtsConfig = { account, voiceName: "en-US-Chirp3-HD-Aoede", languageCode: "en-US", speakingRate: 0.92 };
const MARKUP = "Here is your devotional. [pause] Rest now.";
const WAV = await Deno.readFile(new URL("./fixtures/a-24k-mono-amen.wav", import.meta.url));
const later = () => Date.now() + 120_000;

async function withGoogle(work: (world: ReturnType<typeof installGoogle>) => Promise<void>) {
  const world = installGoogle();
  const saved = { ...ttsTiming };
  ttsTiming.retryPauseMs = 1;
  clearTokenCache();
  try {
    await work(world);
  } finally {
    Object.assign(ttsTiming, saved);
    clearTokenCache();
    world.restore();
  }
}

Deno.test("the request: the endpoint, a bearer token, the markup, the voice, LINEAR16 and the rate, and nothing else", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(tokenOk("ya29.abc"));
    world.synthReplies.push(synthOk(WAV));
    const result = await synthesize(MARKUP, config, later());
    assert(result.ok);
    assertEquals(result.attempts, 1);
    assertEquals(result.audio.length, WAV.length);
    assertEquals(Array.from(result.audio.slice(0, 64)), Array.from(WAV.slice(0, 64)));

    const [call] = world.synthCalls;
    assertEquals([call.method, call.url.href], ["POST", SYNTHESIZE_URL]);
    assertEquals(call.url.search, "", "no key and nothing else in the address");
    assertEquals(call.headers.get("authorization"), "Bearer ya29.abc");
    assertEquals(call.headers.get("x-goog-api-key"), null, "this API does not take an API key");
    assertEquals(call.json, {
      input: { markup: MARKUP },
      voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Aoede" },
      audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.92 },
    });
    assert(!/pitch|effectsProfile|ssml/i.test(call.text), "only the fields the Chirp 3 HD page lists");
  });
});

Deno.test("the sign-in is reused for the next request", async () => {
  await withGoogle(async (world) => {
    world.synthReplies.push(synthOk(WAV), synthOk(WAV));
    assert((await synthesize(MARKUP, config, later())).ok);
    assert((await synthesize(MARKUP, config, later())).ok);
    assertEquals(world.tokenCalls.length, 1);
    assertEquals(world.synthCalls.length, 2);
  });
});

Deno.test("busy or broken: tried once more, and then a transient failure with the reason", async () => {
  const cases: [string, ReturnType<typeof googleError> | { kind: "network" }, string][] = [
    [
      "503",
      googleError(503, { error: { status: "UNAVAILABLE", message: "secret words" } }),
      "tts_http_503:UNAVAILABLE",
    ],
    ["429", googleError(429, { error: { status: "RESOURCE_EXHAUSTED" } }), "tts_http_429:RESOURCE_EXHAUSTED"],
    ["500 with no body", googleError(500, null), "tts_http_500"],
    ["network", { kind: "network" }, "tts_network"],
  ];
  for (const [label, reply, reason] of cases) {
    await withGoogle(async (world) => {
      world.synthReplies.push(reply, reply);
      const result = await synthesize(MARKUP, config, later());
      assert(!result.ok, label);
      assertEquals([result.kind, result.reason, result.attempts], ["TRANSIENT", reason, 2], label);
      assert(!result.reason.includes("secret words"));
    });
  }
  await withGoogle(async (world) => {
    world.synthReplies.push(googleError(503), synthOk(WAV));
    const result = await synthesize(MARKUP, config, later());
    assert(result.ok);
    assertEquals(result.attempts, 2);
  });
});

Deno.test("a request Google refuses is not tried again, and only its short words are kept", async () => {
  await withGoogle(async (world) => {
    world.synthReplies.push(
      googleError(400, { error: { status: "INVALID_ARGUMENT", message: "voice name for project 1234567890" } }),
    );
    const bad = await synthesize(MARKUP, config, later());
    assert(!bad.ok);
    assertEquals([bad.kind, bad.reason, bad.attempts], ["INVALID", "tts_http_400:INVALID_ARGUMENT", 1]);
    assertEquals(world.synthCalls.length, 1);
  });
  await withGoogle(async (world) => {
    // What a project without the API enabled, or without billing, answers: the reason words say which.
    world.synthReplies.push(googleError(403, {
      error: {
        status: "PERMISSION_DENIED",
        message: "Cloud Text-to-Speech API has not been used in project 123456789012 before or it is disabled.",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "SERVICE_DISABLED",
          domain: "googleapis.com",
        }],
      },
    }));
    const off = await synthesize(MARKUP, config, later());
    assert(!off.ok);
    assertEquals([off.kind, off.reason], ["INVALID", "tts_http_403:PERMISSION_DENIED/SERVICE_DISABLED"]);
    assert(!/\d{6,}/.test(off.reason), "no project number in the reason");
  });
});

Deno.test("a token Google no longer accepts: sign in again and ask again at once", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(tokenOk("ya29.old"), tokenOk("ya29.new"));
    world.synthReplies.push(googleError(401, { error: { status: "UNAUTHENTICATED" } }), synthOk(WAV));
    const result = await synthesize(MARKUP, config, later());
    assert(result.ok);
    assertEquals(result.attempts, 2);
    assertEquals(world.synthCalls.map((call) => call.headers.get("authorization")), [
      "Bearer ya29.old",
      "Bearer ya29.new",
    ]);
    assertEquals(world.tokenCalls.length, 2);
  });
  await withGoogle(async (world) => {
    world.synthReplies.push(googleError(401), googleError(401));
    const result = await synthesize(MARKUP, config, later());
    assert(!result.ok);
    assertEquals([result.kind, result.reason, result.attempts], ["AUTH", "tts_http_401", 2]);
  });
});

Deno.test("a refused sign-in is AUTH and asks nothing of Text-to-Speech", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(googleError(400, { error: "invalid_grant" }));
    const result = await synthesize(MARKUP, config, later());
    assert(!result.ok);
    assertEquals([result.kind, result.reason, result.attempts], ["AUTH", "tts_auth:invalid_grant", 1]);
    assertEquals(world.synthCalls.length, 0);
  });
  await withGoogle(async (world) => {
    // A busy token endpoint is tried again, like a busy Text-to-Speech.
    world.tokenReplies.push(googleError(503), tokenOk("ya29.ok"));
    world.synthReplies.push(synthOk(WAV));
    const result = await synthesize(MARKUP, config, later());
    assert(result.ok);
    assertEquals(result.attempts, 2);
  });
});

Deno.test("audio that is empty, too small, not a WAV, or missing is not accepted", async () => {
  const cases: [string, unknown, string, string][] = [
    ["empty", { audioContent: "" }, "INVALID", "tts_empty"],
    ["tiny", { audioContent: btoa("tiny") }, "INVALID", "tts_empty"],
    [
      "an MPEG file",
      { audioContent: btoa("ID3\u0004\u0000\u0000" + "\u0000".repeat(2_000)) },
      "INVALID",
      "tts_not_wav",
    ],
    ["no audio field", { other: 1 }, "TRANSIENT", "tts_shape"],
    ["not JSON at all", "<html>", "TRANSIENT", "tts_shape"],
  ];
  for (const [label, body, kind, reason] of cases) {
    await withGoogle(async (world) => {
      world.synthReplies.push({ kind: "json", status: 200, body }, { kind: "json", status: 200, body });
      const result = await synthesize(MARKUP, config, later());
      assert(!result.ok, label);
      assertEquals([result.kind, result.reason], [kind, reason], label);
    });
  }
});

Deno.test("the deadline: no attempt starts without time, and a hanging call ends by it", async () => {
  await withGoogle(async (world) => {
    const none = await synthesize(MARKUP, config, Date.now() + 1_000);
    assert(!none.ok);
    assertEquals([none.kind, none.reason, none.attempts], ["TRANSIENT", "tts_budget", 0]);
    assertEquals([world.tokenCalls.length, world.synthCalls.length], [0, 0]);
  });
  await withGoogle(async (world) => {
    ttsTiming.minAttemptMs = 10;
    world.synthReplies.push({ kind: "hang" }, { kind: "hang" });
    const started = Date.now();
    const result = await synthesize(MARKUP, config, Date.now() + 150);
    assert(!result.ok);
    assertEquals([result.kind, result.reason], ["TRANSIENT", "tts_timeout"]);
    assert(Date.now() - started < 2_000, "it ended by the deadline, not by the 30 s attempt timeout");
  });
});

Deno.test("an attempt's own timeout ends a call that never answers, and the retry follows", async () => {
  await withGoogle(async (world) => {
    ttsTiming.attemptTimeoutMs = 30;
    world.synthReplies.push({ kind: "hang" }, synthOk(WAV));
    const result = await synthesize(MARKUP, config, later());
    assert(result.ok);
    assertEquals(result.attempts, 2);
  });
});
