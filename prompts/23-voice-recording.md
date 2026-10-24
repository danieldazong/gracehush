# 23-voice-recording.md

Read AGENTS.md first and follow it strictly.

Replace the mocked recorder of step 10 with real voice recording on `expo-audio`, keep each finished recording safely on the phone, and add the upload of the raw recording to the private `journal_media` bucket. New Entry looks and behaves as it does now, with one addition: a calm **Paused** state for a recording that was interrupted (the app was left, the screen locked, a call or Siri took the microphone). Submitting still goes through the mocked `journalRepository.submitEntry` (step 25 wires it to `process-entry`); this step adds the upload function and a developer check for it. The offline queue is step 24 and playback is step 26.

**The code is written and proven.** The old text of this step was a specification written before steps 17 to 22 were built. The review checked it against the installed packages and the repo and found it wrong in several places (below). So this prompt carries the finished files word for word (sections 1 and 2) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint clean, the Android and iOS bundles build, **68 Node checks** pass on fakes of the microphone, the file system and Storage, and **49 deliberate breakages** of the code were each caught by a named check. What the review could not do, because it has no phone: anything that needs a real microphone, a lock screen or a phone call. That part is yours, and it is written out step by step in "What you do yourself".

AGENTS.md requires approval before installing a dependency. The two installs are named under "Decisions": your go-ahead on this prompt approves them, and you can strike either one.

Sources, read in the review on 2026-10-24 (the installed packages, not the web pages, so they are the versions this app really runs):

- `expo-audio` 58.0.10: `build/utils/options.js`, `src/Audio.types.ts` (the `fileName`, `directory` and metering fields), `ios/AudioRecorder.swift`, `ios/AudioUtils.swift`, `android/.../AudioRecorder.kt` and its `CHANGELOG.md` (the 58.0.6 entry on resuming paused recorders)
- `expo-file-system` 58.0.11 (`build/internal/NativeFileSystem.types.d.ts`, `File.types.d.ts`), `expo-keep-awake` 58.0.3, and `node_modules/expo/bundledNativeModules.json`
- `@supabase/storage-js` 2.118 (`src/lib/common/errors.ts` and `fetch.ts`: how an upload reports a duplicate, a refused token and a dead network)
- the code of steps 07, 10, 17, 18, 19 and 22 (`src/`, `supabase/migrations/`, `supabase/functions/process-entry/constants.ts` and `validate.ts`), `AGENTS.md`, and prompts 24, 25 and 26 (they call what this step builds)

---

## What the review found (these changed the prompt)

