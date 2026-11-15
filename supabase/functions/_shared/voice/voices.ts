import { optionalEnv } from "../env.ts";
import { AppError } from "../errors.ts";

// Scholar's eight voices for a live talk (step 39): four women and four men, chosen by the owner on 2026-11-13 from ElevenLabs'
// ready-made voices. One Scholar, eight voices: no personas and no people's names. A voice is known by its key here and in the app
// (src/constants/scholarVoices.ts, which a Node check keeps equal to this list); the name beside each key in a comment is
// ElevenLabs' own, and it is never shown.
//
// Ready-made voices only: a voice from ElevenLabs' community library can be withdrawn by its owner, and a cloned voice is never
// offered. The server decides the voice: each one is its own ElevenLabs agent, and the phone cannot pass a voice id.
export const VOICES = [
  { key: "warm", elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah, American
  { key: "bright", elevenLabsVoiceId: "hpp4J3VqNfWAUOO0d1Us" }, // Bella, American
  { key: "clear", elevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2" }, // Alice, British
  { key: "soft", elevenLabsVoiceId: "pFZP5JQG7iQjIQuC4Bku" }, // Lily, British
  { key: "storyteller", elevenLabsVoiceId: "JBFqnCBsd6RMkjVDRZzb" }, // George, British
  { key: "deep", elevenLabsVoiceId: "nPczCjzI2devNBz1zQrb" }, // Brian, American
  { key: "steady", elevenLabsVoiceId: "cjVigY5qzO86Huf0OWal" }, // Eric, American
  { key: "wise", elevenLabsVoiceId: "pqHfZKP75CvOlQylNhV4" }, // Bill, American
] as const;

export type VoiceKey = (typeof VOICES)[number]["key"];

export const VOICE_KEYS: readonly VoiceKey[] = VOICES.map((voice) => voice.key);
export const DEFAULT_VOICE: VoiceKey = "warm";

export function isVoiceKey(value: unknown): value is VoiceKey {
  return typeof value === "string" && (VOICE_KEYS as readonly string[]).includes(value);
}

// The voice a talk uses: the one asked for when it is one of the eight, otherwise the default.
export function voiceKeyOf(value: unknown): VoiceKey {
  return isVoiceKey(value) ? value : DEFAULT_VOICE;
}

const AGENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ELEVENLABS_AGENTS: one JSON object, voice key to the id of that voice's agent (agent_setup.ts writes it). Every voice must have
// its own agent: a missing, malformed or shared one is a setup fault, never a silent fallback to another voice.
export function readVoiceAgents(read: (name: string) => string | undefined = optionalEnv): Record<VoiceKey, string> {
  const bad = new AppError("INTERNAL", "bad_config:ELEVENLABS_AGENTS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(read("ELEVENLABS_AGENTS") ?? "");
  } catch {
    throw bad;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw bad;
  const agents = {} as Record<VoiceKey, string>;
  for (const key of VOICE_KEYS) {
    const id = (parsed as Record<string, unknown>)[key];
    if (typeof id !== "string" || !AGENT_ID.test(id)) throw bad;
    agents[key] = id;
  }
  if (new Set(Object.values(agents)).size !== VOICE_KEYS.length) throw bad;
  return agents;
}
