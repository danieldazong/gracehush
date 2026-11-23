// Scholar's eight voices for a live talk (step 39). One Scholar, eight voices: since 2026-11-19 (the owner's request) each has a
// Christian name and a painted portrait, and every voice still says it is Scholar, an AI. The keys equal the server's
// (supabase/functions/_shared/voice/voices.ts, which picks each voice's own ElevenLabs agent), and a Node check holds them equal.
// The phone sends only a key: it never knows a voice id, and the server never sees a name. A voice's name and its one line live
// in copy.scholarVoice.voices, its portrait is constants/images.ts's voiceAvatars, and its preview (the voice saying the opening
// line, bundled with the app) is constants/sounds.ts's scholarVoicePreviews. Pure: no asset and no React Native, so analytics and
// the Node checks can read it.

export const SCHOLAR_VOICE_KEYS = ["warm", "bright", "clear", "soft", "storyteller", "deep", "steady", "wise"] as const;
export type ScholarVoiceKey = (typeof SCHOLAR_VOICE_KEYS)[number];

// The order the voice rows show them in (2026-11-20, the owner's request): the boldest man's voice first, then a woman's, then
// a man's, alternating to the end (Gideon, Hannah, Nathan, Phoebe, Caleb, Lydia, Ezra, Selah). Display only: the keys above keep
// the server's order, and the default stays warm.
export const SCHOLAR_VOICE_ORDER: readonly ScholarVoiceKey[] = [
  "deep",
  "warm",
  "storyteller",
  "bright",
  "steady",
  "clear",
  "wise",
  "soft",
];

// The default, the server's DEFAULT_VOICE.
export const DEFAULT_SCHOLAR_VOICE: ScholarVoiceKey = "warm";

export function isScholarVoiceKey(value: unknown): value is ScholarVoiceKey {
  return typeof value === "string" && (SCHOLAR_VOICE_KEYS as readonly string[]).includes(value);
}

// A saved or answered key, or the default for anything else.
export function scholarVoiceOf(value: unknown): ScholarVoiceKey {
  return isScholarVoiceKey(value) ? value : DEFAULT_SCHOLAR_VOICE;
}
