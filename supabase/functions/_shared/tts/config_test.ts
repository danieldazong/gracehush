import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { DEFAULT_SPEAKING_RATE, readTtsConfig } from "./config.ts";
import { makeServiceAccount } from "./testing.ts";

const { account, encoded } = await makeServiceAccount();
const VOICE = "en-US-Chirp3-HD-Aoede";

const read = (values: Record<string, string>) => (name: string) => values[name];

Deno.test("nothing set means speech is off: not an error", () => {
  assertEquals(readTtsConfig(read({})), { state: "off" });
  assertEquals(readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: "", TTS_VOICE_NAME: "  ", TTS_SPEAKING_RATE: "" })), {
    state: "off",
  });
  // An optional rate on its own is still "off": there is nothing to speak with.
  assertEquals(readTtsConfig(read({ TTS_SPEAKING_RATE: "0.9" })), { state: "off" });
});

Deno.test("both secrets set and valid: ready, with the language taken from the voice and the default rate", () => {
  const setup = readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: encoded, TTS_VOICE_NAME: VOICE }));
  assertEquals(setup, {
    state: "ready",
    config: { account, voiceName: VOICE, languageCode: "en-US", speakingRate: DEFAULT_SPEAKING_RATE },
  });
  assertEquals(DEFAULT_SPEAKING_RATE, 0.92);
  // Pasted spaces and a line break are trimmed.
  const spaced = readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: ` ${encoded}\n`, TTS_VOICE_NAME: ` ${VOICE} ` }));
  assertEquals(spaced.state, "ready");
});

Deno.test("the speaking rate: 0.25 to 2.0, anything else is a bad TTS_SPEAKING_RATE", () => {
  const rate = (value: string) =>
    readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: encoded, TTS_VOICE_NAME: VOICE, TTS_SPEAKING_RATE: value }));
  for (const good of ["0.25", "0.88", "1", "1.5", "2", "2.0"]) {
    const setup = rate(good);
    assert(setup.state === "ready" && setup.config.speakingRate === Number(good), good);
  }
  for (const bad of ["0.24", "2.01", "0", "-1", "fast", "NaN", "Infinity", "1,5", "0.9x"]) {
    assertEquals(rate(bad), { state: "bad", name: "TTS_SPEAKING_RATE" }, bad);
  }
});

Deno.test("half-set or wrong is bad, and names the secret to look at", () => {
  assertEquals(readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: encoded })), { state: "bad", name: "TTS_VOICE_NAME" });
  assertEquals(readTtsConfig(read({ TTS_VOICE_NAME: VOICE })), { state: "bad", name: "GOOGLE_TTS_CREDENTIALS_B64" });
  assertEquals(readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: "not base64 json", TTS_VOICE_NAME: VOICE })), {
    state: "bad",
    name: "GOOGLE_TTS_CREDENTIALS_B64",
  });
  // The raw JSON file instead of its base64 is the most likely slip.
  assertEquals(readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: atob(encoded), TTS_VOICE_NAME: VOICE })), {
    state: "bad",
    name: "GOOGLE_TTS_CREDENTIALS_B64",
  });
});

Deno.test("only Chirp 3 HD voices: they are what the pause tags are written for", () => {
  const voice = (name: string) => readTtsConfig(read({ GOOGLE_TTS_CREDENTIALS_B64: encoded, TTS_VOICE_NAME: name }));
  for (
    const good of ["en-US-Chirp3-HD-Aoede", "en-GB-Chirp3-HD-Sulafat", "es-US-Chirp3-HD-Leda", "cmn-CN-Chirp3-HD-Kore"]
  ) {
    assertEquals(voice(good).state, "ready", good);
  }
  const english = voice("en-GB-Chirp3-HD-Leda");
  assert(english.state === "ready" && english.config.languageCode === "en-GB");
  const chinese = voice("cmn-CN-Chirp3-HD-Leda");
  assert(chinese.state === "ready" && chinese.config.languageCode === "cmn-CN");
  for (
    const bad of [
      "en-US-Journey-F",
      "en-US-Neural2-C",
      "en-US-Studio-O",
      "en-US-Chirp-HD-F",
      "en-US-Chirp3-HD-",
      "en-US-Chirp3-HD-Ao",
      "Chirp3-HD-Aoede",
      "en-us-Chirp3-HD-Aoede",
      "en-US-Chirp3-HD-Aoede extra",
      "en-US-Chirp3-HD-Aoede\nTTS_SPEAKING_RATE=2",
    ]
  ) assertEquals(voice(bad), { state: "bad", name: "TTS_VOICE_NAME" }, bad);
});