1. **Three paths in the old text did not exist.** `src/lib/supabase.ts` is `src/services/supabaseClient.ts` (`getSupabase()` and `getSupabaseUserId()`), `src/lib/supabaseErrors.ts` is `src/utils/supabaseErrors.ts` (`toFailureCode`, `NoSessionError`), and `src/screens/NewEntryScreen.tsx` is `src/screens/journal/NewEntryScreen.tsx`. The old text also wrote `__DEV__` as `**DEV**`.
2. **`expo-audio` already pauses a recording by itself, so the old interruption design was backwards.** The old text said "when the app leaves the foreground, pause if the library supports it". It does: on a background, a lock, a call or Siri the library pauses the recording, and when the app returns or the call ends it **resumes it again by itself**. Since 58.0.6 it resumes only a recorder the *system* paused (changelog, #51048); before that it also restarted a recorder that the user had paused. Expo Go carries its own copy of the native code, which may be older than the 58.0.10 in `node_modules`. Gracehush must never record without a tap, so the design takes the pause over (an explicit `pause()` clears the library's "paused by the system" mark, even on a recorder it already paused), puts the take back to paused when the app returns (`holdPaused`), notices a recorder that someone else paused (two quiet reads) or whose clock stands still (4 s), and continues only on a tap on the orb.
3. **iOS tells the truth about length only while recording.** `durationMillis` is `0` after `stop()`, so it is read first (code that reads the length after stopping gets 0). `isRecording` follows the library's own state, not the microphone: after a refused start or resume it can say "recording" while nothing is captured, which is why the stall check exists.
4. **`directory: 'document'` and `fileName` exist in 58.** The file lands in `<directory>/ExpoAudio/<fileName><extension>` on iOS and `<directory>/Audio/<fileName><extension>` on Android. A fixed `fileName` means a take that was still being recorded when the app was killed (an `.m4a` is only valid once it is stopped) is overwritten by the next take instead of piling up. The old text's "if `directory` isn't supported, move the file" branch is gone.
5. **The recorder is a service, not a hook around `useAudioRecorder`.** That hook creates the native recorder when New Entry opens (even to write), and it cannot own the audio session, the screen-awake lock and the polling. `recorder.ts` creates the native recorder only when a recording starts and releases it when the take ends. It builds the options with `createRecordingOptions` from `expo-audio/build/utils/options` (the helper `useAudioRecorder` itself uses; the package has no `exports` map, Metro resolves it, and both bundles were built). If a later SDK moves that file, the bundle step fails loudly: then build the options inline.
6. **`expo-av` is not installed** (not in `package.json`, not in `node_modules`): there is nothing to remove, and no plugin entry to remove.
7. **`expo-file-system` and `expo-keep-awake` are already in `node_modules`** (dependencies of `expo`, at exactly the versions SDK 58 lists: ~58.0.11 and ~58.0.3) but are not direct dependencies. `npx expo install` makes them direct, downloads nothing new, and keeps Expo Doctor quiet. Only the new `File`, `Directory` and `Paths` API is used: the legacy functions throw at runtime in 58. `File.arrayBuffer()` gives the bytes, so no base64 helper (`base64-arraybuffer`) is needed.
8. **The bucket allows 25 MB but `process-entry` refuses a recording over 12 MiB** (`MAX_AUDIO_BYTES`). The old text capped the phone at 25 MB, so a 20 MB file would have uploaded and then failed at the function. The phone's cap is 12 MiB, and it reads the real size from the file, not the caller's claim.
9. **Storage reports a duplicate as HTTP 400 with `statusCode: "409"`** (newer builds send a real 409, and the error has `code: "ResourceAlreadyExists"`). A dead network and a throwing token callback both arrive as `StorageUnknownError` holding `originalError`. The mapper handles every one of these, and a duplicate is a success: step 18 forbids overwriting, so a retry of an upload that already worked must not fail.
10. **Small corrections.** The waveform has **9** bars (`WAVEFORM_BAR_COUNT`), not 11. The footer button is "Finish Reflection", not "Done". `MIN_RECORDING_MS` already exists in `src/constants/app.ts` and is not declared again in `constants/audio.ts`. The step 07 microphone text is already in `app.json`, and the review compared it with the step 07 string.
11. **No native config change, and no development build.** The `expo-audio` plugin entry already has the microphone text, `recordAudioAndroid: true` and both background flags `false`; `expo-keep-awake` and `expo-file-system` need no plugin. Recording in the foreground works in Expo Go, so the old text's "a new dev build is required: prebuild --clean, run:android, Expo Go is not used" is dropped, and the check runs on your iPhone in Expo Go SDK 58. AGENTS.md's rule ("test on a development build when the change touches audio") is narrowed to background audio and to modules or plugin options that Expo Go lacks.
12. **The finished file is moved to `recordings/{clientEntryId}.m4a` the moment the take ends** (in `useRecorder.stop`), not at submit. That makes "kill the app after recording: the file is still there" true, and puts the file in its final place before anything else can fail. Step 24 section 7.1 calls `finalizeRecording` at submit: a second call with the final address is a harmless no-op (checked).
13. **`RecordedAudio` needs the entry's id**, so the hook is `useRecorder(clientEntryId)`, and New Entry makes its one id *before* the hook (a two-line reorder).
14. **Sign-out must wipe the recordings** (AGENTS.md: wipe the local cache on sign-out; prompt 24 section 10 says "delete every file in recordings/"). `signOutCleanup()` now does it, so a prayer's audio never outlives the session even before step 24 exists.
15. **The screen stays awake while recording** (`expo-keep-awake`). Speaking aloud means no touches: without it the phone locks at its auto-lock time and the recording pauses every half minute or so (on Android a screen-off counts as a background).
16. **A lint false positive**: `new AudioModule.AudioRecorder(...)` fails `import/namespace` (the rule reads the re-exported default as a namespace). The fix is a typed alias (`const nativeAudio: typeof AudioModule = AudioModule`), not a rule disable.

---

## What you do yourself (read this first)

The implementer cannot do this part: it needs your iPhone, your voice, a second phone to call you, and your Supabase dashboard. If you would rather be walked through it one instruction at a time, with a screenshot after each, say "guide me" (that is how steps 17 to 22 went).

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set. Not touched by this step. |
| the four `EXPO_PUBLIC_CLERK_GOOGLE_*` values | not in `.env.local` | not needed here: they belong to native Google sign-in (steps 05b and 35), not to recording. |

Nothing to do in Supabase either. The private `journal_media` bucket already accepts `audio/mp4`, allows 25 MB, and lets a signed-in user add a file only under `{their id}/raw/`, never overwrite and never delete (step 18; its self-test passes 46 of 46 since the WAV migration of 2026-10-24, which only added `audio/wav`). So there is no migration, no policy change, no Edge Function change, no deploy and no secret in this step.

### A. Before the phone tests

1. Say yes to implement. That approves `npx expo install expo-file-system expo-keep-awake` (see Decisions), unless you strike it.
2. When the implementer is done, **restart Metro** with `npx expo start -c` (`package.json` changed and new files add modules and classes), then force-quit and reopen Expo Go.
3. Your iPhone has Expo Go SDK 58 (the App Store version) and you are signed in as yourself. The developer controls are at the very bottom of the Profile tab, under "Developer".

### B. Phone walk-through (iPhone, Expo Go)

Do 1 to 3 and 6 to 9 at least; the others are worth the minutes. After each, tell the implementer what you saw. After each check except 7, 8 and 9 (which need the recording kept), close New Entry with the X and choose Discard, so the next check starts clean: the counts in 6 to 8 depend on it. The captions are drawn in capitals on screen ("TAP TO RESUME"); the words below are how they are written.

1. **First start and the microphone.** Journal tab, tap the mic button on the dock (the New Entry screen opens on Speak), tap the big round button. iOS asks for the microphone once (in Expo Go the question names Expo Go: that is expected, your own wording only appears in a development build). Tap **Don't Allow**: the card "Microphone access is off" appears with "Open Settings" and "Write instead". Tap Open Settings, turn Microphone on for Expo Go, come back: the card goes away by itself. Tap the big button: the recording starts (the button turns red with a stop square and the timer runs).
2. **Twenty seconds.** Talk for 20 seconds. The timer follows real time (compare with the phone's clock), the nine bars move with your voice and fall flat when you stop talking. Tap the red button: the caption says "Recorded 00:20". Then record again for only 2 seconds: "Finish Reflection" stays dimmed until 3 seconds.
3. **Lock and unlock.** Record again (the link "Record again", then Discard, then the big button). After about 10 seconds press the side button to lock the phone, wait 5 seconds, unlock and return to the app. Expected: the big button is plum again, the caption says "Tap to resume", the line "Recording paused while you were away." shows, and the timer has not moved. It must **not** have started recording by itself. Tap the button: it turns red and the timer continues from where it was. Talk 5 more seconds and tap the red button: the length is about the two parts together.
4. **Another app, and a call.** While recording, swipe up to the Home screen, open another app for a few seconds, come back: the same paused state. Optional: have a second phone call yours while you record (or hold the side button to start Siri). When the call ends and you are back in the app it must be paused, not recording; tap the button to continue.
5. **The screen stays on.** While recording, do not touch the phone for longer than your Auto-Lock time (Settings, Display & Brightness, Auto-Lock). The screen must not dim or lock while the red button is on.
6. **Discard.** Record 5 seconds (stopped or still running, either is fine) and tap the X: "Discard this reflection?", choose Discard. Open Profile, scroll to Developer and press "Count my uploads (dev)" (it also refreshes the first line): "recordings on this phone: 0".
7. **Kill the app.** Record 10 seconds and tap the red button to stop. Swipe Expo Go away in the app switcher, reopen it, go to Profile, Developer, press "Count my uploads (dev)": "recordings on this phone: 1". The recording survived.
8. **Upload.** Press "Upload last recording (dev)": "upload: ok". Press it again: "upload: ok" again (an upload that is already there counts as done, never an error). "Count my uploads (dev)": "uploads in your raw folder: 1" (or a bigger number if you uploaded before).
9. **In the dashboard.** supabase.com, your project, Storage, `journal_media`, the folder named like your Clerk user id, then `raw`: one file named like `{a long id}.m4a` per recording (a second press of Upload must not add one). Look at its size (about half a megabyte per minute: a 10-second take is about 80 KB), download it and play it: clear speech, one channel.
10. **Sign out wipes it.** Profile, Sign Out, confirm, sign in again, Developer, "Count my uploads (dev)": "recordings on this phone: 0". (The uploaded copy in the dashboard stays.)
11. **Offline (optional).** Record 10 seconds and stop. Turn on Airplane mode, press "Upload last recording (dev)": after about 2 seconds "upload: NETWORK" (it tried twice, 1.5 seconds apart; if you see UNAUTHORIZED instead, Clerk could not give a token offline: tell the implementer which you saw). Airplane mode off, press again: "upload: ok".
12. **The five-minute limit (optional, five real minutes).** At 4:30 the line "30 seconds left" appears. At 5:00 the recording stops by itself and the line says "Your 5 minutes are up. You can finish your reflection now."

### C. Android (optional, and only with your yes)

The emulator window holds your own signed-in account (the same one as your iPhone), so opening the app there runs it against your real project. The implementer asks first. If you say yes, it runs the recording flow on the emulator (the emulator's microphone is the computer's, so the bars may stay flat; the timer, pause by Home button, Resume, Finish and Discard still show). If you say no, Android is reported "not verified".

### If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| "Tap to resume" appears a few seconds after you start, and you never left the app | the recorder said it was recording but its clock stood still for 4 seconds: something else has the microphone (a call, another app, a Bluetooth headset that has not connected yet). Close the other app and tap the button. |
| `upload: UNAUTHORIZED` | the session was refused. Press "Supabase check (dev)" (the token must say role = authenticated) and sign in again. |
| `upload: NOT_FOUND` | there is no recording file: record, and stop with the red button first. |
| `upload: TOO_LARGE` | the file is over 12 MiB (about 25 minutes at this quality), which the five-minute limit cannot produce: tell the implementer. |
| `upload: NETWORK` while online | the request did not reach Supabase twice in a row: check the connection and `EXPO_PUBLIC_SUPABASE_URL`. |
| `upload: UNKNOWN` | Storage refused for a reason the app does not name: open the project's Storage logs in the dashboard. |
| "We couldn’t start recording. Please try again." | the recorder could not start: another app holds the microphone, or the system refused. Close other apps and try again. |
| "We couldn’t save that recording. Please try again." | the take was empty (under 1 KB): the microphone gave no sound. Check that Microphone is on for Expo Go. |
| "We couldn’t resume recording. You can finish what you have." | the system would not give the microphone back (a call is still going on). Finish keeps what you have, or wait and tap the button again. |
| the bars stay flat while you talk | the level is not reaching the app: check the Microphone switch for Expo Go (Settings, Expo Go). On the Android emulator this is normal. |
| the button stays red after you left the app | should not happen: tell the implementer (a take must pause when the app is left). |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Packages.** `npx expo install expo-file-system expo-keep-awake`: the new file API (move the finished take, read it for the upload) and the screen-awake lock. Both are already inside `node_modules` as dependencies of `expo` at the SDK 58 versions, so nothing new is downloaded; this makes them direct dependencies. No other package, and no removal (`expo-av` is not installed).
2. **No native change.** `app.json` is not touched, there is no prebuild, no `eas.json`, no development build. Foreground recording runs in Expo Go.
3. **One imperative recorder service**, not `useAudioRecorder`: it creates the native recorder when a recording starts and releases it when the take ends (finding 5). It uses `createRecordingOptions` from `expo-audio/build/utils/options`, a deep import of an internal helper; if a later SDK moves it, build the options inline.
4. **Interruptions pause, and only a tap resumes.** Leaving the app (`AppState` background), a call, Siri, or a clock that stands still for 4 seconds puts the take in a new `paused` state: the timer holds, the bars go flat, the screen may sleep, and "Finish Reflection" still works (from 3 seconds). The orb resumes. Never record in the background, never resume without a tap.
5. **The screen stays awake while a take runs** (`expo-keep-awake`, tag `gracehush-recording`). Strike it and the phone locks at its auto-lock time and pauses the take.
6. **The finished file is moved to `recordings/{clientEntryId}.m4a` the moment the take ends**, and a take under 1 KB is a failed recording (the step 10 "We couldn’t save that recording" message).
7. **A fixed in-progress file name** (`recording-in-progress`), so a take that was never stopped (the app was killed) leaves at most one fragment, overwritten by the next take. Sign-out deletes the finished takes; it does not clean that one fragment (its folder differs per platform and is not exposed): a known, bounded limit.
8. **`useRecorder(clientEntryId)`** now takes the entry's id and returns `resume`, a `paused` state, a `resume` error message and `recording` as a `RecordedAudio`. Nothing was removed or renamed. New Entry makes its one id before the hook.
9. **The phone refuses to upload a file over 12 MiB**, the function's own limit, measured on the file.
10. **The upload is `{ ok: true, path }` or `{ ok: false, code }`**, with no message: screens own the copy. Codes: `NETWORK`, `UNAUTHORIZED`, `TOO_LARGE`, `NOT_FOUND`, `UNKNOWN`. One retry after 1.5 seconds for `NETWORK` only. An object that is already there is a success. `uploadRawRecording(audio, userId)` takes anything with a `clientEntryId` and a `uri`, so step 24's queue item fits.
11. **Sign-out and account deletion delete every finished recording** (`deleteAllRecordings()` in `signOutCleanup()`); step 24 will warn about unsent entries first and may keep per-user data instead.
12. **Haptics.** Resuming ticks like a start (`light`); finishing from paused ticks like a stop (`medium`); the automatic pause makes none. This extends the list in AGENTS.md ("exactly these moments"): it is recorded there in section 4.
13. **Other audio keeps playing while you record** (the default interruption mode, `mixWithOthers`). Strike it to stop other apps' music (`interruptionMode: "doNotMix"`), which can leave that music stopped afterwards. Step 26 owns the audio session from here and writes its own modes.
14. **Four new strings** in `copy.newEntry.speak` (`captionPaused`, `resumeLabel`, `paused`, `errors.resume`) and a "Recordings (dev)" group in the developer panel (inline strings, never shown to users).
15. **One thing is flagged and not decided:** the finished takes live in the document folder, which iOS includes in iCloud and computer backups of the phone. Keeping them out of backups needs a file attribute that `expo-file-system` 58 does not expose; revisit it with the offline queue in step 24.

---

## 0. Before you write code

1. Read AGENTS.md (the Audio Rules, "Local Cache & Offline Rules", the vendor notes on `expo-audio`, `expo-file-system` and `storage-js`) and these files: `src/services/recorder.ts` (the step 07 permission functions and the step 10 mock, marked `TEMP(23)`), `src/hooks/useRecorder.ts`, `src/screens/journal/SpeakSection.tsx`, `src/screens/journal/NewEntryScreen.tsx`, `src/components/Waveform.tsx`, `src/constants/app.ts` (`MAX_RECORDING_MS`, `MIN_RECORDING_MS`, `RECORDING_WARNING_MS`, `WAVEFORM_BAR_COUNT`), `src/types/index.ts`, `src/services/supabaseClient.ts`, `src/utils/supabaseErrors.ts`, `src/services/account.ts`, `app.json` and `package.json`.
2. Baseline, red first. `npm run typecheck` and `npm run lint` must pass before any change. Then run `node supabase/tests/recording/run.cjs`: it must **fail** with `cannot resolve @/utils/audioLevels`, because the step 23 files do not exist yet. That is the red.
3. Write down what you keep. `recorder.ts` keeps `getMicPermission`, `requestMicPermission`, `startRecording(onStatus)`, `stopRecording()` (still a `RecordingResult`) and `cancelRecording()`. `useRecorder` keeps `state`, `error`, `durationMs`, `levels`, `recording`, `start`, `stop`, `discard` and the types `RecorderState`, `RecorderError`, `Recorder`. Added, nothing removed or renamed: `pauseRecording`, `resumeRecording`, `holdPaused`; the hook's `resume`, its `paused` state and its `resume` error; and the hook takes the entry id as its one argument.
4. Install (approved under Decision 1): `npx expo install expo-file-system expo-keep-awake`. Afterwards `package.json` must list `expo-file-system` ~58.0.11 and `expo-keep-awake` ~58.0.3, `package-lock.json` must change only by marking those two as direct dependencies (nothing is downloaded: they are already installed), and `npx expo install --check` and `npx expo-doctor` must pass. If `npx expo install` adds a plugin to `app.json` or changes anything else, undo that part.
5. Confirm the microphone text has one source: the `expo-audio` plugin entry in `app.json` (`microphonePermission`, `recordAudioAndroid: true`, both background flags `false`). No change is expected.

---

## 1. The files to create (verbatim)

These six files are the ones the checks in section 3 were written against. Create them exactly as shown, with LF line endings. `recorder.ts` replaces the existing file: its two permission functions at the top are the step 07 ones, unchanged, and the mock below them is gone (delete every `TEMP(23)` marker with it).

### 1.1 `src/constants/audio.ts`

The recording settings and the constants of this step. `RECORDING_MIME_TYPE` must be one of the types the bucket and `process-entry` accept (`audio/mp4` is). `MIN_RECORDING_MS` is not repeated here: it is in `src/constants/app.ts`.

```ts
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

import type { AudioMimeType } from "@/types";

// Speech, not music: AAC in an .m4a file, one channel, 64 kbps. That is about 0.5 MB a minute, so the longest
// recording (MAX_RECORDING_MS, 5:00) is about 2.4 MB, far under the function's limit below. `directory: "document"`
// keeps a take through an operating-system cache purge. `fileName` is one fixed name, so the take that was still
// being recorded when the app was killed (an .m4a is only valid once it is stopped) is overwritten by the next one
// instead of piling up; a finished take is moved to recordings/ by recordingFiles.ts. `isMeteringEnabled` feeds the
// waveform. `web` is required by the type and unused: this app has no web build.
export const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  fileName: "recording-in-progress",
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
  directory: "document",
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: {},
};

// What the file is uploaded as, and what a process-entry request calls it. The bucket and the function both accept
// it (AudioMimeType in src/types, AUDIO_MIME_TYPES in process-entry).
export const RECORDING_MIME_TYPE: AudioMimeType = "audio/mp4";

// How often the recorder is read for the timer and the waveform.
export const METER_INTERVAL_MS = 100;

// The screen stays awake while a recording runs. Speaking aloud means no touches, so without this the phone would
// lock after its auto-lock time and the recording would pause every half minute or so.
export const KEEP_AWAKE_TAG = "gracehush-recording";

// A file under this is a recording that failed (a header and no sound).
export const MIN_RECORDING_FILE_BYTES = 1_024;

// Mirrors MAX_AUDIO_BYTES in supabase/functions/process-entry/constants.ts: the function refuses a larger file, so
// the phone does not upload one. Keep the two in sync.
export const MAX_RECORDING_FILE_BYTES = 12 * 1024 * 1024;
```

### 1.2 `src/utils/audioLevels.ts`

Pure level helpers for the waveform (decibels to a 0 to 1 bar height, and one step of smoothing).

```ts
// Microphone level helpers for the waveform. Pure: no React and no device.

// The recorder reports a level in dBFS: 0 is the loudest the microphone can carry and about -160 is silence. Speech
// sits roughly between -45 and -10, so -60 and below counts as silence and 0 as full scale.
export function meterToLevel(db: number | undefined): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

// One step of light smoothing, so the bars glide instead of jumping.
export function smoothLevel(previous: number, next: number): number {
  return 0.6 * previous + 0.4 * next;
}
```

### 1.3 `src/services/recorder.ts`

The recorder service. Everything about the microphone lives here; the hook below only follows its status. The two permission functions at the top are the step 07 ones, unchanged.

```ts
import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type RecorderState,
} from "expo-audio";
import { createRecordingOptions } from "expo-audio/build/utils/options";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import {
  KEEP_AWAKE_TAG,
  METER_INTERVAL_MS,
  RECORDING_MIME_TYPE,
  RECORDING_OPTIONS,
} from "@/constants/audio";
import type { PermissionResult, RecorderStatus, RecordingResult } from "@/types";
import { meterToLevel, smoothLevel } from "@/utils/audioLevels";

import { toPermissionResult } from "./permissions";

function warn(message: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[recorder] ${message}`, error);
  }
}

