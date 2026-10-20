# 26-devotional-playback.md

Read AGENTS.md first and follow it strictly.

Make devotional playback real. Replace the mocked internals of the step
12 player store with expo-audio: streaming from short-lived signed URLs,
background playback, lock-screen / Control Center / notification
controls, interruption handling and a shared audio session with the
recorder. The mini player and Now Playing keep their exact look, and the
store keeps its shape and action names. Ambient sound comes in step 27.

AGENTS.md requires approval before dependency and native config changes.
Ask where this prompt says ask.

Docs (source of truth, follow exactly):

- https://docs.expo.dev/versions/latest/sdk/audio/
  (createAudioPlayer, replace, release, playbackStatusUpdate,
  setPlaybackRate + pitch correction, setAudioModeAsync options,
  setActiveForLockScreen / updateLockScreenMetadata /
  clearLockScreenControls, config plugin enableBackgroundPlayback, the
  Android note about lock-screen controls and ~3 minutes)
- https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- https://rntp.dev (for the comparison only)

---

## 0. Player decision (stop and confirm first)

AGENTS.md lists react-native-track-player. Show the user:

- react-native-track-player v5 is a paid product (rntp.dev pricing);
  v4 has New Architecture build issues.
- expo-audio (already installed in step 23) supports background
  playback and lock-screen controls with seek buttons.
  Ask: "Use expo-audio for devotional playback instead of
  react-native-track-player?" Wait for a yes. If no, stop and ask how to
  proceed.

After yes:

- If react-native-track-player is in package.json, ask before
  `npm uninstall react-native-track-player`, then remove its service
  registration (index.js / registerPlaybackService) and plugin entry.
- Delete the old src/services/audioPlayer.ts (track-player version with
  the Unsplash artwork and duration 60) after moving any callers.
  Report every file that imported it.
- AGENTS.md Tech Stack: "expo-audio for recording and playback
  (react-native-track-player removed)."

---

## 1. Before writing code

