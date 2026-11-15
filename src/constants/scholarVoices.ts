// Scholar's eight voices for a live talk (step 39). One Scholar, eight voices: no persona, no photo and no person's name. The keys
// equal the server's (supabase/functions/_shared/voice/voices.ts, which picks each voice's own ElevenLabs agent), and a Node check
// holds them equal. The phone sends only a key: it never knows a voice id. A voice's name and its one line live in
// copy.scholarVoice.voices; its preview (the voice saying the opening line, bundled with the app) is constants/sounds.ts's
// scholarVoicePreviews. Pure: no asset and no React Native, so analytics and the Node checks can read it.

export const SCHOLAR_VOICE_KEYS = ["warm", "bright", "clear", "soft", "storyteller", "deep", "steady", "wise"] as const;
export type ScholarVoiceKey = (typeof SCHOLAR_VOICE_KEYS)[number];

// The default, the server's DEFAULT_VOICE.
export const DEFAULT_SCHOLAR_VOICE: ScholarVoiceKey = "warm";

export function isScholarVoiceKey(value: unknown): value is ScholarVoiceKey {
  return typeof value === "string" && (SCHOLAR_VOICE_KEYS as readonly string[]).includes(value);
}

// A saved or answered key, or the default for anything else.
export function scholarVoiceOf(value: unknown): ScholarVoiceKey {
  return isScholarVoiceKey(value) ? value : DEFAULT_SCHOLAR_VOICE;
}