export async function getMicPermission(): Promise<PermissionResult> {
  try {
    return toPermissionResult(await getRecordingPermissionsAsync());
  } catch (error) {
    warn("could not read the microphone permission", error);
    return "undetermined";
  }
}

export async function requestMicPermission(): Promise<PermissionResult> {
  try {
    return toPermissionResult(await requestRecordingPermissionsAsync());
  } catch (error) {
    warn("could not request the microphone permission", error);
    return "undetermined";
  }
}

// The recorder (step 23). One recording at a time. The native recorder is made when a recording starts and released
// when it ends, so opening New Entry or writing never touches the microphone, and a recorder that cannot start fails
// only the start.
//
// What expo-audio 58 does by itself (read in its native sources): when the app goes to the background, or a call or
// Siri takes the audio session, it pauses a recording; when the app comes back, or the interruption ends, it resumes
// a recording that IT paused, and since 58.0.6 leaves alone one the app paused. Gracehush never records without a
// tap, so pauseRecording takes the pause over (a pause the app made is never resumed by the library) and only
// resumeRecording, on a tap, starts the microphone again.
//
// Nothing here logs: a native error can carry a file path.

// A recorder that says it is recording while its clock stands still has stopped. iOS keeps saying "recording" when
// the system refused a start or a resume. The wait is long enough for a Bluetooth microphone, which can take a few
// seconds to start delivering sound, not to be taken for a stall.
const STALL_MS = 4_000;
// Not recording for this many reads in a row means someone else paused it (a call, Siri).
const IDLE_READS_BEFORE_PAUSED = 2;

type Session = {
  recorder: AudioRecorder;
  timer: ReturnType<typeof setInterval>;
  level: number; // the smoothed level, 0 to 1
  durationMs: number; // the longest length read so far
  advancedAt: number; // when `durationMs` last grew
  idleReads: number;
};

let session: Session | null = null;

// import/namespace reads AudioModule (a default export that expo-audio re-exports by name) as a namespace and cannot
// see its members, so the construction below goes through a typed alias instead of a rule disable.
const nativeAudio: typeof AudioModule = AudioModule;

function keepAwake(on: boolean) {
  const done = on ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG);
  done.catch(() => undefined);
}

// On iOS the audio session must allow recording while a take runs, and go back afterwards so the next playback
// uses the speaker and not the earpiece (step 26 replaces these calls with its session modes).
async function allowRecording(allowed: boolean) {
  try {
    await setAudioModeAsync(
      allowed ? { allowsRecording: true, playsInSilentMode: true } : { allowsRecording: false },
    );
  } catch {
    // Best effort. A start that really cannot record fails at prepare or record, which the caller sees.
  }
}

function releaseQuietly(recorder: AudioRecorder | null) {
  try {
    recorder?.release();
  } catch {
    // Already released.
  }
}

function deleteQuietly(uri: string | null) {
  try {
    if (!uri) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing more to do for a file that is already gone.
  }
}

async function endSession() {
  const current = session;
  session = null;
  if (!current) return;
  clearInterval(current.timer);
  releaseQuietly(current.recorder);
  keepAwake(false);
  await allowRecording(false);
}

// One read of the native recorder, handed to the hook as the step 10 status shape. `metering` is 0 to 1 and smoothed;
// `isRecording` is false once the recorder has stood idle for two reads or its clock has stalled.
function read(current: Session, onStatus: (status: RecorderStatus) => void) {
  if (session !== current) return;
  let status: RecorderState;
  try {
    status = current.recorder.getStatus();
  } catch {
    return;
  }
  const now = Date.now();
  const durationMs = Math.max(0, status.durationMillis);
  if (durationMs > current.durationMs) {
    current.durationMs = durationMs;
    current.advancedAt = now;
  }
  const stalled = status.isRecording && now - current.advancedAt > STALL_MS;
  const capturing = status.isRecording && !stalled;
  current.idleReads = capturing ? 0 : current.idleReads + 1;
  current.level = smoothLevel(current.level, capturing ? meterToLevel(status.metering) : 0);
  onStatus({
    isRecording: capturing || current.idleReads < IDLE_READS_BEFORE_PAUSED,
    durationMs,
    metering: current.level,
  });
}

