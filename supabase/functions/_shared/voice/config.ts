import { optionalEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { readVoiceAgents, type VoiceKey } from "./voices.ts";

// The secrets and the switch of a live talk (step 39). Each is read when a request needs it, and a missing or malformed one is a
// 500 logged as bad_config:<NAME>: never a talk on a half-configured project. Nothing here is ever logged or sent to the phone.

// SCHOLAR_VOICE_ENABLED is read on every request: anything but "true" is off, and then no talk starts and no voice secret is read.
export const voiceEnabled = (): boolean => optionalEnv("SCHOLAR_VOICE_ENABLED") === "true";

function secret(name: string, pattern: RegExp): string {
  const value = optionalEnv(name);
  if (value === undefined || !pattern.test(value)) throw new AppError("INTERNAL", `bad_config:${name}`);
  return value;
}

// Signs and verifies a talk's session (session.ts) and works out a turn's message id (turnId.ts). Only the server holds it.
export const readSessionSecret = (): string => secret("SCHOLAR_VOICE_SESSION_SECRET", /^[\x21-\x7e]{32,256}$/);

// What ElevenLabs sends with every turn, stored at ElevenLabs as the agents' custom LLM key (agent_setup.ts).
export const readLlmSecret = (): string => secret("ELEVENLABS_LLM_SECRET", /^[A-Za-z0-9_-]{32,256}$/);

// The workspace's API key (ElevenAgents write, Voices read, Text to Speech) and each voice's agent.
export type ElevenLabsConfig = { apiKey: string; agents: Record<VoiceKey, string> };

export function readElevenLabsConfig(): ElevenLabsConfig {
  return { apiKey: secret("ELEVENLABS_API_KEY", /^sk_[A-Za-z0-9]{20,}$/), agents: readVoiceAgents() };
}
