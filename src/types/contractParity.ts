// Compile-time check that the app's copy of the process-entry contract is the Edge Function's copy.
//
// Both files say "keep in sync". This makes it a type error instead: if a request, a response, an error code or a model
// the function uses is changed on one side only, `npm run typecheck` fails here. It holds no runtime code, and nothing
// imports it.
import type * as Server from "../../supabase/functions/process-entry/contracts";
import type * as App from "./index";

// True only when A and B are the same type (not merely assignable one way).
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

export type ContractParity = [
  Expect<Same<App.ProcessEntryRequest, Server.ProcessEntryRequest>>,
  Expect<Same<App.AudioMimeType, Server.AudioMimeType>>,
  Expect<Same<App.ProcessEntryErrorCode, Server.ProcessEntryErrorCode>>,
  Expect<Same<App.StoredErrorCode, Server.StoredErrorCode>>,
  Expect<Same<App.ProcessEntryError, Server.ProcessEntryError>>,
  Expect<Same<App.LimitUsage, Server.LimitUsage>>,
  Expect<Same<App.ProcessEntryLimitError, Server.ProcessEntryLimitError>>,
  Expect<Same<App.ProcessEntryResponse, Server.ProcessEntryResponse>>,
  Expect<Same<App.ConfirmScriptureRequest, Server.ConfirmScriptureRequest>>,
  Expect<Same<App.ConfirmScriptureResponse, Server.ConfirmScriptureResponse>>,
  Expect<Same<App.ConfirmScriptureErrorCode, Server.ConfirmScriptureErrorCode>>,
  Expect<Same<App.ConfirmScriptureError, Server.ConfirmScriptureError>>,
  Expect<Same<App.DeleteEntryRequest, Server.DeleteEntryRequest>>,
  Expect<Same<App.DeleteEntryResponse, Server.DeleteEntryResponse>>,
  Expect<Same<App.DeleteEntryErrorCode, Server.DeleteEntryErrorCode>>,
  Expect<Same<App.DeleteEntryError, Server.DeleteEntryError>>,
  Expect<Same<App.SubscriptionTier, Server.SubscriptionTier>>,
  Expect<Same<App.SyncSubscriptionResponse, Server.SyncSubscriptionResponse>>,
  Expect<Same<App.SyncSubscriptionErrorCode, Server.SyncSubscriptionErrorCode>>,
  Expect<Same<App.SyncSubscriptionError, Server.SyncSubscriptionError>>,
  Expect<Same<App.JournalEntry, Server.JournalEntry>>,
  Expect<Same<App.Affirmation, Server.Affirmation>>,
  Expect<Same<App.Prayer, Server.Prayer>>,
  Expect<Same<App.Scripture, Server.Scripture>>,
  Expect<Same<App.Devotional, Server.Devotional>>,
  Expect<Same<App.EmotionKey, Server.EmotionKey>>,
  Expect<Same<App.PrayerCategory, Server.PrayerCategory>>,
  Expect<Same<App.TimeSlot, Server.TimeSlot>>,
  Expect<Same<App.InputType, Server.InputType>>,
  Expect<Same<App.ProcessingStatus, Server.ProcessingStatus>>,
];