export async function startRecording(onStatus: (status: RecorderStatus) => void): Promise<void> {
  await endSession();
  let recorder: AudioRecorder | null = null;
  try {
    await allowRecording(true);
    recorder = new nativeAudio.AudioRecorder(createRecordingOptions(RECORDING_OPTIONS));
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch (error) {
    releaseQuietly(recorder);
    await allowRecording(false);
    throw error;
  }
  keepAwake(true);
  const next: Session = {
    recorder,
    timer: setInterval(() => read(next, onStatus), METER_INTERVAL_MS),
    level: 0,
    durationMs: 0,
    advancedAt: Date.now(),
    idleReads: 0,
  };
  session = next;
}

// Holds a running recording. The library has often paused it already (see above); the call is still made, because it is
// what tells the library the pause is ours, so that it never resumes the microphone by itself.
export function pauseRecording(): void {
  const current = session;
  if (!current) return;
  try {
    current.recorder.pause();
  } catch {
    // Paused by the system already.
  }
  keepAwake(false);
}

// The tap on Resume. Throws when the system will not give the microphone back (a call is still going on).
export async function resumeRecording(): Promise<void> {
  const current = session;
  if (!current) throw new Error("No recording is running");
  await allowRecording(true);
  current.recorder.record();
  current.advancedAt = Date.now();
  current.idleReads = 0;
  keepAwake(true);
}

// Back in the foreground with a recording that is ours to keep paused: if the library resumed it anyway (an older
// expo-audio, or a pause that raced the system's), pause it again.
export function holdPaused(): void {
  const current = session;
  if (!current) return;
  try {
    if (current.recorder.getStatus().isRecording) current.recorder.pause();
  } catch {
    // Nothing to hold.
  }
}

// Finishes the take and hands back the raw file (the hook moves it to its final place). The audio session goes back to
// playback and the recorder is released whatever happens.
export async function stopRecording(): Promise<RecordingResult> {
  const current = session;
  if (!current) throw new Error("No recording is running");
  try {
    // iOS reports a length of 0 once the recorder has stopped, so it is read first.
    const durationMs = Math.max(0, current.recorder.getStatus().durationMillis);
    await current.recorder.stop();
    const uri = current.recorder.uri;
    if (!uri) throw new Error("The recording has no file");
    return { uri, durationMs, mimeType: RECORDING_MIME_TYPE };
  } finally {
    await endSession();
  }
}

// Throws the take away: stops the recorder and deletes its unfinished file.
export async function cancelRecording(): Promise<void> {
  const current = session;
  if (!current) return;
  let uri: string | null = null;
  try {
    uri = current.recorder.uri;
    await current.recorder.stop();
  } catch {
    // A recorder that already stopped can refuse; the file is deleted either way.
  }
  await endSession();
  deleteQuietly(uri);
}
```

### 1.4 `src/services/recordingFiles.ts`

Where a finished take lives: `recordings/{clientEntryId}.m4a` in the app's own document folder. `deleteAllRecordings` is for sign-out; `listRecordings` is for the developer panel now and for step 24's cleanup later.

```ts
import { Directory, File, Paths } from "expo-file-system";

import { MIN_RECORDING_FILE_BYTES } from "@/constants/audio";

// Finished recordings live in the app's private document folder as recordings/{clientEntryId}.m4a, so a take survives
// a restart and the OS cleaning its caches. Only a finished take is ever here: one that was still being recorded when
// the app was killed stays in expo-audio's own folder and cannot be played (an .m4a is only valid once it is stopped).
// Nothing here logs: a path or a size is about a person's prayer.
const FOLDER = "recordings";
const EXTENSION = ".m4a";

function folder(): Directory {
  return new Directory(Paths.document, FOLDER);
}

function fileFor(clientEntryId: string): File {
  return new File(folder(), `${clientEntryId}${EXTENSION}`);
}

export function recordingUri(clientEntryId: string): string {
  return fileFor(clientEntryId).uri;
}

// Moves a take to its final place. useRecorder.stop() calls it once, so a take is already in recordings/ the moment it
// ends; a second call with that final address changes nothing. A file that is missing or under 1 KB is a failed
// recording: it is deleted and this throws, which the recorder shows as the step 10 "We couldn't save that recording"
// message.
export async function finalizeRecording(
  uri: string,
  clientEntryId: string,
): Promise<{ uri: string; sizeBytes: number }> {
  const target = fileFor(clientEntryId);
  const source = new File(uri);
  if (source.uri !== target.uri) {
    if (!source.exists) throw new Error("The recording file is missing");
    folder().create({ intermediates: true, idempotent: true });
    // A second take for the same entry replaces the first (move is asynchronous and only overwrites when told to).
    await source.move(target, { overwrite: true });
  }
  const sizeBytes = target.size;
  if (!target.exists || sizeBytes < MIN_RECORDING_FILE_BYTES) {
    if (target.exists) target.delete();
    throw new Error("The recording file is empty");
  }
  return { uri: target.uri, sizeBytes };
}

// Never throws: a file that cannot be deleted is left for the cleanup of step 24.
export async function deleteRecording(clientEntryId: string): Promise<void> {
  try {
    const file = fileFor(clientEntryId);
    if (file.exists) file.delete();
  } catch {
    // Left for the cleanup.
  }
}

// Sign-out and account deletion: a prayer's audio must not outlive the session. Never throws.
export async function deleteAllRecordings(): Promise<void> {
  try {
    const directory = folder();
    if (directory.exists) directory.delete();
  } catch {
    // Left for the cleanup.
  }
}

export type LocalRecording = {
  clientEntryId: string;
  uri: string;
  sizeBytes: number;
  modifiedAt: number; // milliseconds since the epoch, 0 when unknown
};

// Every finished recording on the phone. The developer panel uses it now.
// TODO(24): delete a recording that has no queue item and is older than 7 days (`modifiedAt` is there for that).
export function listRecordings(): LocalRecording[] {
  const directory = folder();
  if (!directory.exists) return [];
  return directory.list().flatMap((entry) =>
    entry instanceof File && entry.name.endsWith(EXTENSION)
      ? [
          {
            clientEntryId: entry.name.slice(0, -EXTENSION.length),
            uri: entry.uri,
            sizeBytes: entry.size,
            modifiedAt: entry.lastModified ?? 0,
          },
        ]
      : [],
  );
}
```

### 1.5 `src/services/mediaUpload.ts`

The upload to the private `journal_media` bucket, and a count of the user's uploads for the developer panel.

```ts
import { StorageApiError } from "@supabase/supabase-js";
import { File } from "expo-file-system";

import { MAX_RECORDING_FILE_BYTES, RECORDING_MIME_TYPE } from "@/constants/audio";
import { getSupabase } from "@/services/supabaseClient";
import type { RecordedAudio } from "@/types";
import { NO_SESSION_ERROR_NAME, toFailureCode } from "@/utils/supabaseErrors";

// Uploads the raw recording to the private journal_media bucket (step 23). process-entry (step 19) reads it from exactly
// {userId}/raw/{clientEntryId}.m4a, and the bucket's policy lets a user write only into their own raw/ folder, never
// overwrite and never delete (step 18). Nothing here logs: a path, an id or a size is about a person's prayer.
const BUCKET = "journal_media";
const NETWORK_RETRY_MS = 1_500;

export type UploadFailureCode = "NETWORK" | "UNAUTHORIZED" | "TOO_LARGE" | "NOT_FOUND" | "UNKNOWN";

// All an upload needs of a recording. A RecordedAudio fits, and so does a file listed from recordings/.
export type UploadSource = Pick<RecordedAudio, "clientEntryId" | "uri">;

export type UploadResult = { ok: true; path: string } | { ok: false; code: UploadFailureCode };

export function rawRecordingPath(userId: string, clientEntryId: string): string {
  return `${userId}/raw/${clientEntryId}.m4a`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// What Storage says when the object is already there. The service answers HTTP 400 with a body that says 409, and
// newer builds send a real 409, so all three signs count.
function isDuplicate(error: unknown): boolean {
  if (!(error instanceof StorageApiError)) return false;
  return (
    error.status === 409 ||
    error.statusCode === "409" ||
    error.code === "ResourceAlreadyExists" ||
    /already exists|duplicate/i.test(error.message)
  );
}

// Pure: turns what the Storage client reported into a failure code. A rejected request (offline, or a Clerk token that
// could not be fetched) is a StorageUnknownError that holds the original error, so it is read as "no answer".
export function toUploadFailure(error: unknown): UploadFailureCode {
  if (error instanceof StorageApiError) {
    if (error.status === 413 || error.statusCode === "413") return "TOO_LARGE";
    return toFailureCode(error.status, { message: error.message, code: error.code });
  }
  const original =
    typeof error === "object" && error !== null && "originalError" in error ? error.originalError : error;
  const name = original instanceof Error ? original.name : "";
  return toFailureCode(0, { message: name === NO_SESSION_ERROR_NAME ? NO_SESSION_ERROR_NAME : "" });
}

async function send(path: string, body: ArrayBuffer): Promise<UploadResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    // upsert is false on purpose: the policy refuses an overwrite, so a second send of the same entry says
    // "already exists", which is a success below.
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: RECORDING_MIME_TYPE, upsert: false });
    if (error === null || isDuplicate(error)) return { ok: true, path };
    return { ok: false, code: toUploadFailure(error) };
  } catch (error) {
    return { ok: false, code: toUploadFailure(error) };
  }
}

