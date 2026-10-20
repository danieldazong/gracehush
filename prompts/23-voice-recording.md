# 23-voice-recording.md

Read AGENTS.md first and follow it strictly.

Replace the mocked recorder from step 10 with real voice recording using
expo-audio, keep each recording safely on the device, and add a real
upload of the raw recording to the private journal_media bucket. The New
Entry screen must look and behave exactly as it does now. Submitting
still goes through the mocked journalRepository.submitEntry (step 25
wires it to process-entry); this step adds the upload function and a dev
test for it. Offline queueing comes in step 24, playback in step 26.

AGENTS.md requires approval before installing or removing dependencies
and before native config changes. Ask where this prompt says ask.

Docs (source of truth, follow exactly):

- https://docs.expo.dev/versions/latest/sdk/audio/
  (useAudioRecorder, useAudioRecorderState, RecordingOptions,
  isMeteringEnabled, directory: 'document', setAudioModeAsync,
  getRecordingPermissionsAsync / requestRecordingPermissionsAsync,
  config plugin options)
- https://docs.expo.dev/versions/latest/sdk/filesystem/
- https://supabase.com/docs/reference/javascript/storage-from-upload
  (React Native: upload an ArrayBuffer)

---

## 1. Before writing code

1. Read src/services/recorder.ts (step 07 permission functions + step 10
   mock, marked // TEMP(23)), src/hooks/useRecorder.ts,
   src/screens/NewEntryScreen.tsx, the waveform component from step 10,
   src/constants/app.ts (MAX_RECORDING_MS, the 3-second minimum),
   src/types/index.ts, src/lib/supabase.ts (step 17), app.json /
   app.config.ts and package.json.
2. Write down the exact exported signatures and types of recorder.ts
   and useRecorder.ts. They must not change. If the screen needs
   something new (levels, paused state), add it without renaming or
   removing anything, and list it in the report.
3. Check package.json for expo-audio, expo-av and expo-file-system:
   - expo-audio missing → ask, then `npx expo install expo-audio`.
   - expo-file-system missing → ask, then `npx expo install
expo-file-system`. Note which API the installed version has (the
     new File/Directory/Paths API, or the legacy functions) and use
     only that one.
   - expo-av: grep the repo for imports. If nothing else uses it, ask
     "Remove deprecated expo-av?" and on yes run `npm uninstall
expo-av` and remove its plugin entry. If something uses it, list
     the files and keep it.
4. Confirm the step 07 microphone usage string in the native config.

---

## 2. Native config (ask before changing)

Add or update the expo-audio plugin in app.json / app.config.ts:

["expo-audio", {
"microphonePermission": "<the exact step 07 string>",
"recordAudioAndroid": true,
"enableBackgroundRecording": false,
"enableBackgroundPlayback": false
}]

- enableBackgroundPlayback stays false until step 26 chooses the
  player: // TODO(26): enable when background playback is built. It
  stops an unused Android media-playback foreground service permission,
  which Google Play asks apps to justify.
- Remove any duplicate microphone settings left from expo-av or step 07
  (one source of the iOS string only).
- A new dev build is required (step 05b): `npx expo prebuild --clean`, then
  `npx expo run:android --port 8082`. Expo Go is not used for this check on
  Android. The iPhone stays on Expo Go for now (AGENTS.md Instructional
  Memory): say what it could not check.

---

## 3. Recording settings: src/constants/audio.ts

export const RECORDING_OPTIONS: RecordingOptions = {
extension: '.m4a',
sampleRate: 44100,
numberOfChannels: 1,
bitRate: 64000,
isMeteringEnabled: true,
directory: 'document',
android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
ios: { outputFormat: IOSOutputFormat.MPEG4AAC,
audioQuality: AudioQuality.HIGH },
};
export const RECORDING_MIME_TYPE = 'audio/mp4';
export const METER_INTERVAL_MS = 100;
export const MIN_RECORDING_MS = 3000; // reuse the step 10 constant
// if it exists

- Use the field names the installed expo-audio types show. If
  `directory` isn't supported in the installed version, record to the
  default location and move the file in section 5.
- RECORDING_MIME_TYPE must be one of the bucket's allowed types (step 18) and the process-entry contract (step 19).

---

## 4. Recorder internals: src/services/recorder.ts + useRecorder.ts

Remove // TEMP(23). Keep every export and signature from section 1.

Permissions (step 07 functions, same return type
'granted' | 'denied' | 'undetermined'):

- getMicPermission → getRecordingPermissionsAsync.
- requestMicPermission → requestRecordingPermissionsAsync.
- Errors return 'undetermined', never throw.

Recording (useRecorder.ts):

- useAudioRecorder(RECORDING_OPTIONS) and
  useAudioRecorderState(recorder, METER_INTERVAL_MS).
- Start: check permission (request if undetermined; denied → the
  existing denied state with "Open Settings"), then
  setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }),
  prepareToRecordAsync(), record().
- Elapsed time comes from durationMillis, never from a JS timer.
- Levels: convert metering (dB, about -160 to 0) to 0..1 with
  clamp((db + 60) / 60, 0, 1). Keep the last 11 values for the step 10
  waveform bars. Smooth lightly (new = 0.6 × previous + 0.4 × level).
  Reduce Motion on → bars show the current level without animation.
  No metering value → bars rest at a low fixed height.
- Limits, same behavior as step 10: warning at 4:30, auto-stop at 5:00
  (MAX_RECORDING_MS), and Done is disabled under MIN_RECORDING_MS.