1. Read src/store/playerStore.ts (// TEMP(26)), src/hooks/usePlayback.ts,
   src/components/MiniPlayerCard.tsx, src/screens/NowPlayingScreen.tsx
   (footer note // TODO(26)), src/screens/ReflectionScreen.tsx and
   useReflection.ts (// TODO(26)), src/hooks/useRecorder.ts and
   src/constants/audio.ts (step 23), src/services/account.ts
   (signOutCleanup), src/constants/images.ts, app.json / app.config.ts,
   and the expo-audio version in package.json.
2. Write down the store's state fields and action names. They must not
   change. Anything new is added, never renamed.
3. In the installed expo-audio types, confirm the exact names of:
   setAudioModeAsync options (playsInSilentMode, shouldPlayInBackground,
   interruptionMode and its values, allowsRecording), the status event
   and its fields (currentTime, duration, playing, didJustFinish,
   isBuffering, error fields), setPlaybackRate and pitch correction,
   and the lock-screen functions and their metadata/options fields.
   Use only names that exist. Report them.
4. Check assets/images/ for player-artwork.png (square, at least
   1024×1024, brand gradient with the logo mark). If it's missing, stop
   and ask the user to provide it. Do not generate or download one.

---

## 2. Native config (ask before changing)

- expo-audio plugin: set "enableBackgroundPlayback": true (step 23 left
  it false). Keep "enableBackgroundRecording": false.
- Remove the step 23 // TODO(26) comment.
- Rebuild (step 05b): `npx expo prebuild --clean`, `npx expo run:android
  --port 8082`. Expo Go cannot run track-player: if the app stops launching
  there, ask me whether to guard it or move testing to the Android build
  (AGENTS.md Instructional Memory). The iPhone cannot check this step until
  the last step: say so.

---

## 3. Audio session: src/services/audioSession.ts

The one place that calls setAudioModeAsync.

type SessionMode = 'playback' | 'recording';
setSessionMode(mode: SessionMode): Promise<void>
getSessionMode(): SessionMode

- playback: playsInSilentMode true, shouldPlayInBackground true,
  interruptionMode 'doNotMix' (stops other apps' music while the
  devotional plays), allowsRecording false.
- recording: allowsRecording true, playsInSilentMode true,
  shouldPlayInBackground false.
- Set 'playback' once at app start (after fonts/Clerk, in App.tsx).
- useRecorder (step 23): replace its direct setAudioModeAsync calls with
  setSessionMode('recording') before recording and
  setSessionMode('playback') after stop and discard. Before recording,
  call the player store's pause(). Nothing else in the recorder
  changes.
- Errors are logged in **DEV** by name only and never thrown to the UI.

---

## 4. Signed URLs: src/services/audioUrls.ts

getDevotionalUrl(path: string, opts?: { forceRefresh?: boolean }):
Promise<{ ok: true; url: string } |
{ ok: false; code: 'NETWORK' | 'UNAUTHORIZED' | 'NOT_FOUND' |
'UNKNOWN' }>

- supabase.storage.from('journal_media').createSignedUrl(path, 3600).
- In-memory cache by path with expiresAt; reuse until 5 minutes before
  expiry. forceRefresh ignores the cache. Clear on sign out.
- The process-entry response URL (step 22) seeds the cache for that
  path with its expiresAt.
- Never persist URLs. Never log URLs or paths.

---

## 5. Player store internals: src/store/playerStore.ts

Remove // TEMP(26) and the mock interval. Keep every field and action.

- One player for the app: createAudioPlayer(null) on first load(),
  module scope (not a hook, because the store owns it). release() on
  sign out (section 8).
- load({ entryId, title, subtitle, durationMs, audioPath }):
  add audioPath to the track input (update ReflectionScreen and
  NowPlayingScreen callers). Same entryId → no-op (step 12 rule).
  Otherwise: pause, getDevotionalUrl, player.replace({ uri }), status
  'paused', position 0. URL failure → status 'idle' plus a new field
  `error: 'offline' | 'unavailable' | null`.
- Status listener (playbackStatusUpdate) is the only source of
  positionMs, durationMs (when the entry had none), status and
  buffering. Add `isBuffering: boolean`. didJustFinish → 'ended'.
- play / pause / toggle / seekTo / skipBy map to the player.
  play() from 'ended' seeks to 0 first. seekTo uses seconds as the API
  expects; the store stays in ms.
- setRate: player.setPlaybackRate(rate) with pitch correction on
  (per the installed API).
- stop(): pause, seekTo(0), clear the lock screen (section 6), keep the
  player for reuse.
- Expired link mid-playback: on a playback error, call
  getDevotionalUrl(path, { forceRefresh: true }), replace the source,
  seek to the last positionMs, and resume if it was playing. Only one
  retry per error; a second failure → status 'paused', error
  'unavailable'.
- Ambient fields stay as they are. // TODO(27): ambient player.

---

## 6. Lock screen: src/services/lockScreen.ts

activateLockScreen(track): void
updateLockScreen(track): void
clearLockScreen(): void

- After a successful load: player.setActiveForLockScreen(true,
  { title: track.title, artist: track.subtitle ("Gracehush • {reference}"),
  albumTitle: 'Gracehush', artwork: the bundled player-artwork },
  { showSeekForward: true, showSeekBackward: true }) using the exact
  field names from section 1.
- Artwork: use the format the docs accept (resolve the bundled image
  with Image.resolveAssetSource or expo-asset if already installed). If
  the API only accepts remote URLs, leave artwork out and report it. No
  remote or stock images.
- Remote commands (play, pause, seek, ±15 s) come back through the
  status listener, so the store and screens update automatically.
  Confirm skip buttons skip 15 s, matching SKIP_MS.
- Crisis entries never load a track, so never reach the lock screen.
- Keep lock-screen text to the title and reference. Never show the
  transcript or emotion.

---

## 7. Interruptions and edge cases

- Headphones or Bluetooth disconnect: playback stops (docs) → status
  'paused'. Never auto-resume.
- Phone call, Siri, an alarm: status 'paused' when the call starts.
  Never auto-resume.
- Starting a recording: pause first (section 3).
- App killed: playback stops. On next launch nothing auto-plays.
- Offline before load: the mini player and Now Playing show the
  existing "audio isn't ready" area with the copy "Audio needs a
  connection." (copy.ts under player). Play is disabled.
- Buffering: the play orb shows a small spinner in place of the icon
  while isBuffering; controls stay enabled.
- Entry without devotionalAudioPath (TTS failed, step 22): the step 12
  "This devotional's audio isn't ready yet." state.
- Now Playing footer "Audio keeps playing when you close this screen."
  now shows for everyone. Remove the step 12 **DEV** guard and
  // TODO(26).

---

## 8. Sign out and delete

signOutCleanup (step 15) now: playerStore.stop(), clearLockScreen(),
player.release(), audioUrls cache clear. Remove the matching
// TODO(26) if present.

---

## 9. Rules

- No new dependencies. No `any`. No layout changes except the copy
  line and buffering spinner.
- Never log URLs, paths, titles or user ids. Allowed: status changes,
  error categories, buffering ms.
- // TODO(27): ambient bed via a second player, mixed on device.
- // TODO(28): opening a devotional from a notification.
- // TODO(34): devotional_played { duration_bucket, rate },
  devotional_completed { }. No ids or titles.
- // V2: download devotionals for offline replay.

---

## 10. AGENTS.md updates

- Audio Rules: expo-audio only; audioSession.ts is the only caller of
  setAudioModeAsync; signed URLs refreshed in audioUrls.ts; lock-screen
  shows title + reference only; no auto-resume after interruptions;
  artwork is the bundled player-artwork.png.
- Remove react-native-track-player everywhere.

---

## 11. Verify (dev build, physical iPhone and Android phone)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Play a real devotional: audio from the speaker, position matches the
   real audio, duration correct.
2. Lock the phone: the lock-screen card shows title, "Gracehush •
   {reference}", artwork; play/pause and ±15 s work and the app matches
   when reopened.
3. Android: background playback continues past 4 minutes (loop a long
   test file in **DEV** if devotionals are shorter), with the media
   notification.
4. Silent switch on (iPhone): audio still plays.
5. Music app playing → start the devotional: the music stops.
6. Unplug headphones and take a call: paused, no auto-resume.
7. Start a recording while playing: playback pauses; after recording,
   play again → speaker, normal volume, background still works.
8. Speeds 0.75×–1.5×: the voice keeps its pitch.
9. Wait for link expiry (set the TTL to 60 s in **DEV** only, then
   restore): playback continues from the same second.
10. Airplane mode on a not-yet-played devotional: "Audio needs a
    connection."
11. Open another reflection: the old track stops and the lock screen
    updates.
12. Sign out while playing: audio stops, lock-screen card disappears.
13. VoiceOver/TalkBack: controls read the same labels as step 12.

Report: player decision; packages removed; API names found; native
config diff; artwork source; files created, changed and deleted; test
results 1–13; and every TODO left for steps 27, 28 and 34.