// Never throws. The caller passes the Clerk user id (from useAuth, or getSupabaseUserId in the developer panel).
export async function uploadRawRecording(audio: UploadSource, userId: string): Promise<UploadResult> {
  if (getSupabase() === null) return { ok: false, code: "UNAUTHORIZED" };
  let body: ArrayBuffer;
  try {
    const file = new File(audio.uri);
    if (!file.exists) return { ok: false, code: "NOT_FOUND" };
    // The real size, not the caller's claim: the function refuses a file over 12 MiB, so none is sent.
    if (file.size > MAX_RECORDING_FILE_BYTES) return { ok: false, code: "TOO_LARGE" };
    body = await file.arrayBuffer();
  } catch {
    return { ok: false, code: "NOT_FOUND" };
  }
  const path = rawRecordingPath(userId, audio.clientEntryId);
  const first = await send(path, body);
  if (first.ok || first.code !== "NETWORK") return first;
  await wait(NETWORK_RETRY_MS);
  return send(path, body);
}

export type CountResult = { ok: true; count: number } | { ok: false; code: UploadFailureCode };

// For the developer panel: how many raw recordings this user has in the bucket. Returns the count and nothing else.
export async function countRawUploads(userId: string): Promise<CountResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(`${userId}/raw`, { limit: 1_000 });
    if (error !== null) return { ok: false, code: toUploadFailure(error) };
    return { ok: true, count: data.length };
  } catch (error) {
    return { ok: false, code: toUploadFailure(error) };
  }
}
```

### 1.6 `src/hooks/useRecorder.ts`

The hook the Speak view reads. It keeps the step 10 state machine and adds `paused`; it takes the entry's id and moves the finished file at stop.

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { MAX_RECORDING_MS, WAVEFORM_BAR_COUNT } from "@/constants/app";
import {
  cancelRecording,
  getMicPermission,
  holdPaused,
  pauseRecording,
  requestMicPermission,
  resumeRecording,
  startRecording,
  stopRecording,
} from "@/services/recorder";
import { deleteRecording, finalizeRecording } from "@/services/recordingFiles";
import type { RecordedAudio, RecorderStatus } from "@/types";

export type RecorderState = "idle" | "requesting" | "denied" | "recording" | "paused" | "recorded";

// "start" and "save" were the step 10 messages. "resume" is new in step 23: the system would not give the
// microphone back (a call is still going on).
export type RecorderError = "start" | "save" | "resume" | null;

const silence = () => Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// Everything the Speak view needs from the recorder. A tap is the only thing that starts or resumes it. The state
// machine: idle -> (requesting) -> recording -> recorded, with recording <-> paused when the app is left or something
// else takes the microphone, and denied when the microphone is off. `clientEntryId` names the finished file
// (recordings/{clientEntryId}.m4a): the screen makes one per entry and passes it in.
export function useRecorder(clientEntryId: string) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(silence);
  const [recording, setRecording] = useState<RecordedAudio | null>(null);

  // The latest state for the AppState listener and the guards below. Written only in callbacks.
  const stateRef = useRef<RecorderState>("idle");
  // True while a start, a resume or a stop is on its way, so a second tap or the automatic stop cannot overlap.
  const busy = useRef(false);
  const mounted = useRef(false);

  const update = useCallback((next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const resetReading = useCallback(() => {
    setDurationMs(0);
    setLevels(silence());
  }, []);

  // Holds a running recording. It happens by itself when the app goes to the background or another app takes the
  // microphone; the take is kept and only a tap on the orb continues it.
  const hold = useCallback(() => {
    if (stateRef.current !== "recording") return;
    pauseRecording();
    setLevels(silence());
    update("paused");
  }, [update]);

  // Keeps what was recorded: stops the recorder, then moves the file to recordings/{clientEntryId}.m4a. Finish, the
  // automatic stop at the limit and the orb all use it, from recording or from paused.
  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    const from = stateRef.current;
    if ((from !== "recording" && from !== "paused") || busy.current) return null;
    busy.current = true;
    try {
      const raw = await stopRecording();
      const saved = await finalizeRecording(raw.uri, clientEntryId);
      const kept: RecordedAudio = {
        clientEntryId,
        uri: saved.uri,
        sizeBytes: saved.sizeBytes,
        durationMs: Math.min(raw.durationMs, MAX_RECORDING_MS),
        mimeType: raw.mimeType,
      };
      setRecording(kept);
      setDurationMs(kept.durationMs);
      setLevels(silence());
      update("recorded");
      return kept;
    } catch {
      await deleteRecording(clientEntryId);
      resetReading();
      setError("save");
      update("idle");
      return null;
    } finally {
      busy.current = false;
    }
  }, [clientEntryId, resetReading, update]);

  const onStatus = useCallback(
    (status: RecorderStatus) => {
      setDurationMs(Math.min(status.durationMs, MAX_RECORDING_MS));
      setLevels((previous) => [...previous.slice(1), clamp01(status.metering)]);
      if (status.durationMs >= MAX_RECORDING_MS) {
        stop();
      } else if (!status.isRecording && !busy.current) {
        hold();
      }
    },
    [hold, stop],
  );

  const start = useCallback(async () => {
    // A take that exists is replaced only after discard(), never by a stray second start.
    const current = stateRef.current;
    if (busy.current || current === "recording" || current === "paused" || current === "recorded") return;
    busy.current = true;
    setError(null);
    try {
      let permission = await getMicPermission();
      if (permission === "undetermined") {
        update("requesting");
        permission = await requestMicPermission();
      }
      if (!mounted.current) return;
      if (permission !== "granted") {
        update("denied");
        return;
      }
      resetReading();
      setRecording(null);
      await startRecording(onStatus);
      if (!mounted.current) {
        cancelRecording().catch(() => undefined);
        return;
      }
      update("recording");
    } catch {
      setError("start");
      update("idle");
    } finally {
      busy.current = false;
    }
  }, [onStatus, resetReading, update]);

  // The tap on the orb while paused. If the system will not give the microphone back, the take stays paused.
  const resume = useCallback(async () => {
    if (stateRef.current !== "paused" || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await resumeRecording();
      update("recording");
    } catch {
      setError("resume");
    } finally {
      busy.current = false;
    }
  }, [update]);

  // Throws the take away: stops a recorder that is running and deletes the file, wherever it is.
  const discard = useCallback(async () => {
    const current = stateRef.current;
    if (current === "recording" || current === "paused") {
      await cancelRecording().catch(() => undefined);
    } else if (current === "recorded") {
      await deleteRecording(clientEntryId);
    }
    setError(null);
    setRecording(null);
    resetReading();
    update("idle");
  }, [clientEntryId, resetReading, update]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = stateRef.current;
      if (current === "recording" || current === "paused") {
        cancelRecording().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "background") {
        hold();
        return;
      }
      if (status !== "active") return;
      // Back in the foreground: a paused take stays paused until a tap, even if the library resumed it.
      if (stateRef.current === "paused") holdPaused();
      // Back from Settings: the card goes away by itself when the microphone was turned on.
      if (stateRef.current === "denied") {
        getMicPermission().then((permission) => {
          if (permission === "granted" && stateRef.current === "denied" && mounted.current) {
            update("idle");
          }
        });
      }
    });
    return () => subscription.remove();
  }, [hold, update]);

  return { state, error, durationMs, levels, recording, start, resume, stop, discard };
}

export type Recorder = ReturnType<typeof useRecorder>;
```

---

## 2. Edits to the existing files

Each block gives the text to find (it occurs exactly once in its file, as LF text) and the text that replaces it. Five of these files use CRLF line endings: `src/types/index.ts`, `src/constants/copy.ts`, `src/screens/journal/NewEntryScreen.tsx`, `src/services/account.ts` and `src/components/dev/DevToolsPanel.tsx` (count with `tr -cd '\r' < file | wc -c` before editing). `SpeakSection.tsx` is LF. The Edit tool matches single lines in a CRLF file but may fail on a multi-line block, so use a small Node script that matches the LF text and writes CRLF back, as steps 17 to 22 did: each file keeps its own endings and git shows only the real change.

Anything not listed stays as it is: no layout, no token, no class and no other copy string changes. Dev-panel strings stay inline (AGENTS.md: dev-only UI is exempt from `copy.ts`).

### 2.1 `src/types/index.ts`

`RecordedAudio` (what the rest of the app sees of a finished recording) and a truthful comment.

a) Find:

```ts
// New Entry (step 10). Steps 23 and 25 swap the mock recorder and the mock submit without changing these.
```

Replace with:

```ts
// New Entry (step 10). Step 23 swapped the mock recorder for the real one without changing these; step 25 swaps the mock submit.
```

b) Find:

```ts
export type RecordingResult = { uri: string; durationMs: number; mimeType: AudioMimeType };
```

Replace with:

```ts
export type RecordingResult = { uri: string; durationMs: number; mimeType: AudioMimeType };
// A finished recording as the rest of the app sees it (step 23): the file is recordings/{clientEntryId}.m4a on this
// phone and `sizeBytes` was measured on disk. Step 24 queues it and step 25 uploads it.
export type RecordedAudio = {
  clientEntryId: string;
  uri: string;
  durationMs: number;
  mimeType: AudioMimeType;
  sizeBytes: number;
};
```

### 2.2 `src/constants/copy.ts`

Four strings under `newEntry.speak`. (They use the curly apostrophe U+2019, as the rest of the file does.)

a) Find:

```ts
      captionRecording: "Tap to stop",
      recorded: (time: string) => `Recorded ${time}`,
```

Replace with:

```ts
      captionRecording: "Tap to stop",
      captionPaused: "Tap to resume",
      recorded: (time: string) => `Recorded ${time}`,
```

b) Find:

```ts
      stopLabel: (spoken: string) => `Stop recording, ${spoken} recorded`,
      started: "Recording started",
```

Replace with:

```ts
      stopLabel: (spoken: string) => `Stop recording, ${spoken} recorded`,
      resumeLabel: (spoken: string) => `Resume recording, ${spoken} recorded`,
      started: "Recording started",
```

c) Find:

```ts
      warning: "30 seconds left",
```

Replace with:

```ts
      // Said when the app was left, or a call or Siri took the microphone, while recording. The take is kept.
      paused: "Recording paused while you were away.",
      warning: "30 seconds left",
```

d) Find:

```ts
        save: "We couldn’t save that recording. Please try again.",
```

Replace with:

```ts
        save: "We couldn’t save that recording. Please try again.",
        resume: "We couldn’t resume recording. You can finish what you have.",
```

### 2.3 `src/screens/journal/SpeakSection.tsx`

The Paused look: a caption, a spoken label for the orb, a calm line, the orb resumes, and the haptics for a resume and for a finish from paused.

a) Find:

```tsx
  const recorded = state === "recorded";
  const requesting = state === "requesting";
```

Replace with:

```tsx
  const paused = state === "paused";
  const recorded = state === "recorded";
  const requesting = state === "requesting";
```

b) Find:

```tsx
  // A light tap when a recording starts and a firmer one when it stops, whichever way it stops (the orb,
  // Finish or the five-minute limit). Only a real change fires, so coming back to this view does not.
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== "recording" && state === "recording") haptics.light();
    if (previousState.current === "recording" && state === "recorded") haptics.medium();
    previousState.current = state;
  }, [state]);
```

Replace with:

```tsx
  // A light tap when a recording starts (a resume counts) and a firmer one when it stops, whichever way it stops (the
  // orb, Finish, or the five-minute limit, from recording or from paused). Pausing makes none: it happens by itself.
  // Only a real change fires, so coming back to this view does not.
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== "recording" && state === "recording") haptics.light();
    if (
      (previousState.current === "recording" || previousState.current === "paused") &&
      state === "recorded"
    ) {
      haptics.medium();
    }
    previousState.current = state;
  }, [state]);
```

c) Find:

```tsx
    message = { text: speak.errors[error], className: "text-rosewood" };
  } else if (recording && durationMs >= RECORDING_WARNING_MS) {
```

Replace with:

```tsx
    message = { text: speak.errors[error], className: "text-rosewood" };
  } else if (paused) {
    message = { text: speak.paused, className: "text-mauve" };
  } else if (recording && durationMs >= RECORDING_WARNING_MS) {
```

d) Find:

```tsx
    if (recording) {
      recorder.stop();
    } else if (recorded) {
```

Replace with:

```tsx
    if (recording) {
      recorder.stop();
    } else if (paused) {
      recorder.resume();
    } else if (recorded) {
```

e) Find:

```tsx
  const orbLabel = recording ? speak.stopLabel(spoken) : recorded ? speak.recordAgain : speak.start;
```

Replace with:

```tsx
  const orbLabel = recording
    ? speak.stopLabel(spoken)
    : paused
      ? speak.resumeLabel(spoken)
      : recorded
        ? speak.recordAgain
        : speak.start;
```

f) Find:

```tsx
            {recorded
              ? speak.recorded(elapsed)
              : recording
                ? speak.captionRecording
                : speak.captionIdle}
```

Replace with:

```tsx
            {recorded
              ? speak.recorded(elapsed)
              : recording
                ? speak.captionRecording
                : paused
                  ? speak.captionPaused
                  : speak.captionIdle}
```

### 2.4 `src/screens/journal/NewEntryScreen.tsx`

The entry's id is made before the hook; a paused take counts as content, locks the toggle and can be finished; the TODO(25) marker for the real request.

a) Find:

```tsx
  const { width, fontScale } = useWindowDimensions();
  const recorder = useRecorder();
```

Replace with:

```tsx
  const { width, fontScale } = useWindowDimensions();
  // One id for the whole screen: "Try again" resubmits it, and the recording is named after it (recordings/{id}.m4a).
  const [clientEntryId] = useState(() => randomUUID());
  const recorder = useRecorder(clientEntryId);
```

b) Find:

```tsx
  // One id for the whole screen: "Try again" resubmits it, and step 23 names the recording after it.
  const [clientEntryId] = useState(() => randomUUID());
  const inputRef = useRef<TextInputInstance>(null);
```

Replace with:

```tsx
  const inputRef = useRef<TextInputInstance>(null);
```

c) Find:

```tsx
  const hasContent =
    recorder.state === "recording" || recorder.state === "recorded" || text.trim().length > 0;
  const hasAudio = recorder.state === "recording" || recorder.state === "recorded";
  const canSubmit =
    mode === "speak"
      ? hasAudio && recorder.durationMs >= MIN_RECORDING_MS
      : text.trim().length >= MIN_TEXT_LENGTH;
  const modeLocked = recorder.state === "recording" || recorder.state === "requesting";
```

Replace with:

```tsx
  // A take that is recording or paused is already something to keep, and the toggle stays locked until it is stopped.
  const recordingOpen = recorder.state === "recording" || recorder.state === "paused";
  const hasAudio = recordingOpen || recorder.state === "recorded";
  const hasContent = hasAudio || text.trim().length > 0;
  const canSubmit =
    mode === "speak"
      ? hasAudio && recorder.durationMs >= MIN_RECORDING_MS
      : text.trim().length >= MIN_TEXT_LENGTH;
  const modeLocked = recordingOpen || recorder.state === "requesting";
```

d) Find:

```tsx
      // Finish while recording stops first, then sends what was recorded.
      const audio = recorder.state === "recording" ? await recorder.stop() : recorder.recording;
```

Replace with:

```tsx
      // Finish while recording or paused stops first (the file is then in recordings/), then sends what was recorded.
      const audio = recordingOpen ? await recorder.stop() : recorder.recording;
```

e) Find:

```tsx
        inputType: "audio",
        audioPath: audio.uri,
```

Replace with:

```tsx
        inputType: "audio",
        // TODO(25): upload the file (uploadRawRecording), then send its storage path here, not this local address
        audioPath: audio.uri,
```

### 2.5 `src/services/account.ts`

Sign-out and account deletion delete every finished recording.

a) Find:

```ts
import { cancelProfileSync } from "@/services/profileSync";
```

Replace with:

```ts
import { cancelProfileSync } from "@/services/profileSync";
import { deleteAllRecordings } from "@/services/recordingFiles";
```

b) Find:

```ts
  // TODO(24): stop the sync engine and clear this user's SQLite cache
```

Replace with:

```ts
  // A prayer's audio must not outlive the session: every finished recording on this phone goes (step 23). A take that
  // is still being made cannot be running here: Sign Out is on Profile, and New Entry, which owns the recorder, is a
  // screen above the tabs. Step 24 may decide to keep an unsent queue per user instead.
  await deleteAllRecordings();
  // TODO(24): stop the sync engine and clear this user's SQLite cache
```

### 2.6 `src/components/dev/DevToolsPanel.tsx`

The "Recordings (dev)" group: how many recordings are on the phone, upload the newest, count the user's uploads.

a) Find:

```tsx
import { signOutCleanup } from "@/services/account";
import {
  checkSessionToken,
```

Replace with:

```tsx
import { signOutCleanup } from "@/services/account";
import { countRawUploads, uploadRawRecording } from "@/services/mediaUpload";
import { listRecordings } from "@/services/recordingFiles";
import {
  checkSessionToken,
```

b) Find:

```tsx
const PROFILE_SOURCES: ProfileSource[] = ["supabase", "mock"];
```

Replace with:

```tsx
const PROFILE_SOURCES: ProfileSource[] = ["supabase", "mock"];

// The count of finished recordings kept on this phone (recordings/ in the app's own folder).
function recordingsLine(): string {
  return `recordings on this phone: ${listRecordings().length}`;
}
```

c) Find:

```tsx
  const [processChecking, setProcessChecking] = useState(false);
```

Replace with:

```tsx
  const [processChecking, setProcessChecking] = useState(false);
  const [recordingLines, setRecordingLines] = useState<string[]>(() => [recordingsLine()]);
  const [recordingBusy, setRecordingBusy] = useState(false);
```

d) Find:

```tsx
  // The session goes first, and the cleanup before it, as in Profile's own Sign out.
```

Replace with:

```tsx
  // The newest finished recording on this phone goes to the real bucket, under the signed-in user's raw/ folder.
  // The lines say ok or a code and a count, never a path, an id or a size.
  async function uploadLastRecording() {
    setRecordingBusy(true);
    const userId = getSupabaseUserId();
    const latest = listRecordings().sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    let result = "upload: no recording on this phone";
    if (userId === null) {
      result = "upload: not signed in";
    } else if (latest) {
      const uploaded = await uploadRawRecording(latest, userId);
      result = uploaded.ok ? "upload: ok" : `upload: ${uploaded.code}`;
    }
    setRecordingLines([recordingsLine(), result]);
    setRecordingBusy(false);
  }

  async function countUploads() {
    setRecordingBusy(true);
    const userId = getSupabaseUserId();
    const counted = userId === null ? null : await countRawUploads(userId);
    let result = "uploads: not signed in";
    if (counted?.ok) result = `uploads in your raw folder: ${counted.count}`;
    else if (counted) result = `uploads: ${counted.code}`;
    setRecordingLines([recordingsLine(), result]);
    setRecordingBusy(false);
  }

  // The session goes first, and the cleanup before it, as in Profile's own Sign out.
```

