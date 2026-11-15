import { assert, assertEquals, expectAppError } from "../../process-entry/testing/assert.ts";
import { DEFAULT_VOICE, isVoiceKey, readVoiceAgents, VOICE_KEYS, voiceKeyOf, VOICES } from "./voices.ts";

// Scholar's eight voices (step 39): the list, the default, and the agents secret.

const AGENTS: Record<string, string> = Object.fromEntries(
  VOICE_KEYS.map((key, index) => [key, `agent_test0000${index}`]),
);
const reader = (value: string | undefined) => (name: string) => name === "ELEVENLABS_AGENTS" ? value : undefined;

Deno.test("voices: eight of them, each with its own key and its own ElevenLabs voice, and the default is one of them", () => {
  assertEquals(VOICE_KEYS, ["warm", "bright", "clear", "soft", "storyteller", "deep", "steady", "wise"]);
  assertEquals(new Set(VOICES.map((voice) => voice.elevenLabsVoiceId)).size, 8);
  for (const voice of VOICES) {
    assert(/^[a-z]{3,24}$/.test(voice.key), "a key is a plain word the table can hold (1 to 24 characters)");
    assert(/^[A-Za-z0-9]{20}$/.test(voice.elevenLabsVoiceId), "an ElevenLabs voice id");
  }
  assertEquals(DEFAULT_VOICE, "warm");
  assert(isVoiceKey(DEFAULT_VOICE));
});

Deno.test("voices: a key the server does not know becomes the default, so the phone cannot name a voice outside the eight", () => {
  assertEquals(voiceKeyOf("steady"), "steady");
  for (const value of ["Steady", "sarah", "EXAVITQu4vr4xnSDxMaL", "", " warm", null, undefined, 3, {}, ["warm"]]) {
    assertEquals(voiceKeyOf(value), "warm");
  }
});

Deno.test("voices: the agents secret gives every voice its own agent", () => {
  assertEquals(readVoiceAgents(reader(JSON.stringify(AGENTS))), AGENTS);
  // Keys the server does not know are ignored: only the eight are read.
  assertEquals(readVoiceAgents(reader(JSON.stringify({ ...AGENTS, extra: "agent_other00001" }))), AGENTS);
});

Deno.test("voices: a missing, malformed, incomplete or shared agent is bad_config, never another voice", async () => {
  const without = (key: string) => Object.fromEntries(Object.entries(AGENTS).filter(([name]) => name !== key));
  const broken: (string | undefined)[] = [
    undefined,
    "",
    "not json",
    "[]",
    "null",
    '"agent_test00000"',
    JSON.stringify(without("wise")),
    JSON.stringify({ ...AGENTS, deep: "" }),
    JSON.stringify({ ...AGENTS, deep: 7 }),
    JSON.stringify({ ...AGENTS, deep: "has a space" }),
    JSON.stringify({ ...AGENTS, deep: AGENTS.warm }),
  ];
  for (const value of broken) {
    await expectAppError(
      () => Promise.resolve(readVoiceAgents(reader(value))),
      "INTERNAL",
      "bad_config:ELEVENLABS_AGENTS",
    );
  }
});
