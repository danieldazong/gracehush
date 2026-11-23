import { getSupabaseUserId } from "@/services/supabaseClient";
import { DEFAULT_SCHOLAR_VOICE, type ScholarVoiceKey } from "@/constants/scholarVoices";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

// Whether the signed-in account has allowed its words and recordings to go to Google's AI (Apple's guideline 5.1.2(i)). The sync
// engine asks before it sends anything from the outbox, and nobody signed in means no.
export function hasAiPermission(): boolean {
  const userId = getSupabaseUserId();
  if (userId === null) return false;
  return useProfilePrefsStore.getState().byUser[userId]?.aiPermissionAt != null;
}

// Whether the signed-in account has allowed ElevenLabs (step 39): its voice in a live talk, and since 2026-11-19 the text of an
// answer it chooses to hear with Listen, read in the chosen voice. A talk needs this and the AI permission above, because Google's
// AI still writes Scholar's answers. Nobody signed in means no.
export function hasVoicePermission(): boolean {
  const userId = getSupabaseUserId();
  if (userId === null) return false;
  return useProfilePrefsStore.getState().byUser[userId]?.voicePermissionAt != null;
}

// The voice the signed-in account chose for Scholar (a live talk, and Listen while ElevenLabs is allowed), or the default.
export function getScholarVoice(): ScholarVoiceKey {
  const userId = getSupabaseUserId();
  if (userId === null) return DEFAULT_SCHOLAR_VOICE;
  return useProfilePrefsStore.getState().byUser[userId]?.scholarVoice ?? DEFAULT_SCHOLAR_VOICE;
}