- Stop: stop(), read recorder.uri, then always
  setAudioModeAsync({ allowsRecording: false }) so the next playback on
  iOS uses the speaker, not the earpiece.

Interruptions:

- AppState leaving 'active' while recording → pause() if the installed
  expo-audio supports it, otherwise stop() and keep the file.
- On return, a calm "Paused" state using the existing UI: the timer
  stays, the orb shows Resume, and Done stays available (if ≥ 3s).
  Copy (in copy.ts under newEntry): "Recording paused while you were
  away."
- Phone calls, Siri and other apps taking the mic are handled the same
  way. Use the recorder's status listener if the docs show one for
  interruptions.
- Headphones or Bluetooth disconnecting while recording → pause, same
  state.
- Never record in the background.

Unmount and discard:

- Leaving the screen through the existing "Discard this reflection?"
  dialog → stop(), delete the file, setAudioModeAsync({ allowsRecording:
  false }).
- Unmount without discard (the app was killed, for example) leaves the
  file in place. // TODO(24): clean up orphan recordings older than 7
  days that have no pending entry.

---

## 5. Local file: src/services/recordingFiles.ts

finalizeRecording(uri, clientEntryId):
Promise<{ uri: string; sizeBytes: number }>
deleteRecording(clientEntryId): Promise<void>
recordingUri(clientEntryId): string

- Final location: the document directory, recordings/{clientEntryId}.m4a.
  Create the folder if missing. Move (not copy) the file there.
- Reject an empty file or one under 1 KB → the recorder shows the step
  10 error state ("We couldn't save that recording. Please try
  again.").
- clientEntryId is created once per entry with Crypto.randomUUID()
  (step 10) and reused for retries. Never create a second id for the
  same recording.
- Never log file paths, sizes tied to the user, or recordings.

Recorded result passed to submit (add to src/types/index.ts if
missing):
type RecordedAudio = { clientEntryId: string; uri: string;
durationMs: number; mimeType: 'audio/mp4'; sizeBytes: number };
NewEntryScreen passes this to the mocked submitEntry, which ignores the
file for now. // TODO(25): upload, then call process-entry.

---

## 6. Upload: src/services/mediaUpload.ts

uploadRawRecording(audio: RecordedAudio, userId: string):
Promise<{ ok: true; path: string } |
{ ok: false; code: 'NETWORK' | 'UNAUTHORIZED' |
'TOO_LARGE' | 'NOT_FOUND' | 'UNKNOWN'; message: string }>

- path = `${userId}/raw/${audio.clientEntryId}.m4a` (step 18 layout,
  matches the step 19 validation exactly). userId is the Clerk user id
  from useAuth, passed in by the caller.
- Read the file as an ArrayBuffer with the installed expo-file-system
  API (new API: `await new File(uri).arrayBuffer()`; legacy: read as
  base64, then decode with an existing helper; if none exists, ask
  before adding base64-arraybuffer). Do not use fetch(uri).blob().
- supabase.storage.from('journal_media').upload(path, buffer,
  { contentType: RECORDING_MIME_TYPE, upsert: false }).
- Already exists (409 / "Duplicate" / "already exists") → ok with the
  path. Step 18 blocks overwrites, so a retry must treat this as
  success.
- Over 25 MB → TOO_LARGE without uploading (check sizeBytes first).
- Missing local file → NOT_FOUND.
- Error mapping uses src/lib/supabaseErrors.ts (step 17).
- One retry after 1.5s for NETWORK only.
- Never log the path, user id or file contents.

Dev test (DevToolsPanel, **DEV** only):

- "Upload last recording" uploads the most recent file in recordings/
  and shows on screen: ok / error code. No path, no id.
- "List my raw uploads" calls storage list on `${userId}/raw` and shows
  the count only.

---

## 7. Rules

- Only the dependencies approved in section 1. No `any`.
- No UI, layout or copy changes except the "Paused" line.
- No background recording. No recording without the user tapping the
  orb.
- Crisis red stays only where step 10 uses it.
- Never log transcripts, recordings, file paths or user ids.

---

## 8. Verify (physical devices; simulators handle the mic badly)

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`, then
on an iPhone and an Android phone:

1. First record asks for the microphone once; denying shows the step 10
   "Open Settings" card; allowing in Settings and returning works
   without restarting.
2. Record 20 seconds: the timer follows real time, the waveform reacts
   to your voice and goes flat when you're silent.
3. Under 3 seconds: Done stays disabled.
4. Let it run to 4:30 (warning) and 5:00 (auto-stop).
5. Lock the phone mid-recording, unlock: "Paused", Resume continues,
   and the final file has both parts.
6. Receive a call mid-recording: same paused behavior.
7. Discard: the file is gone from recordings/.
8. Kill the app after recording: the file is still in recordings/.
9. After recording, play any audio (dev sample): on iOS it plays from
   the speaker at normal volume.
10. "Upload last recording" → ok; tap again → ok (no duplicate error);
    the file appears once in the bucket under the user's raw/ folder
    with content type audio/mp4.
11. Play the uploaded file from the Supabase dashboard: clear speech,
    mono, about 0.5 MB per minute.
12. Signed out: the upload returns UNAUTHORIZED without a request.

Report: the recorder signatures kept and anything added; packages
installed or removed; the expo-file-system API used; the native config
diff; file sizes per minute measured; test results 1–12; and every TODO
left for steps 24, 25 and 26.