e) Find:

```tsx
            {processLines.map((line, index) => (
              <Text key={`${index}-${line}`} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
          </View>
```

Replace with:

```tsx
            {processLines.map((line, index) => (
              <Text key={`${index}-${line}`} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
          </View>
          <View className="items-center gap-2">
            <Text className="text-center text-body-sm text-mauve">Recordings (dev)</Text>
            {recordingLines.map((line) => (
              <Text key={line} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
            <View className="flex-row flex-wrap justify-center gap-2">
              <DevButton
                label="Upload last recording (dev)"
                disabled={recordingBusy}
                onPress={uploadLastRecording}
              />
              <DevButton label="Count my uploads (dev)" disabled={recordingBusy} onPress={countUploads} />
            </View>
          </View>
```

---

## 3. The checks the review created (`supabase/tests/recording/`)

`run.cjs` and `world.cjs` are already in the repo. They run the real `recorder.ts`, `recordingFiles.ts`, `mediaUpload.ts`, `useRecorder.ts` and the two utils in Node (the repo's TypeScript and the loader of the step 17 and 18 sync checks, `supabase/tests/profile-sync/loader.cjs`), on fakes:

- a **virtual clock**, so a five-minute recording, a 4-second stall and a 1.5-second retry take no real time;
- an **in-memory file system** with the `File`, `Directory` and `Paths` shape of `expo-file-system` 58 (async `move` that needs `overwrite`, `size`, `lastModified`, recursive `Directory.delete`, `delete()` that throws on a missing file);
- an **`AudioRecorder`** with the 58.0.x behaviours: a length of `0` after `stop()`, an `isRecording` that can lie, a pause by the system that the library resumes by itself, an app pause that it leaves alone (58.0.6), and an older library that resumes both (`flags.autoResumeAppPaused`);
- a **Storage client** with scripted answers, built on the real `StorageApiError` and `StorageUnknownError` classes of `@supabase/storage-js`;
- a tiny **React** (`useState`, `useRef`, `useCallback`, `useEffect`) and a fake `AppState`.

Run it with `node supabase/tests/recording/run.cjs` (about 5 seconds, no device). It must end with `68 passed, 0 failed`. The 68:

| group | checks | what they prove |
| --- | --- | --- |
| A. pure | 5 | dB to bar height, smoothing, the object path `{user}/raw/{entry}.m4a`, the error mapping |
| B. files | 9 | move to `recordings/`, finalize twice, a second take replaces the first, a missing or under-1-KB take throws and leaves nothing, delete, delete all, list |
| C. service | 18 | options (`fileName`, `directory`, mono, 64 kbps), audio mode on and back, a status every 100 ms, smoothed levels, two quiet reads, the 4-second stall, pause and resume, `holdPaused`, length read before stop, release and cleanup on every path, start failure, permissions, no console output |
| D. upload | 12 | path, `upsert: false`, `audio/mp4`, a duplicate is success (four ways), one retry after 1.5 s for the network only, a refused token or policy is `UNAUTHORIZED` and is not retried, 413 and 500, 12 MiB, missing or unreadable file, signed out sends nothing, counting, no console output |
| E. hook | 24 | idle, record, the first tap asks once, denied and the return from Settings, stop keeps the take in `recordings/`, a header-only take, the five-minute limit, background pauses, the foreground keeps it paused (also with an older library), a call pauses it, resume and Finish from paused, a resume the system refuses, a resume that only looks like it worked, discard from every state, leaving the screen, a double tap, a failed start, the same entry again, no console output |

**The review's mutation run.** The code was broken 49 ways, one at a time, in the copy of the repo, and the run had to go red each time: the length read after `stop`, one quiet read instead of two, no stall guard (and a stall clock that is not restarted at a resume), a pause that never pauses, `holdPaused` that does nothing, no `release`, a failed start that leaves the recorder, cancel that keeps the file, a screen that stays awake after a pause, an audio session that is never put back, a take under 1 KB accepted, no overwrite, `finalize` onto itself, deletes that delete nothing, a list that includes other files, no folder; an upload that may overwrite, a duplicate that fails, a retry on every failure, no size cap, no early signed-out check, no retry wait, a wrong content type, 413 not mapped, a path without the user folder; Finish that fails while paused, a background that does not pause, an interruption not noticed, a screen that keeps a paused recorder, a discard that keeps the file, a start that replaces a finished take, a failed resume that says nothing, the limit one read late, a foreground that does not hold, a failed save that says nothing, a take not moved to `recordings/`, a start that keeps the old message, a denied card that Settings cannot clear, bars not flattened at a pause; and wrong constants (file name, directory, mime type, 1-byte minimum, 12 MiB cap, level scale, smoothing). **49 caught by a named check, none survived, none merely crashed.** (Two first showed up as a hang and as a survivor, and the checks were made stricter until both went red cleanly.)

**What the checks cannot show** is everything that needs a phone: the real microphone and its level, what iOS and Android really do on a lock or a call, Expo Go's own native copy of `expo-audio` (it may be older than 58.0.10), a Bluetooth headset, and how the Paused look feels. Those are your walk-through (B).

---

## 4. AGENTS.md updates

**Already made in the review (do not repeat):** the "Linting and Validation" sentence about development builds is narrowed (foreground recording and playback run in Expo Go); the Audio Rules sentence about interruptions now says to pause, keep the take, continue only on a tap and never record in the background; and three vendor notes were added at the end of "SDK and Vendor Version Notes" (`expo-audio` 58 recorder, `expo-file-system` and `expo-keep-awake`, `@supabase/storage-js` upload errors).

**You make these, once the code is in and the checks pass.** AGENTS.md is CRLF: use the same script as section 2, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them. Text to paste is in the blocks.

**4.1 Tech Stack (Client list).** After the `expo-haptics` bullet add:

```text
- `expo-file-system` and `expo-keep-awake` for recording (step 23): the new `File`, `Directory` and `Paths` API holds the finished recordings and reads the bytes for the upload, and the screen stays awake while a take runs. Installed with `npx expo install`: `expo-file-system` ~58.0.11 and `expo-keep-awake` ~58.0.3 (both were already in `node_modules` as dependencies of `expo`).
```

In "Decision Making & Clarifications", at the end of the "Approved so far" list add:

```text
and in step 23 `expo-file-system` and `expo-keep-awake` (named by the step prompt)
```

**4.2 Architecture tree.** Update the two existing lines and add the new files, each with its exported names: `constants/audio.ts` (`RECORDING_OPTIONS`, `RECORDING_MIME_TYPE`, `METER_INTERVAL_MS`, `KEEP_AWAKE_TAG`, `MIN_RECORDING_FILE_BYTES`, `MAX_RECORDING_FILE_BYTES`); `utils/audioLevels.ts` (`meterToLevel`, `smoothLevel`); `services/recorder.ts` (now real: the two permission functions, `startRecording`, `pauseRecording`, `resumeRecording`, `holdPaused`, `stopRecording`, `cancelRecording`; it replaces "a mock recorder ... `TEMP(23)`"); `services/recordingFiles.ts` (`recordingUri`, `finalizeRecording`, `deleteRecording`, `deleteAllRecordings`, `listRecordings`); `services/mediaUpload.ts` (`rawRecordingPath`, `toUploadFailure`, `uploadRawRecording`, `countRawUploads`); `hooks/useRecorder.ts` (now `useRecorder(clientEntryId)`, with `paused` and `resume`; it replaces "on the mock recorder service"); `types/index.ts` (`RecordedAudio`); `components/dev/DevToolsPanel.tsx` (the "Recordings (dev)" group). Under `supabase/tests/` add the folder `recording/` with this description:

```text
recording/ (68 app-side checks of the recorder, the files, the upload and the hook: node supabase/tests/recording/run.cjs)
```

**4.3 Audio Rules, Recording.** After the interruption bullet add:

```text
- A finished take is moved to `recordings/{clientEntryId}.m4a` in the app's document folder the moment it ends (`useRecorder.stop`, through `finalizeRecording`), and a take under 1 KB is a failed recording. Every finished recording is deleted at sign-out and at account deletion (`signOutCleanup`). The raw file is uploaded with `uploadRawRecording` to `{userId}/raw/{clientEntryId}.m4a` in `journal_media` and never overwritten: an object that is already there counts as success, and the phone sends nothing over 12 MiB (the function's limit). The microphone stays idle until the user taps: opening New Entry or writing never creates a recorder.
```

**4.4 Screen Specifications, 4. New Entry, the Speak bullet.** Add:

```text
While a take is paused (the app was left, the screen locked, a call or Siri took the microphone, or the clock stood still for 4 seconds) the orb is plum with the microphone icon and the spoken label "Resume recording, {time} recorded", the caption says "Tap to resume", the line "Recording paused while you were away." shows, the timer and bars hold, the toggle stays locked, and Finish Reflection works from 3 seconds. A tap on the orb resumes; if the system will not give the microphone back the take stays paused with "We couldn’t resume recording. You can finish what you have." The screen stays awake while a take is recording.
```

**4.5 Haptics.** In the Haptics paragraph, replace the `light` and `medium` sentence with:

```text
`light` when a recording starts or resumes and `medium` when it stops, from recording or from paused, fired from the recorder's state change in `SpeakSection` (so the automatic five-minute stop counts and a denied microphone does not); the automatic pause makes none.
```

**4.6 Authentication Rules, "On sign-out".** In the sentence about `signOutCleanup()`, add to what it does today: `deletes every finished recording on the phone (step 23)`.

**4.7 Linting and Validation.** Add the command `node supabase/tests/recording/run.cjs` (68 checks, about 5 seconds, no device) beside the profile-sync one, with the sentence:

```text
The recorder checks fail with `cannot resolve @/utils/audioLevels` in a tree without the step 23 files: that is the expected red.
```

**4.8 Release gate.** The count that `grep -rnE "TEMP\(|TODO: real" src` prints drops by one (the `TEMP(23)` line in `recorder.ts` is gone). Write the new number, 16 (13 `TEMP(` and 3 `TODO: real`), if that is what it prints.

**4.9 Build Status & Decisions Log: a "Step 23 — Voice recording" entry**, in the form of the steps before it: the decisions (this prompt's list and any you struck), the packages installed, the files added and changed, the differences from this prompt, the measured results (checks, bundles, sizes per minute from the dashboard, the lengths you saw), what the phone walk-through showed (B1 to B12, one line each, in your words and the user's), what was not verified (Android unless run, Bluetooth, a real call if skipped, the iPhone's Expo Go native version), and the open items and markers left (`TODO(24)` in `recordingFiles.ts` and `account.ts`, `TODO(25)` in `NewEntryScreen.tsx`).

---

## 5. Rules

- Only the two approved packages. No `any`. No new tokens, classes or layout: the one visual addition is the Paused look (same orb, same card, a caption, a calm line).
- Crisis red stays only where step 10 uses it: the orb, the dot and the halo **while recording**. A paused take uses the plum orb and the rose dot.
- The microphone is used only after a tap. Never record in the background, and never resume without a tap.
- Never log a transcript, a recording, a file path, a size, an entry id or a user id. The recorder, the file helpers, the upload and the hook write nothing to the console (the checks assert it); the developer panel shows `ok`, a failure code or a count, never a path or an id.
- `mediaUpload.ts` is the only code that uploads a recording, and in this step only the developer panel calls it: the mocked `submitEntry` still ignores the file (step 25 wires the real upload and request).
- `setAudioModeAsync` is called only from `allowRecording()` in `src/services/recorder.ts` (step 26 replaces that one function with its session modes).
- Do not edit a file while a recording is running on a device: Fast Refresh re-runs effects and cancels the take (a development artefact, already in AGENTS.md).
- Keep each file's line endings (five of the files in section 2 are CRLF; the six in section 1 are LF).

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **24 (offline cache and sync).**
  - Section 7.1 ("Speak: `finalizeRecording` with the entry's `clientEntryId`") is already done at stop; a second call with the final address is a no-op, so the call is harmless but not needed. The queue item is a `RecordedAudio`.
  - **Store the entry id and rebuild the address with `recordingUri(clientEntryId)`**, never the absolute `file://` address: the app's document folder path can change after an app update or a restore, and a stored path would then point nowhere.
  - Section 9 (cleanup) can use `listRecordings()` (id, size, `modifiedAt`) and `deleteRecording(id)`; the `TODO(24)` it asks you to remove is in `recordingFiles.ts`.
  - Section 10 (sign-out) item 3 ("delete every file in `recordings/`") is already done by the `deleteAllRecordings()` line step 23 put in `signOutCleanup()`, just before the `TODO(24)` comment. Keep that line, put the engine stop before it and the unsent-count dialog in front, or replace the blanket delete with a per-user one if you decide unsent entries should survive.
  - "Saved locally" (`header.saved`) is now true for a finished voice take and still not for typed text, which is never persisted until the queue exists: its `TODO(24)` marker stays.
  - A take that was never stopped (the app was killed mid-recording) leaves one fragment, `recording-in-progress.m4a`, in expo-audio's folder; the next take overwrites it and the queue cannot recover it. The finished takes live in the document folder, which iOS includes in backups (Decision 15).
- **25 (journal and reflection data).** `uploadRawRecording(item, userId)` fits: pass `{ clientEntryId, uri: recordingUri(clientEntryId) }`; it returns `{ ok: true, path }` or `{ ok: false, code }`. The mapping the prompt lists holds (`NETWORK`, `UNAUTHORIZED`, `NOT_FOUND` to `AUDIO_NOT_FOUND`, `TOO_LARGE` to `PAYLOAD_TOO_LARGE`); `UNKNOWN` (a Storage answer the app does not name, such as a 5xx) is not in prompt 25's mapping: treat it as retryable. **The `process-entry` request needs the storage path `result.path` (`{userId}/raw/{clientEntryId}.m4a`), not `audio.uri`**: the `TODO(25)` in `NewEntryScreen.submit` marks the line. `mimeType` is `audio/mp4` (accepted by the function) and `durationMs` is the measured length (3 to 302 seconds is what the function takes: the UI enforces 3 seconds and the limit stops at 300).
- **26 (devotional playback).** The only `setAudioModeAsync` calls are in `allowRecording()` in `src/services/recorder.ts`, not in the hook as section 3 of prompt 26 says: one private function, called when a take starts or resumes (`true`) and on every path that ends it (`false`), so replacing its body with `setSessionMode("recording" | "playback")` covers start failure, stop, cancel and discard. "Before recording, call the player store's `pause()`" belongs where a recording is started (`start()` in `useRecorder`). While recording the interruption mode is the default (other apps' audio keeps playing: Decision 13). `constants/audio.ts` holds recording constants only: add the playback ones beside them, without renaming.
- **27 to 35.** Nothing changes. No analytics event is added (prompt 34: a recording sends none). A recording that holds crisis words is screened on the server by step 21; the phone's copy is deleted at sign-out.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. `npm run typecheck` and `npm run lint` exit 0. Read the whole output: lint warnings count, and nothing is disabled with a comment.
2. `node supabase/tests/recording/run.cjs` ends `68 passed, 0 failed` (it was red in section 0). Then the two older checks still pass: `node supabase/tests/profile-sync/run.cjs` (88 passed, about 40 seconds) and `node supabase/tests/process-entry/parity.cjs` (7 of 7).
3. `npx expo install --check` says "Dependencies are up to date" and `npx expo-doctor` passes (20 of 20 on SDK 58). `package.json` gained exactly `expo-file-system` and `expo-keep-awake`; `package-lock.json` only marks them as direct; `app.json` is unchanged (`git diff --stat` must not list it).
4. Bundle both platforms, one at a time, to a folder outside the repo: `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform android --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then the same for `ios`. Both exit 0. In the unminified bundles, `createRecordingOptions`, `activateKeepAwakeAsync`, `recording-in-progress` and `Recording paused while you were away` each appear (the deep import resolved), and `expo-av` does not. Do not export while the emulator and two Metro servers are running (host memory, AGENTS.md).
5. Greps, each with the result named: `grep -rn "TEMP(23)\|TODO(23)" src` finds nothing; `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 16 (13 `TEMP(` and 3 `TODO: real`); `grep -rln "setAudioModeAsync" src` lists only `src/services/recorder.ts`; `grep -rln "from \"expo-audio" src` lists only `src/constants/audio.ts` and `src/services/recorder.ts`; `grep -rn "console\." src/services/recorder.ts src/services/recordingFiles.ts src/services/mediaUpload.ts src/hooks/useRecorder.ts` finds only the `__DEV__` `warn()` helper of the permission functions in `recorder.ts`.
6. Line endings: the five CRLF files still have CRLF (`tr -cd '\r' < file | wc -c` is larger than before by the number of added lines) and `git diff --stat` shows only real changes, no whole-file rewrites. The new files are LF.
7. **Mutation smoke test** (the review's 49 are in section 3; prove the checks are wired to *your* files). One at a time, make the break, run `node supabase/tests/recording/run.cjs`, see a named check fail, then restore the line (compare with `git diff`):
   - in `stopRecording`, read `getStatus().durationMillis` after `await current.recorder.stop()`;
   - in `useRecorder.stop`, replace the `finalizeRecording(...)` line with `const saved = { uri: raw.uri, sizeBytes: 4096 };`;
   - in the AppState listener, delete the `if (stateRef.current === "paused") holdPaused();` line;
   - in `uploadRawRecording`, change the retry guard to `if (first.ok) return first;`;
   - in `finalizeRecording`, change `if (source.uri !== target.uri) {` to `if (true) {`;
   - in `constants/audio.ts`, change `RECORDING_MIME_TYPE` to `"audio/m4a"`.
8. With the user's yes only (see "What you do yourself", C): boot the emulator as AGENTS.md says (Metro first, then the emulator; never open it against the real project without asking), and drive the Speak flow: first tap and the microphone prompt, record, the Home button (the take pauses and says so), Resume, Finish, Record again, Discard. Read states with `uiautomator dump --compressed`. Put every display override back and shut the emulator down.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", B1 to B12. The implementer asks for the results one by one and writes them into the log entry. B6, B7 and B8 are the ones that prove the files and the upload; B3 is the one that proves the pause.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; Android on a device; a Bluetooth headset; a real incoming call and Siri; the native version of `expo-audio` inside the user's Expo Go (it may be older than 58.0.10); that the stall check fires on a real refused resume (it is built on fields the library documents and was exercised only on the fake); the real Storage answer for a duplicate (the mapper accepts all three shapes, and B8 is the first time it meets the real bucket); and the look of the Paused state on a real screen.

---

## 8. Report

Say, in this order and briefly: the files created and changed (one line each); the two packages installed (names and versions) and that `package-lock.json` only marked them direct; the checks (typecheck, lint, the 68, the two older ones, doctor, both bundles and what was found in them, the greps with their results, the six hand breakages and which check named each); the phone walk-through results B1 to B12 (and any you did not get); the Android run if the user said yes; what was not verified; the markers left (`TODO(24)` in `recordingFiles.ts` and `account.ts`, `TODO(25)` in `NewEntryScreen.tsx`); the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
