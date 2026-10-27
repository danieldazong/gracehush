# 26-devotional-playback.md

Read AGENTS.md first and follow it strictly.

Make devotional playback real. The mini player on Reflection, Now Playing and a new play button on each Journal card play the spoken devotional that `process-entry` made (step 22): the app fetches the WAV once from the private `journal_media` bucket, keeps it on the phone and plays it with `expo-audio`, in the background and from the lock screen, Control Center and a headset. The player store keeps its shape and its action names. Screens keep their look, except for a small spinner in the play button while the audio is on its way, one calm line when it cannot be had, and the play button on a Journal card. Ambient sound is step 27, notifications step 28, and the development build is step 35.

**The code is written and proven.** The old text of this step was written before steps 12 to 25 were built: it still talks about `react-native-track-player`, a rebuild with `prebuild`, a link cache seeded by the function's answer, and files that live in other folders. The review checked it against the installed packages and the repo and found it wrong or incomplete in several places (below). So this prompt carries the finished files word for word (sections 1 and 2) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint (with the React Compiler rules) clean, **127 Node checks** pass with the app's real TypeScript running against fakes shaped from the sources of expo-audio's iOS and Android players, expo-file-system's download and Storage's signed links, and **127 deliberate breakages** of the code (the same number by coincidence) were each caught by a named check. The older checks still pass at their old numbers (recording 68, offline 44, profile-sync 88, journal-data 86, parity 7 of 7) once the small edits the review already made to three of them are counted (section 3.1), and both platforms bundle. What the review could not do, because it has no phone: anything that needs the real native player, the lock screen, a call or the sound itself. That part is yours, written out step by step in "What you do yourself".

**No new package, no migration, no policy change, no Edge Function change, no deploy, no secret, and one line of native configuration** (`app.json`: `enableBackgroundPlayback` goes from `false` to `true`; Expo Go ignores plugin settings, and its iPhone app already allows background audio). The functions on the hosted project are the ones deployed on 2026-10-24. If the code ever seems to need a column, a grant or a response field that is not there, stop and ask: steps 18 to 22 own those.

Sources, read in the review on 2026-10-26 (the installed packages themselves, not web pages, so they are the versions this app really runs, plus Expo's own pages for what a package cannot show):

- `expo-audio` 58.0.10: the TypeScript, the Swift (iOS) and the Kotlin (Android) sources and its `CHANGELOG.md` (`createAudioPlayer`, the status reports, `setAudioModeAsync`, the lock-screen calls, how interruptions, the end of a file and a pause during buffering are handled)
- `expo-file-system` 58.0.11 (`File.downloadFileAsync`, `Directory`, `Paths`), `expo-asset` (`Asset.fromModule`), `@supabase/storage-js` 2.118.0 (`createSignedUrl` and its errors)
- docs.expo.dev/versions/latest/sdk/audio (background playback, lock-screen controls, `keepAudioSessionActive`), and the `Info.plist` of Expo Go in the `expo/expo` repository (it declares the `audio` background mode)
- the code of steps 05 to 25 (`src/`), `supabase/functions/process-entry/` (the speech stage and the path it stores), `AGENTS.md`, and prompts 27, 28, 31, 34 and 35 (they call what this step builds)

---

## What the review found (these changed the prompt)

1. **The player decision is made, and nothing needs a build.** The old text said to stop and ask whether to use `expo-audio` instead of `react-native-track-player`, to uninstall the latter, to delete `src/services/audioPlayer.ts` and to rebuild with `prebuild` and `expo run:android`. AGENTS.md now says `expo-audio` only (the review edited the Tech Stack and the Audio Rules), `react-native-track-player` was never installed (it is in no `package.json`, `app.json` or `src/` file), there is no `audioPlayer.ts`, and `expo-audio` is included in Expo Go. So the step is checked on the iPhone in Expo Go, the one phone there is. The Android emulator is used only with your yes.
2. **Wrong paths.** `src/screens/NowPlayingScreen.tsx` is `src/screens/journal/NowPlayingScreen.tsx` and `ReflectionScreen.tsx` is `src/screens/journal/ReflectionScreen.tsx`. The audio mode is not set in `useRecorder`: `src/services/recorder.ts` is the only caller of `setAudioModeAsync`. `useReflection.ts` and `ReflectionScreen.tsx`, which the old text names for a marker, have none. "Set `playback` once at app start in `App.tsx`" is not needed: the store sets the mode when a devotional is opened, and the recorder sets its own and puts it back.
3. **A partial audio mode resets the rest, on iOS.** `setAudioModeAsync` builds the whole mode from the native record, whose defaults are `playsInSilentMode false`, `interruptionMode mixWithOthers` and `shouldPlayInBackground false`. So the old text's plan (set `playback` once at app start, and step 23's `setAudioModeAsync({ allowsRecording: false })` after a take) would have switched the silent-switch and background settings off after the first recording. Every call now carries all six fields, from one file (`audioSession.ts`, the only caller), in two modes: `playback` and `recording`.
4. **Streaming from signed links was replaced by a one-time download.** The old text mints a one-hour link, streams it, refreshes it when it expires in the middle of playback and seeds its link cache from the function's answer. The function's answer carries no link (step 22 decided: a path and a length, nothing else), so there is nothing to seed; a devotional is a WAV of about 5.5 MB, so streaming it again at every play multiplies the egress that the free plan limits to 5 GB a month, and cannot play offline; and a link that expires mid-playback is a failure the app never has if the player only opens a file on the phone. So `getDevotionalFile` makes a 300-second link, downloads the file once into the cache folder (through a `.part` file that is moved into place), keeps the newest 12, and the player opens the local file. There is no link refresh logic at all.
5. **The track needs the path.** `PlaybackTrack` has no `audioPath`, so `getPlaybackTrack` carries it. The store's `load(track, ambient)` keeps its two arguments (the old text's `load({ ..., audioPath })` would have changed every caller).
6. **What "not playing" means differs by platform, and the old text could not know.** iOS reports `timeControlStatus: "waitingToPlayAtSpecifiedRate"` while a play that was asked for waits for data, and `isBuffering` is also true for a paused player whose buffer is empty. Android reports `playbackState: "buffering"` and keeps the person's last wish in `playing`, and after a pause during buffering that wish is stale until the buffering ends. After the end ExoPlayer keeps `playWhenReady`, so a seek would start it again unless it was paused first. The store reads "waiting" as `timeControlStatus === "waitingToPlayAtSpecifiedRate" || playbackState === "buffering"`, counts it only while the person wants sound (the app's own pause clears that at once), never uses `isBuffering`, and pauses a finished player before it rewinds it.
7. **The lock-screen card goes with a deactivated session.** On iOS `pause()` and the end deactivate the audio session 100 ms later unless the player was made with `keepAudioSessionActive: true`, and a deactivated session is expected to drop the lock-screen card, so the lock screen could not resume a paused devotional. The player is made with it (one constant, `KEEP_SESSION_ACTIVE`). The price: another app's music, which the devotional stopped, does not start again by itself. The walk-through (B5) is where this is seen on a phone.
8. **Remote commands do not call JavaScript.** The lock screen, a headset and a car call the native player directly, so the app learns of them from the next report, and from a read of `player.currentStatus` when it comes back to the front (the store listens to `AppState`). A report sent before the listener is attached is not repeated, so the store also reads `player.isLoaded` right after attaching.
9. **"Never auto-resume" cannot be promised.** The old text says a call, Siri, an alarm or unplugged headphones pause and never resume. expo-audio on iOS resumes the players it paused when the system ends an interruption with `shouldResume`, and on Android audio focus gaining back resumes; unplugged headphones pause and do not resume. The library has no switch for this, and the store only shows what the player reports (a pause from outside is a pause, a start from outside is a play). The behaviour is the platform's own, and check B8 shows what it does on your phone; if you want "never", say so and ask for the extra rule (it would have to pause the player again after each system resume).
10. **The recorder shares the session.** Starting a take pauses a devotional that is playing, sets the `recording` mode, and every way a take ends (stop, cancel, a failed start) puts the `playback` mode back, so the next devotional uses the loudspeaker and plays with the silent switch on. `resumeRecording` sets the recording mode again.
11. **Speeds.** The old Verify says 0.75× to 1.5×. The app has three chips, 0.8x, 1x and 1.2x (`PLAYBACK_RATES`, step 12), and the voice keeps its pitch (`setPlaybackRate(rate, "high")`).
12. **Artwork exists now.** The old text said to stop and ask for `assets/images/player-artwork.png` if it is missing, and not to generate one. The review made it, without any image generator: Chrome rendered the brand gradient (`gradients.brand`, plum to rose, corner to corner) with the logo mark in its frosted tile, the same picture as the Now Playing card, 1024 by 1024, opaque, no text; the tile is larger than in the app so the mark still reads at the size of a lock-screen thumbnail. iOS takes artwork as a URL string, so `lockScreen.ts` turns the bundled picture into a local file once (`Asset.fromModule(...).downloadAsync()`, `expo-asset` is already a direct dependency) and passes its `file://` address.
13. **Sign-out.** The old text lists `playerStore.stop()`, `clearLockScreen()`, `player.release()` and a link-cache clear. `stop()` already releases the player and clears the lock screen. `signOutCleanup` calls it first and then `deleteAllDevotionalAudio()`, which also aborts a download still running (so a download that ends after the sign-out cannot leave a file behind), because the files belong to the account that signed out.
14. **Mock data has no audio.** A sample entry of step 06 carries a made-up path that is not in Storage. With the `mock` data source the play button ends in the calm line "We couldn’t load the audio. Tap play to try again.". A real entry whose speech was off or failed has no `audioPath`, so `getPlaybackTrack` still returns null and the existing "audio isn’t ready yet" state shows (step 12), unchanged.
15. **The old TODOs.** Five lines are closed (section 0): the two `TEMP(26)` in `playerStore.ts` (the mock, and its pause when the app leaves the foreground: real audio is meant to keep playing there), `TODO(26)` in `JournalCard.tsx` (play in place), in `NowPlayingScreen.tsx` (the footer line, shown to everyone now) and in `account.ts` (clear the lock screen and release the player). The `TODO(27)`, `TODO(28)` and `TODO(34)` ideas of the old text stay with their steps (section 6).
16. **Three older checks needed small edits, and they are already made** (section 3.1): the recorder checks expect the two session modes and the pause of a playing devotional, and the two sign-out checks expect the devotional files to go after the player stops.

---

## What you do yourself (read this first)

The implementer cannot do this part: it needs your iPhone. If you would rather be walked through it one instruction at a time, with a screenshot after each, say "guide me" (that is how steps 17 to 25 went).

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set, and already on the hosted project. Not touched by this step. |

Nothing to create in Supabase, Clerk, Google Cloud or RevenueCat, and nothing to deploy. The app makes its own short-lived download link with the Clerk session token it already sends (step 17), so no key travels anywhere.

### A. Before the phone tests

1. Say yes to implement.
2. When the implementer is done, **restart Metro** with `npx expo start -c` (new files add classes, modules and a picture), then force-quit and reopen Expo Go.
3. You need a reflection that has **real audio**. Open Journal: the reflections made since 2026-10-24 should have it (step 22 turned speech on that day). Open it: the purple player card shows a length such as `0:00 / 1:53`. A card that says "Your devotional is ready to read below." has no audio and cannot be played. If none of your reflections has audio, write a new one (the account needs the plan `pro`, or fewer than three devotionals this week: Profile shows the plan; Table Editor, `users_profile`, your row, `subscription_tier` = `pro` if it does not).
4. For B10 and B11 a **second** reflection with audio helps.
5. For B7 a music app (Apple Music or Spotify) with something to play. For B8 headphones (wired or Bluetooth), if you have them. The ring and silent switch is on the left side of the iPhone.
6. What it costs: nothing new. The first play of a devotional downloads about 5 MB from Storage (the free plan allows 5 GB of downloads a month, about 900 first plays) and the phone keeps the file, so each devotional is downloaded once per phone.

### B. Phone walk-through (iPhone, Expo Go)

Tell the implementer what you saw after each step. The Developer controls are at the bottom of the Profile tab. This step adds nothing there: the existing "Open player (dev)" row still works.

0. **Start.** Sign in. On Profile press "Supabase check (dev)": expect `data source: supabase` and `signed in: yes`. (Playback needs the real data. If it says `mock`, press `supabase` under "Data source (dev)".)
1. **First play.** Open a reflection that has audio. On the purple card press the round play button. The button shows a small spinner for a second or two (the file is downloaded once), then you hear the devotional from the loudspeaker, the time runs and the bar fills. The length is the one the card showed before you pressed play. Press pause: the sound stops and the time stays. Press play: it goes on from there.
2. **Now Playing.** Tap the card (or "Tap to open player"). The sheet opens and the sound does not stop. Drag the scrubber: the sound jumps to that place. Press the back and forward 15 buttons. Press **0.8x**, **1x** and **1.2x**: the speed changes and the voice does not get higher or lower. The ambient chips make no sound yet (step 27). Close the sheet: the sound goes on (the footer line says so). Go back to Journal and to another tab: the sound still goes on, and nothing there shows it (question (g) in the decisions); pause it from the lock screen or open the reflection again.
3. **The play button on Journal.** On Journal, tap the small dark pill with the play triangle and the time on a card with audio. Reflection opens and the devotional is playing (a spinner first). Then tap the **rest** of another card: it only opens Reflection and plays nothing.
4. **Lock screen.** While a devotional plays, press the side button. The sound goes on. Wake the phone: the lock screen shows a player with the devotional's title, "Gracehush • {the scripture reference}" and a purple picture with the logo. Press pause and play there, and the 15-second skip buttons: they work. Unlock and open the app: the time and the play or pause button match what you did on the lock screen (give it a second).
5. **Pause, then lock.** Pause the devotional in the app, press the side button and wake the phone: the player is still on the lock screen and its play button starts the devotional. (If the card is gone after a pause, tell the implementer: `KEEP_SESSION_ACTIVE` in `src/constants/audio.ts` is the setting.)
6. **Silent switch.** Flip the ring and silent switch to silent and play a devotional: you still hear it. Flip it back.
7. **Other audio.** Start music in another app, then press play on a devotional: the music stops. Pause the devotional: the music does **not** start again by itself (expected, finding 7): start it yourself.
8. **Interruptions** (a and b are enough). (a) With headphones on and a devotional playing, unplug them or switch the Bluetooth off: it pauses, and does not start again when you plug them back in. (b) Say "Hey Siri, what time is it" while it plays: it pauses while Siri speaks. Tell the implementer what it does after that (it may start again by itself, which is the iPhone's own rule: finding 9, or it may stay paused). (c) If a phone call is easy to arrange, do the same with a call.
9. **Recording while playing.** While a devotional plays, go to the Journal tab (the sound goes on) and tap the mic button: New Entry opens in Speak. Tap the big round microphone: the devotional pauses at once, before the recording starts. Stop with the X and discard it. Open the same reflection again and press play: the sound comes from the loudspeaker (not the earpiece), at the normal volume, and the lock screen still works.
10. **Offline.** Turn Airplane mode on (Expo Go keeps running). (a) A devotional you have already played plays normally (the phone has the file). (b) A devotional you have **never** played: press play: the line "Audio needs a connection." shows under the player and the button is a play button again. Turn Airplane mode off and press play again: it downloads and plays.
11. **Another devotional.** Play devotional A. Open reflection B and press its play button: A stops and B plays, and the lock screen now shows B. Open A again: its player shows `0:00` and is paused (another devotional replaced it, as before); press play: it plays from the start.
12. **The end.** In Now Playing drag the scrubber to the last few seconds and let it play out: the sound stops, the time shows the full length and the orb becomes a replay arrow ("Play again"). Press it: the devotional plays from `0:00`. Do it once more, lock the phone while it shows the end, and press play on the lock screen: it plays from the start.
13. **Sign out.** Play a devotional and sign out (Profile, Sign Out, confirm): the sound stops and the lock-screen card is gone. Sign in again: nothing plays by itself; playing the same devotional downloads it again.
14. **The mock still behaves.** Profile, "Data source (dev)", **mock**: Journal shows the sample cards. Press play on a sample's mini player: after a moment the line "We couldn’t load the audio. Tap play to try again." shows, and nothing crashes. Switch back to **supabase**.

Not testable on an iPhone in Expo Go, and said so in the report: how Android behaves (below), whether the sound is good on every speaker, a call from a real person while a devotional plays, and what a development build does differently (step 35).

### C. Android (optional, and only with your yes)

The emulator window holds your own signed-in account, so opening the app there runs it against your real project, and its Expo Go (57) cannot open this project until the `Expo-Go-58.0.5.apk` from `expo/expo-go-releases` is installed. The implementer asks first. If you say no, Android is reported "not verified".

### If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| the spinner in the play button never ends | the file is still downloading or the connection stalled: wait; after a while the line "We couldn’t load the audio. Tap play to try again." or "Audio needs a connection." shows and the button is a play button again |
| "Audio needs a connection." with the network on | the phone has no file for this devotional yet and could not reach Storage: check the Wi-Fi or data, press play again |
| "We couldn’t load the audio. Tap play to try again." for a reflection that has audio | the file is missing in Storage (Table Editor, `journal_entries`, `devotional_audio_path`, then Storage, `journal_media`, your folder, `devotionals/`), the session was refused (sign out and in), or the file is damaged (the app already fetched it a second time) |
| the sound is quiet or only in the earpiece | the recording mode was left on: tell the implementer (`audioSession.ts` and the recorder's `endSession`) |
| the sound stops when the screen locks | Expo Go on iPhone allows background audio, so this is a bug: tell the implementer (`shouldPlayInBackground` in `audioSession.ts`) |
| no player on the lock screen | the lock-screen call failed (it never shows an error): tell the implementer; with a title but no picture, the picture could not be loaded |
| after editing `playerStore.ts` the sound doubles or will not stop | development only: Fast Refresh runs the file again and leaves the old native player playing under a new store. Reload the app (shake, Reload) after any edit of that file |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **`expo-audio`, not `react-native-track-player`** (finding 1). AGENTS.md already says so. No package is installed or removed.
2. **One native line.** `app.json`: `enableBackgroundPlayback` `true` (it adds the iOS `audio` background mode and, on Android, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the lock-screen service; introspected in the review). No `prebuild`, no `eas.json`, no development build.
3. **Download once, play from the phone** (finding 4): the cache folder (`Paths.cache/devotionals/{entryId}.wav`), the newest 12 kept (about 66 MB at most for normal devotionals), a 300-second link used at once and never kept, a `.part` file moved into place, a file under 1 KB is not audio, and the system may clear the cache folder (the next play downloads again).
4. **`keepAudioSessionActive: true`** (finding 7), the constant `KEEP_SESSION_ACTIVE`.
5. **One player per devotional**, made when its file is on the phone and released when another devotional is loaded or the account signs out. A report from a player that was let go of has nowhere to go.
6. **The store keeps its shape.** The state names and action names are unchanged; `isBuffering` and `error` (`"offline"` or `"unavailable"`) are added. `load(track, ambient)` is still synchronous, and a devotional is still loaded only when the person acts on a player, never because its reflection was viewed. What `load` starts in the background is the download and the player.
7. **A play button on the Journal card.** The duration pill of a ready card becomes its own button (the touch area grows to 44 with `hitSlop`). Pressing it loads the devotional, starts it and opens Reflection, so the player card is on screen; the rest of the card only opens Reflection. It plays only on a tap, so it is not autoplay (AGENTS.md forbids autoplay for crisis entries, and a crisis card has no pill). For a screen reader the card stays the one element and "Play devotional" is an action on it (a pill with a label of its own would be a second stop on every card).
8. **Two session modes, six fields each** (finding 3), both `doNotMix` so that nothing else's sound mixes into a devotional or a take. A take pauses the devotional first (finding 10).
9. **Interruptions follow the platform** (finding 9). The old "never auto-resume" is not built.
10. **The lock screen** shows the title, "Gracehush • {reference}" and the picture, with 15-second skip buttons; never the words, the emotion or the date. Android draws numbered icons for 5, 10, 15 and 30 seconds.
11. **Two calm lines, no alerts.** `error` `"offline"` shows "Audio needs a connection." and `"unavailable"` shows "We couldn’t load the audio. Tap play to try again." in the mini player and under the controls of Now Playing (a polite live region); pressing play tries again from the start of the fetch. Nothing is logged about a link, a path, a title or an id: a development warning names only the session mode that failed.
12. **A file the player cannot open is fetched again once** (a damaged copy is the likely cause); a second failure is `unavailable`. A player that never says it has loaded is given 10 seconds (`LOAD_TIMEOUT_MS`).
13. **Sign-out** (finding 13).
14. **The artwork** (finding 12) is the review's own render. If you do not like it, replace `assets/images/player-artwork.png` with a 1024 by 1024 PNG of your own: no code changes.
15. **The mock source plays nothing** (finding 14).
16. **Known limits and questions** are reported, not decided: (a) a devotional's position is not remembered when another devotional is loaded or the app is closed (as since step 12); (b) a report made just before a pause and delivered just after it can show "playing" until the next report (at most 250 ms); (c) there is no download progress, only the spinner; (d) iOS may clear the cache folder when the phone is short of space, and the next play downloads again; (e) Android was not run (see C), so the media notification, the numbered skip icons and the three-minute rule of background playback are as the docs and the sources say, not as seen; (f) **a question for you:** the old "never auto-resume" (finding 9); (g) **a question for you:** the devotional keeps playing when you leave its reflection (the rule since step 12), and V1 has no mini player on Journal, Prayers or Profile, so nothing on those screens shows it or stops it; the lock screen, Control Center and the reflection itself do. With a mock timer that was invisible; with sound it may not be what you want. Keeping it suits a listener who prays in the car or on a walk, and a small mini player above the tab bar is the usual answer: it is a new feature (AGENTS.md: ask first), so it is not built here.

---

## 0. Before you write code

1. Read AGENTS.md (the new "Playback (expo-audio, step 26)" in the Audio Rules, the vendor notes "expo-audio 58 playback" and "expo-file-system 58 download", Backend requirement 13, and "Linting and Validation") and these files: `src/store/playerStore.ts`, `src/hooks/usePlayback.ts`, `src/components/MiniPlayerCard.tsx`, `src/screens/journal/NowPlayingScreen.tsx`, `src/screens/journal/ReflectionScreen.tsx`, `src/components/JournalCard.tsx`, `src/screens/journal/JournalFeedScreen.tsx`, `src/services/recorder.ts`, `src/services/account.ts`, `src/constants/audio.ts`, `src/constants/images.ts`, `src/data/selectors.ts` (`getPlaybackTrack`), `app.json`, `src/types/index.ts` and `supabase/tests/playback/` (`world.cjs` and `run.cjs`).
2. Baseline. `node --version` must be 22.5 or newer (24.15 here). `npm run typecheck` and `npm run lint` must pass. `node --no-warnings supabase/tests/journal-data/run.cjs` must end `86 checks passed` and `node supabase/tests/process-entry/parity.cjs` must say `7 of 7`: neither is touched by this step. Write down `git status --short`: `src/`, `package.json`, `package-lock.json` and `app.json` must be clean. The review's own files may show as modified or new until they are committed: `AGENTS.md` and its copy, this prompt, the three older checks of section 3.1, `supabase/tests/playback/` and `assets/images/player-artwork.png`.
3. **Red first.** Run the new checks and the three edited older ones, and see exactly this (the code of this step is not in yet):
   - `node --no-warnings supabase/tests/playback/run.cjs` prints `1 checks passed, 126 FAILED`, and the failures say `cannot resolve @/services/audioSession`, `@/services/devotionalAudio` or `@/services/lockScreen` (the one check that passes is "the first load copies the profile's ambient choice, later ones keep the session's", which describes behaviour that stays);
   - `node --no-warnings supabase/tests/recording/run.cjs` prints `63 passed, 5 failed` (the five recorder checks);
   - `node --no-warnings supabase/tests/offline/run.cjs` prints `1 of 44 FAILED` (the sign-out check);
   - `node --no-warnings supabase/tests/profile-sync/run.cjs` prints `87 passed, 1 failed` (about 35 seconds; the account check).
4. Write down what you keep. `usePlayerStore`, every state name (`entryId`, `title`, `subtitle`, `durationMs`, `positionMs`, `status`, `rate`, `ambientSound`, `ambientVolume`) and every action name (`load`, `play`, `pause`, `toggle`, `seekTo`, `skipBy`, `setRate`, `setAmbient`, `setAmbientVolume`, `stop`, `reseedAmbient`) stay; `usePlayback` is not edited; `getPlaybackTrack(entry)` keeps its signature and answers null for the same entries as before; `PlaybackTrack` gains `audioPath`, and `PlaybackError` is new.
5. **No install.** `package.json` and `package-lock.json` must be byte-identical at the end (`git diff --stat` shows neither). `app.json` differs by exactly one line.
6. **The artwork is already in the repo:** `assets/images/player-artwork.png` (1024 by 1024, opaque, 451,980 bytes). Check that it is there and do not regenerate, download or replace it.
7. List every `TEMP(26)` and `TODO(26)` with file:line (`grep -rn "TEMP(26)\|TODO(26)" src`). Five today: `src/store/playerStore.ts` twice (the mock, and the pause when the app leaves the foreground), `src/components/JournalCard.tsx` (play in place), `src/screens/journal/NowPlayingScreen.tsx` (the footer line) and `src/services/account.ts` (clear the lock screen and release the player). The edits below close each one, and `grep` must find none at the end.

---

## 1. The files to create (verbatim)

All LF. They are the finished, proven files: do not reword them, and do not add what is not here. The three services come first; the player store that uses them is replaced whole in section 2 (2.15).

### 1.1 `src/services/audioSession.ts`

The one place that calls `setAudioModeAsync`: two modes, six fields each, never cached, never thrown.

```ts
import { setAudioModeAsync, type AudioMode } from "expo-audio";

// The app's audio session has two modes, and this is the only file that calls setAudioModeAsync (step 26).
//
// Every call carries every field. On iOS the native side builds the whole mode from what it is given and fills a missing
// field with its own default (playsInSilentMode false, interruptionMode mixWithOthers, shouldPlayInBackground false), so a
// partial call such as { allowsRecording: false } quietly turned the silent-switch, background and lock-screen settings
// off: step 23's recorder made calls like that, and this file replaces them.
export type SessionMode = "playback" | "recording";

const MODES: Record<SessionMode, AudioMode> = {
  // A devotional: heard with the silent switch on, in the background and from the lock screen. doNotMix is what makes the
  // lock-screen card belong to this app (expo-audio's own requirement), and it stops other apps' sound while it plays.
  playback: {
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: false,
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  },
  // A take: the microphone is allowed and the speaker stays the output. A take is never made in the background (step 23),
  // so playing in the background is off while one runs.
  recording: {
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  },
};

// Never throws: a mode that cannot be set leaves the previous one in place. A recorder that really cannot record fails at
// prepare or record, and a player at play, which their callers already handle. Every call reaches the native side, so
// resuming a take sets its mode again, as it did before this file existed.
export async function setSessionMode(mode: SessionMode): Promise<boolean> {
  try {
    await setAudioModeAsync(MODES[mode]);
    return true;
  } catch {
    // Only the mode's name: a native error can carry more than that.
    if (__DEV__) console.warn(`[audio] the ${mode} session mode could not be set`);
    return false;
  }
}
```

### 1.2 `src/services/devotionalAudio.ts`

The file of a devotional on the phone: a 300-second link, one download through a `.part` file, the newest 12 kept, a download that is aborted at sign-out, and the two pure failure mappers that the checks call.

```ts
import { StorageApiError } from "@supabase/supabase-js";
import { Directory, File, Paths } from "expo-file-system";

import {
  DEVOTIONAL_CACHE_FOLDER,
  DEVOTIONAL_EXTENSION,
  DEVOTIONAL_LINK_SECONDS,
  MAX_CACHED_DEVOTIONALS,
  MIN_DEVOTIONAL_FILE_BYTES,
} from "@/constants/audio";
import { getSupabase } from "@/services/supabaseClient";
import { NO_SESSION_ERROR_NAME, toFailureCode } from "@/utils/supabaseErrors";

// A devotional is a lossless WAV of about 5 MB (step 22), so it is downloaded once and played from the phone: no link can
// expire in the middle of a prayer, a second listen costs no data, and a devotional that was played works offline. The
// file lives in the app's cache folder, which iOS leaves out of backups and may empty when space runs short (the next play
// then downloads it again). Only the newest MAX_CACHED_DEVOTIONALS are kept, and sign-out deletes all of them.
//
// The bucket is private (step 18): the link comes from Supabase for the signed-in user, is valid for a few minutes, is used
// for this one download and is never kept. Nothing here logs: a link, a path or an id is about a person's prayer.
const BUCKET = "journal_media";
const PART_SUFFIX = ".part";

export type DevotionalFailureCode = "NETWORK" | "UNAUTHORIZED" | "NOT_FOUND" | "UNKNOWN";

export type DevotionalFileResult = { ok: true; uri: string } | { ok: false; code: DevotionalFailureCode };

// An entry id comes from the server (a UUID) or from the mock data ("entry-anxious-yesterday"); both are safe in a file
// name. Anything else is refused rather than turned into a path.
const SAFE_ENTRY_ID = /^[A-Za-z0-9_-]{1,80}$/;

const UNKNOWN = { ok: false, code: "UNKNOWN" } as const;

function folder(): Directory {
  return new Directory(Paths.cache, DEVOTIONAL_CACHE_FOLDER);
}

function fileFor(entryId: string, suffix = ""): File {
  return new File(folder(), `${entryId}${DEVOTIONAL_EXTENSION}${suffix}`);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone, or left for the next clean-up.
  }
}

type Running = { promise: Promise<DevotionalFileResult>; abort: AbortController };

// One download per entry: a second request for the same devotional waits for the first. Sign-out stops them all.
const running = new Map<string, Running>();

// Pure: what Storage answered when asked for a link, as a failure code. A rejected request (offline, or a token that could
// not be fetched) is a StorageUnknownError that holds the original error, so it is read as "no answer".
export function toStorageFailure(error: unknown): DevotionalFailureCode {
  if (error instanceof StorageApiError) {
    // A missing object is HTTP 400 with a body that says 404 (newer builds send a real 404).
    if (error.status === 404 || error.statusCode === "404") return "NOT_FOUND";
    return toFailureCode(error.status, { message: error.message, code: error.code });
  }
  const original =
    typeof error === "object" && error !== null && "originalError" in error ? error.originalError : error;
  const name = original instanceof Error ? original.name : "";
  return name === NO_SESSION_ERROR_NAME ? "UNAUTHORIZED" : "NETWORK";
}

// Pure: what a failed download said. The text names the HTTP status when the server answered ("response has status 403" on
// iOS, "response has status: 403" or "HTTP 403" on Android) and names none when the connection failed.
export function toDownloadFailure(error: unknown): DevotionalFailureCode {
  const message = error instanceof Error ? error.message : "";
  const status = /(?:status:?|HTTP)\s*(\d{3})/i.exec(message);
  if (status === null) return "NETWORK";
  const code = Number(status[1]);
  if (code === 401 || code === 403) return "UNAUTHORIZED";
  if (code === 404) return "NOT_FOUND";
  return "UNKNOWN";
}

async function signedLink(path: string): Promise<{ ok: true; url: string } | { ok: false; code: DevotionalFailureCode }> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, DEVOTIONAL_LINK_SECONDS);
    if (error !== null) return { ok: false, code: toStorageFailure(error) };
    return data?.signedUrl ? { ok: true, url: data.signedUrl } : UNKNOWN;
  } catch (error) {
    return { ok: false, code: toStorageFailure(error) };
  }
}

// Keeps the newest MAX_CACHED_DEVOTIONALS files (the one just saved is always one of them) and clears the unfinished
// downloads that an earlier run left behind. Never throws: the cache is a convenience.
function pruneCache(keepEntryId: string): void {
  try {
    const directory = folder();
    if (!directory.exists) return;
    const files = directory.list().filter((item): item is File => item instanceof File);
    for (const file of files) {
      if (!file.name.endsWith(PART_SUFFIX)) continue;
      const entryId = file.name.slice(0, -(DEVOTIONAL_EXTENSION.length + PART_SUFFIX.length));
      if (!running.has(entryId)) deleteQuietly(file);
    }
    const keepName = `${keepEntryId}${DEVOTIONAL_EXTENSION}`;
    const older = files
      .filter((file) => file.name.endsWith(DEVOTIONAL_EXTENSION) && file.name !== keepName)
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    for (const file of older.slice(Math.max(0, MAX_CACHED_DEVOTIONALS - 1))) deleteQuietly(file);
  } catch {
    // Left for the next download.
  }
}

async function fetchFile(entryId: string, audioPath: string, signal: AbortSignal): Promise<DevotionalFileResult> {
  try {
    const target = fileFor(entryId);
    if (target.exists) {
      if (target.size >= MIN_DEVOTIONAL_FILE_BYTES) return { ok: true, uri: target.uri };
      // Too small to be audio: a save that did not finish.
      deleteQuietly(target);
    }
    const link = await signedLink(audioPath);
    if (!link.ok) return link;
    if (signal.aborted) return UNKNOWN;
    folder().create({ intermediates: true, idempotent: true });
    // The download goes to a file of its own and is moved into place when it is whole: on Android a failed download can
    // leave a half-written file at its destination, and a half-written devotional must never look like a finished one.
    const part = fileFor(entryId, PART_SUFFIX);
    try {
      await File.downloadFileAsync(link.url, part, { idempotent: true, signal });
    } catch (error) {
      deleteQuietly(part);
      return signal.aborted ? UNKNOWN : { ok: false, code: toDownloadFailure(error) };
    }
    if (!part.exists || part.size < MIN_DEVOTIONAL_FILE_BYTES) {
      deleteQuietly(part);
      return UNKNOWN;
    }
    await part.move(target, { overwrite: true });
    // Signed out while it ran (the abort cannot always reach a download that is nearly done): what arrived is not kept.
    if (signal.aborted) {
      deleteQuietly(target);
      return UNKNOWN;
    }
    pruneCache(entryId);
    return { ok: true, uri: target.uri };
  } catch {
    return UNKNOWN;
  }
}

// The devotional's audio as a file on the phone: the one already there, or one downloaded now. Never throws. The caller
// passes the entry id (the file's name) and the storage path from the entry (where it is).
export function getDevotionalFile(entryId: string, audioPath: string): Promise<DevotionalFileResult> {
  if (!SAFE_ENTRY_ID.test(entryId)) return Promise.resolve(UNKNOWN);
  const existing = running.get(entryId);
  if (existing !== undefined) return existing.promise;
  const abort = new AbortController();
  const promise = fetchFile(entryId, audioPath, abort.signal).finally(() => {
    if (running.get(entryId)?.abort === abort) running.delete(entryId);
  });
  running.set(entryId, { promise, abort });
  return promise;
}

// A file the player could not open is deleted, so the next request downloads it again. Never throws.
export function forgetDevotionalFile(entryId: string): void {
  if (!SAFE_ENTRY_ID.test(entryId)) return;
  deleteQuietly(fileFor(entryId));
}

// Sign-out and account deletion: a prayer's audio must not outlive the session. Downloads that are still running are
// stopped, and one that finishes anyway deletes its file (it checks its signal). Never throws.
export async function deleteAllDevotionalAudio(): Promise<void> {
  for (const { abort } of running.values()) abort.abort();
  running.clear();
  try {
    const directory = folder();
    if (directory.exists) directory.delete();
  } catch {
    // Left for the next download's clean-up.
  }
}
```

### 1.3 `src/services/lockScreen.ts`

What the lock screen, Control Center, a headset and the car show and can do: the title, the reference, 15-second skip buttons and the picture. Nothing here throws or logs.

```ts
import { Asset } from "expo-asset";
import type { AudioLockScreenOptions, AudioMetadata, AudioPlayer } from "expo-audio";

import { SKIP_MS } from "@/constants/app";
import { images } from "@/constants/images";
import type { PlaybackTrack } from "@/types";

// What the lock screen, Control Center, CarPlay, a headset and the Android notification show and can do while a devotional
// is loaded (step 26). Only the title and the scripture reference ever go on it: never the words, the emotion or the date.
// Nothing here throws or logs: a lock screen that cannot be set up leaves the devotional playable in the app.
type LockScreenTrack = Pick<PlaybackTrack, "title" | "subtitle">;

// The two skip buttons jump as far as the buttons in the app. Android draws a numbered icon for 5, 10, 15 and 30 seconds.
const OPTIONS: AudioLockScreenOptions = {
  showSeekForward: true,
  showSeekBackward: true,
  seekForwardIntervalSeconds: SKIP_MS / 1000,
  seekBackwardIntervalSeconds: SKIP_MS / 1000,
};

// The artwork is a file address: expo-audio hands it to the system, which loads it itself. The bundled picture is turned
// into a local file once (in development Metro serves it, in a build it is already on the phone). A failure is not kept,
// so the next devotional tries again.
let artworkUrl: string | null = null;

async function resolveArtwork(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(images.playerArtwork);
    await asset.downloadAsync();
    artworkUrl = asset.localUri ?? null;
  } catch {
    artworkUrl = null;
  }
  return artworkUrl;
}

function metadata(track: LockScreenTrack, artwork: string | null): AudioMetadata {
  return artwork === null
    ? { title: track.title, artist: track.subtitle }
    : { title: track.title, artist: track.subtitle, artworkUrl: artwork };
}

// Puts the player on the lock screen. The controls appear at once; the artwork is added when it is ready, because the
// first lookup can take a moment and must not hold the controls back.
export function activateLockScreen(player: AudioPlayer, track: LockScreenTrack): void {
  try {
    player.setActiveForLockScreen(true, metadata(track, artworkUrl), OPTIONS);
  } catch {
    return;
  }
  if (artworkUrl !== null) return;
  void resolveArtwork().then((artwork) => {
    if (artwork === null) return;
    try {
      // Has no effect when the player is not the active one any more (another devotional, or sign-out).
      player.updateLockScreenMetadata(metadata(track, artwork));
    } catch {
      // The player was released while the picture was loading.
    }
  });
}

export function clearLockScreen(player: AudioPlayer): void {
  try {
    player.clearLockScreenControls();
  } catch {
    // Already released.
  }
}
```

---

## 2. Edits to the existing files

Each block gives the text to find (it occurs exactly once in its file, as LF text) and the text that replaces it. One file is replaced whole (2.15). These files use CRLF line endings: `src/types/index.ts`, `src/data/selectors.ts`, `src/constants/copy.ts`, `src/services/account.ts`, `src/screens/journal/NowPlayingScreen.tsx`, `src/store/playerStore.ts`. These use LF: `src/constants/audio.ts`, `src/constants/images.ts`, `src/types/assets.d.ts`, `src/services/recorder.ts`, `src/components/MiniPlayerCard.tsx`, `src/components/JournalCard.tsx`, `src/screens/journal/JournalFeedScreen.tsx`, `src/components/dev/processEntryCheck.ts`, and `app.json`. Keep each file's endings: the Edit tool matches a single line in a CRLF file, but a block of several lines may not match, so apply a multi-line block with a small Node script that matches on the LF text and writes CRLF back (the review's own script did exactly that, and the result is byte-identical to the proven files).

Anything not listed stays as it is: no layout, no token, no class and no other copy string changes. **Delete nothing else.**

### 2.1 `src/types/index.ts`

A comment no longer promises a link, `PlaybackError` says why the audio could not be had, and `PlaybackTrack` carries the path of the file.

a) Find:

```ts
// A crisis entry comes back with `affirmations: []`. A devotional's `audioPath` and `durationMs` are a path and a number:
// the function returns and stores no link (step 22), and the app asks Supabase for its own signed link (step 26).
```

Replace with:

```ts
// A crisis entry comes back with `affirmations: []`. A devotional's `audioPath` and `durationMs` are a path and a number:
// the function returns and stores no link (step 22), and the app asks Supabase for a short-lived link of its own to download
// the file once (step 26).
```

b) Find:

```ts
export type PlaybackRate = 0.8 | 1 | 1.2;
// `subtitle` is "Gracehush • Philippians 4:6–7", the same string step 26 puts on the lock screen.
export type PlaybackTrack = { entryId: string; title: string; subtitle: string; durationMs: number };
```

Replace with:

```ts
export type PlaybackRate = 0.8 | 1 | 1.2;
// Why a devotional's audio could not be had (step 26): the phone has no connection ("offline"), or the file is missing or
// would not open ("unavailable"). The next play tries again.
export type PlaybackError = "offline" | "unavailable";
// `subtitle` is "Gracehush • Philippians 4:6–7", the same string step 26 puts on the lock screen. `audioPath` is where the
// file is in Storage (step 22): the player downloads it once and plays it from the phone.
export type PlaybackTrack = {
  entryId: string;
  title: string;
  subtitle: string;
  durationMs: number;
  audioPath: string;
};
```

### 2.2 `src/data/selectors.ts`

`getPlaybackTrack` hands the path on. It already answered null for an entry with no audio, a crisis entry and an unfinished one, so no entry starts or stops being playable.

a) Find:

```ts
  return {
    entryId: entry.id,
    title: devotional.title,
    subtitle: copy.nowPlaying.subtitle(entry.scripture?.reference ?? null),
    durationMs,
  };
```

Replace with:

```ts
  return {
    entryId: entry.id,
    title: devotional.title,
    subtitle: copy.nowPlaying.subtitle(entry.scripture?.reference ?? null),
    durationMs,
    audioPath,
  };
```

### 2.3 `src/constants/audio.ts`

The playback numbers, each with its reason, below the recording ones.

a) Find:

```ts
// Mirrors MAX_AUDIO_BYTES in supabase/functions/process-entry/constants.ts: the function refuses a larger file, so
// the phone does not upload one. Keep the two in sync.
export const MAX_RECORDING_FILE_BYTES = 12 * 1024 * 1024;
```

Replace with:

```ts
// Mirrors MAX_AUDIO_BYTES in supabase/functions/process-entry/constants.ts: the function refuses a larger file, so
// the phone does not upload one. Keep the two in sync.
export const MAX_RECORDING_FILE_BYTES = 12 * 1024 * 1024;

// ---- Playing a devotional (step 26)

// How often the player reports its position. Each report redraws the two places that show the clock.
export const PLAYER_UPDATE_MS = 250;

// Whether the audio session stays active while a devotional is paused or has finished. On iOS the lock-screen card
// belongs to the app that holds the session: with false the card goes away as soon as the player pauses, and the lock
// screen can no longer resume it. The price of true is that another app's music, which the devotional stopped, does not
// start again by itself: a devotional is a short, deliberate listen, and the session goes back to the system when the
// player is released (sign-out).
export const KEEP_SESSION_ACTIVE = true;

// How long a new player has to say that it has loaded its file before the audio counts as unavailable.
export const LOAD_TIMEOUT_MS = 10_000;

// The devotionals downloaded to the phone live in the cache folder (services/devotionalAudio.ts). Step 22 makes them WAV.
export const DEVOTIONAL_CACHE_FOLDER = "devotionals";
export const DEVOTIONAL_EXTENSION = ".wav";

// A download under this is not audio (a WAV header alone is 44 bytes).
export const MIN_DEVOTIONAL_FILE_BYTES = 1_024;

// The newest this many downloads are kept (about 5 MB each); older ones are deleted when a new one arrives.
export const MAX_CACHED_DEVOTIONALS = 12;

// How long the link that downloads one devotional is valid. It is used at once and never kept.
export const DEVOTIONAL_LINK_SECONDS = 300;
```

### 2.4 `src/constants/images.ts`

The lock-screen picture is imported where every image is (the file already exists: section 0, point 6).

a) Find:

```ts
import logoMark from "@/assets/images/logo-mark.svg";

export const images = {
  logoMark,
  googleG,
  appleLogo,
};
```

Replace with:

```ts
import logoMark from "@/assets/images/logo-mark.svg";
import playerArtwork from "@/assets/images/player-artwork.png";

export const images = {
  logoMark,
  googleG,
  appleLogo,
  // The lock-screen and notification picture of a devotional (step 26): the Now Playing gradient with the logo mark in its
  // frosted tile, 1024 by 1024, no text.
  playerArtwork,
};
```

### 2.5 `src/types/assets.d.ts`

`*.png` imports are typed (only `*.svg` was).

a) Find:

```ts
declare module "*.svg" {
  const source: number;
  export default source;
}
```

Replace with:

```ts
declare module "*.svg" {
  const source: number;
  export default source;
}

declare module "*.png" {
  const source: number;
  export default source;
}
```

### 2.6 `src/constants/copy.ts`

The two lines for audio that could not be had (one object, shared by the mini player and Now Playing), the screen-reader action of a card's play pill, and the Now Playing footer, which was development-only (`devFooter`) and is now true for everyone (`footer`).

a) Find:

```ts
import type { AmbientSound, OutboxStatus, PlaybackRate, TimeSlot } from "@/types";

// "1 day", "7 days". The paywall's trial lines and disclosures share it.
const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);
```

Replace with:

```ts
import type { AmbientSound, OutboxStatus, PlaybackError, PlaybackRate, TimeSlot } from "@/types";

// "1 day", "7 days". The paywall's trial lines and disclosures share it.
const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

// What the mini player and Now Playing say when a devotional's audio could not be had (step 26). Tapping play tries again.
const playbackErrors = {
  offline: "Audio needs a connection.",
  unavailable: "We couldn’t load the audio. Tap play to try again.",
} satisfies Record<PlaybackError, string>;
```

b) Find:

```ts
      seePlansLabel: "See plans to prepare this reflection",
```

Replace with:

```ts
      seePlansLabel: "See plans to prepare this reflection",
      // The screen-reader action of a card with a play pill (step 26). The pill is not a stop of its own: the card is the one
      // element, and this is an action on it.
      playAction: "Play devotional",
```

c) Find:

```ts
      // The spoken time: "34 seconds of 1 minute 15 seconds".
      position: (elapsed: string, total: string) => `${elapsed} of ${total}`,
```

Replace with:

```ts
      // The spoken time: "34 seconds of 1 minute 15 seconds".
      position: (elapsed: string, total: string) => `${elapsed} of ${total}`,
      // Shown in place of the length when the audio could not be had.
      errors: playbackErrors,
```

d) Find:

```ts
    // Shown in development only: it is true only with real audio (the guard is in NowPlayingScreen).
    devFooter: "Audio keeps playing when you close this screen.",
```

Replace with:

```ts
    // True now that the audio is real: the player keeps playing when this screen closes, and in the background.
    footer: "Audio keeps playing when you close this screen.",
    // Under the controls when the audio could not be had.
    errors: playbackErrors,
```

### 2.7 `src/services/recorder.ts`

The recorder no longer calls `setAudioModeAsync`. It asks `setSessionMode`, pauses a devotional that is playing before the microphone is taken, and puts the playback mode back when a take ends, is cancelled or fails to start.

a) Find:

```ts
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
```

Replace with:

```ts
  requestRecordingPermissionsAsync,
  type AudioRecorder,
```

b) Find:

```ts
} from "@/constants/audio";
import type { PermissionResult, RecorderStatus, RecordingResult } from "@/types";
```

Replace with:

```ts
} from "@/constants/audio";
import { setSessionMode } from "@/services/audioSession";
import { usePlayerStore } from "@/store/playerStore";
import type { PermissionResult, RecorderStatus, RecordingResult } from "@/types";
```

c) Find:

```ts
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

function releaseQuietly
```

Replace with:

```ts
function releaseQuietly
```

d) Find:

```ts
  keepAwake(false);
  await allowRecording(false);
}
```

Replace with:

```ts
  keepAwake(false);
  // Back to the playback mode, so the next devotional uses the speaker, plays with the silent switch on and keeps the lock
  // screen (audioSession.ts). Best effort: a recorder that really cannot record fails at prepare or record.
  await setSessionMode("playback");
}
```

e) Find:

```ts
  await endSession();
  let recorder: AudioRecorder | null = null;
  try {
    await allowRecording(true);
```

Replace with:

```ts
  await endSession();
  // A devotional that is playing stops: the take must not hear it, and the microphone takes the audio session.
  usePlayerStore.getState().pause();
  let recorder: AudioRecorder | null = null;
  try {
    await setSessionMode("recording");
```

f) Find:

```ts
    releaseQuietly(recorder);
    await allowRecording(false);
    throw error;
```

Replace with:

```ts
    releaseQuietly(recorder);
    await setSessionMode("playback");
    throw error;
```

g) Find:

```ts
  if (!current) throw new Error("No recording is running");
  await allowRecording(true);
  current.recorder.record();
```

Replace with:

```ts
  if (!current) throw new Error("No recording is running");
  await setSessionMode("recording");
  current.recorder.record();
```

### 2.8 `src/services/account.ts`

Signing out and deleting the account delete the downloaded devotionals once the player has stopped. This closes the `TODO(26)` there.

a) Find:

```ts
import { deleteUserDatabase } from "@/db/database";
import { endOfflineSession } from "@/services/offlineSession";
```

Replace with:

```ts
import { deleteUserDatabase } from "@/db/database";
import { deleteAllDevotionalAudio } from "@/services/devotionalAudio";
import { endOfflineSession } from "@/services/offlineSession";
```

b) Find:

```ts
  // A full reset of the player: the position, the speed and the session's ambient choice.
  usePlayerStore.getState().stop();
  // TODO(26): clear the lock screen and release the player
```

Replace with:

```ts
  // A full reset of the player: the sound stops, the lock screen is cleared and the player is released, and the position,
  // the speed and the session's ambient choice go. Then the devotionals downloaded to this phone, and any download still
  // running (step 26): a prayer's audio must not outlive the session either.
  usePlayerStore.getState().stop();
  await deleteAllDevotionalAudio();
```

### 2.9 `src/components/MiniPlayerCard.tsx`

The play button shows a small spinner while the audio is on its way, the card says when it could not be had (a polite live region), and a screen reader hears that the button is busy.

a) Find:

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
```

Replace with:

```tsx
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
```

b) Find:

```tsx
  const isPlaying = isCurrent && playback.status === "playing";
  const percent
```

Replace with:

```tsx
  const isPlaying = isCurrent && playback.status === "playing";
  // "Playing" while the sound has not started yet: the audio is being downloaded or opened. The button stays a pause button.
  const isBuffering = isPlaying && playback.isBuffering;
  const errorLine = isCurrent && playback.error !== null ? player.errors[playback.error] : null;
  const percent
```

c) Find:

```tsx
            accessibilityLabel={isPlaying ? player.pause : player.play(title)}
            onPress={toggle}
```

Replace with:

```tsx
            accessibilityLabel={isPlaying ? player.pause : player.play(title)}
            accessibilityState={isBuffering ? { busy: true } : undefined}
            onPress={toggle}
```

d) Find:

```tsx
            <View className="size-12 items-center justify-center rounded-full bg-rose">
              <Icon
                name={isPlaying ? icons.pause : icons.play}
                size={28}
                color={colors.plumDeep}
              />
            </View>
```

Replace with:

```tsx
            <View className="size-12 items-center justify-center rounded-full bg-rose">
              {isBuffering ? (
                <ActivityIndicator size="small" color={colors.plumDeep} />
              ) : (
                <Icon
                  name={isPlaying ? icons.pause : icons.play}
                  size={28}
                  color={colors.plumDeep}
                />
              )}
            </View>
```

e) Find:

```tsx
              <Text className="text-body-sm text-white/70">{player.subtitle(minutes)}</Text>
```

Replace with:

```tsx
              <Text
                accessibilityLiveRegion={errorLine === null ? undefined : "polite"}
                className={errorLine === null ? "text-body-sm text-white/70" : "text-body-sm text-white"}
              >
                {errorLine ?? player.subtitle(minutes)}
              </Text>
```

f) Find:

```tsx
// Reads the shared player store (usePlayback), so this card and Now Playing always agree. Playback is
// mocked until step 26.
```

Replace with:

```tsx
// Reads the shared player store (usePlayback), so this card and Now Playing always agree.
```

### 2.10 `src/screens/journal/NowPlayingScreen.tsx`

The same for the 64 dp orb and the line under the controls, and the footer line is shown to everyone. This closes the `TODO(26)` there.

a) Find:

```tsx
import {
  Platform,
  Pressable,
```

Replace with:

```tsx
import {
  ActivityIndicator,
  Platform,
  Pressable,
```

b) Find:

```tsx
  const orb = orbByStatus[status];
```

Replace with:

```tsx
  const orb = orbByStatus[status];
  // "Playing" while the sound has not started yet: the audio is being downloaded or opened. The button stays a pause button.
  const isBuffering = playback.isBuffering && status === "playing";
```

c) Find:

```tsx
          accessibilityLabel={orb.label}
          onPress={playback.toggle}
```

Replace with:

```tsx
          accessibilityLabel={orb.label}
          accessibilityState={isBuffering ? { busy: true } : undefined}
          onPress={playback.toggle}
```

d) Find:

```tsx
            <Icon name={orb.icon} size={34} color="white" />
```

Replace with:

```tsx
            {isBuffering ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Icon name={orb.icon} size={34} color="white" />
            )}
```

e) Find:

```tsx
      <View className="flex-row items-center justify-center gap-2">
        {PLAYBACK_RATES.map((value) => (
```

Replace with:

```tsx
      {playback.error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-center text-body-sm text-rosewood"
        >
          {nowPlaying.errors[playback.error]}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-center gap-2">
        {PLAYBACK_RATES.map((value) => (
```

f) Find:

```tsx
      {/* TODO(26): show it to everyone once background playback works */}
      {__DEV__ ? (
        <Text className="text-center text-body-sm text-mauve">{nowPlaying.devFooter}</Text>
      ) : null}
```

Replace with:

```tsx
      <Text className="text-center text-body-sm text-mauve">{nowPlaying.footer}</Text>
```

### 2.11 `src/components/JournalCard.tsx`

The duration pill of a ready card is a button that plays, with a 44 dp touch area, and the card gets the screen-reader action "Play devotional". This closes the `TODO(26)` there.

a) Find:

```tsx
// durationMs is nullable (audio can exist without a measured length), so then it shows the icon alone.
// A plain View while the whole card opens Reflection.
// TODO(26): play in place (its own Pressable, with hitSlop so the touch area is 44)
function DurationPill({ durationMs }: { durationMs: number | null | undefined }) {
  return (
    <View className="min-h-[26px] flex-row items-center gap-1.5 rounded-full bg-plum-deep px-3 py-1">
      <Icon name={icons.play} size={14} color="white" />
      {durationMs ? (
        <Text
          className="font-dm-semibold text-[12px] leading-[18px] text-white"
          style={styles.tabular}
        >
          {formatDuration(durationMs)}
        </Text>
      ) : null}
    </View>
  );
}
```

Replace with:

```tsx
// durationMs is nullable (audio can exist without a measured length), so then it shows the icon alone.
// With onPlay it is a button of its own: it opens the reflection and starts the devotional (the rest of the card only
// opens it). For a screen reader the card stays the one element and "Play devotional" is an action on it (see
// JournalCard), so the pill is not a second stop.
function DurationPill({
  durationMs,
  onPlay,
}: {
  durationMs: number | null | undefined;
  onPlay?: () => void;
}) {
  const pill = (
    <View className="min-h-[26px] flex-row items-center gap-1.5 rounded-full bg-plum-deep px-3 py-1">
      <Icon name={icons.play} size={14} color="white" />
      {durationMs ? (
        <Text
          className="font-dm-semibold text-[12px] leading-[18px] text-white"
          style={styles.tabular}
        >
          {formatDuration(durationMs)}
        </Text>
      ) : null}
    </View>
  );
  if (onPlay === undefined) return pill;
  return (
    <Pressable
      accessible={false}
      // The pill is 26 tall, so 9 above and below makes a 44 touch area.
      hitSlop={{ top: 9, bottom: 9, left: 8, right: 8 }}
      onPress={onPlay}
      style={({ pressed }) => pressed && styles.pressedSoft}
    >
      {pill}
    </Pressable>
  );
}
```

b) Find:

```tsx
  online,
  onReview,
  onUnlock,
}: {
  entry: HomeEntry;
  kind: CardKind;
  pendingLine: string | null;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
}) {
  const { card } = copy.journal;
```

Replace with:

```tsx
  online,
  onReview,
  onUnlock,
  onPlay,
}: {
  entry: HomeEntry;
  kind: CardKind;
  pendingLine: string | null;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
  onPlay?: (entry: HomeEntry) => void;
}) {
  const { card } = copy.journal;
```

c) Find:

```tsx
            <DurationPill durationMs={entry.devotional?.durationMs} />
```

Replace with:

```tsx
            <DurationPill
              durationMs={entry.devotional?.durationMs}
              onPlay={onPlay === undefined ? undefined : () => onPlay(entry)}
            />
```

d) Find:

```tsx
  // A reflection the free limit is holding back: "See plans" opens the Paywall.
  onUnlock?: (entry: HomeEntry) => void;
};

export function JournalCard({ entry, now, online, onOpen, onReview, onUnlock }: JournalCardProps) {
```

Replace with:

```tsx
  // A reflection the free limit is holding back: "See plans" opens the Paywall.
  onUnlock?: (entry: HomeEntry) => void;
  // The play pill of a finished devotional (step 26): open the reflection and start playing.
  onPlay?: (entry: HomeEntry) => void;
};

export function JournalCard({
  entry,
  now,
  online,
  onOpen,
  onReview,
  onUnlock,
  onPlay,
}: JournalCardProps) {
```

e) Find:

```tsx
  const hasButton =
    entry.pending?.status === "needs_action" || entry.pending?.status === "limit_reached";
```

Replace with:

```tsx
  const hasButton =
    entry.pending?.status === "needs_action" || entry.pending?.status === "limit_reached";
  // Only a devotional that has audio can be played from its card.
  const play = kind === "ready" ? onPlay : undefined;
```

f) Find:

```tsx
        onReview={onReview}
        onUnlock={onUnlock}
      />
    </View>
  );
```

Replace with:

```tsx
        onReview={onReview}
        onUnlock={onUnlock}
        onPlay={play}
      />
    </View>
  );
```

g) Find:

```tsx
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onOpen(entry.id)}
```

Replace with:

```tsx
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={play ? [{ name: "play", label: copy.journal.card.playAction }] : undefined}
      onAccessibilityAction={
        play
          ? (event) => {
              if (event.nativeEvent.actionName === "play") play(entry);
            }
          : undefined
      }
      onPress={() => onOpen(entry.id)}
```

### 2.12 `src/screens/journal/JournalFeedScreen.tsx`

What the pill does: load the devotional, play it and open its reflection. The store is read without subscribing, so this screen does not redraw on every tick of the clock.

a) Find:

```tsx
import {
  filterEntries,
  getAffirmationForSlot,
  getGreeting,
  getUnsentCount,
  type JournalFilter,
} from "@/data/selectors";
```

Replace with:

```tsx
import {
  filterEntries,
  getAffirmationForSlot,
  getGreeting,
  getPlaybackTrack,
  getUnsentCount,
  type JournalFilter,
} from "@/data/selectors";
```

b) Find:

```tsx
import { discardItem } from "@/services/syncEngine";
import type { HomeEntry } from "@/types";
```

Replace with:

```tsx
import { discardItem } from "@/services/syncEngine";
import { usePlayerStore } from "@/store/playerStore";
import type { HomeEntry } from "@/types";
```

c) Find:

```tsx
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
              onReview={setReviewing}
```

Replace with:

```tsx
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
              onPlay={(entry) => {
                const track = getPlaybackTrack(entry);
                if (track === null) return;
                // What the mini player's play button does, then the reflection opens with its player showing. The player
                // is read without subscribing: this screen must not redraw on every tick of the clock.
                const player = usePlayerStore.getState();
                player.load(track, ready.profile);
                player.play();
                navigation.navigate("Reflection", { entryId: entry.id });
              }}
              onReview={setReviewing}
```

### 2.13 `src/components/dev/processEntryCheck.ts`

A comment only: it said that step 26 would make the signed link, and the player makes it for its download.

a) Find:

```ts
  // the app's own signed link plays it, and the bucket is private. The link is made here with this phone's session, with
  // the call step 26 will make, and it is never printed.
```

Replace with:

```ts
  // the app's own signed link reaches it, and the bucket is private. The link is made here with this phone's session, the
  // way the player makes the link it downloads the file with (step 26), and it is never printed.
```

### 2.14 `app.json`

The one native line. Expo Go ignores plugin settings; a development or release build gets the iOS `audio` background mode and, on Android, the media foreground service. `enableBackgroundRecording` stays `false`.

a) Find:

```text
          "enableBackgroundRecording": false,
          "enableBackgroundPlayback": false
```

Replace with:

```text
          "enableBackgroundRecording": false,
          "enableBackgroundPlayback": true
```

### 2.15 `src/store/playerStore.ts` (whole file)

Replace the whole file. Every state name and action name of step 12 is kept, `isBuffering` and `error` are added, the mock clock and its pause when the app leaves the foreground are gone, and the two `TODO(27)` lines stay where they were. The comments give the reasons (what each platform reports, why a report is read the way it is, what each guard is for): read them before changing anything, and keep the order of the checks in `reconcile`.

```ts
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { AppState } from "react-native";
import { create } from "zustand";

import { KEEP_SESSION_ACTIVE, LOAD_TIMEOUT_MS, PLAYER_UPDATE_MS } from "@/constants/audio";
import { setSessionMode } from "@/services/audioSession";
import { forgetDevotionalFile, getDevotionalFile } from "@/services/devotionalAudio";
import { activateLockScreen, clearLockScreen } from "@/services/lockScreen";
import type {
  AmbientDefault,
  AmbientSound,
  PlaybackError,
  PlaybackRate,
  PlaybackStatus,
  PlaybackTrack,
} from "@/types";

// What the mini player and Now Playing both show, and the one real player behind them (step 26). Not persisted.
//
// `status` is what the person sees and asked for: "playing" means the sound is on or on its way. While it is on its way
// (the file is being downloaded, opened, or the player is waiting for data) `isBuffering` is true as well, so a button can
// show a spinner and stay a pause button. `error` says why the audio could not be had; the next play tries again.
type PlayerState = {
  entryId: string | null;
  title: string;
  subtitle: string;
  durationMs: number;
  positionMs: number;
  status: PlaybackStatus;
  isBuffering: boolean;
  error: PlaybackError | null;
  rate: PlaybackRate;
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
  // Synchronous, and the caller passes the profile: the store never fetches for a screen. The audio itself is fetched
  // and opened in the background by what load() starts.
  load: (track: PlaybackTrack, ambient: AmbientDefault) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  skipBy: (deltaMs: number) => void;
  setRate: (rate: PlaybackRate) => void;
  setAmbient: (sound: AmbientSound) => void;
  setAmbientVolume: (volume: number) => void;
  // A full reset, for sign-out (step 15): the sound stops, the lock screen is cleared and the player is released.
  stop: () => void;
  // Profile calls it after a successful ambient save (step 15): the next load of a different devotional copies
  // the profile's ambient choice again. It changes no state, so nothing that is playing changes.
  reseedAmbient: () => void;
};

// The ambient choice is copied from the profile by the first load after the app starts (or after stop(), or after
// reseedAmbient() when Profile saved a new default). Later loads keep the session's choice: a listener's speed
// and sound belong to the session, not to a devotional.
let ambientSeeded = false;

// ---- the player. It is not part of the state: nothing draws from it.
//
// Every devotional gets a player of its own, made when its file is on the phone and released when another devotional is
// loaded. A late report from the old player then has nowhere to go, and a player never holds a file it should not.
let player: AudioPlayer | null = null;
let listener: { remove: () => void } | null = null;
let track: PlaybackTrack | null = null;
// Bumped by load() of another devotional and by stop(). A step that was waiting (the file, the player) looks at it
// afterwards and drops its result when it is out of date.
let generation = 0;
// The file is in the player and the player has said so.
let ready = false;
// The person wants sound. It can be true while the player is not ready yet.
let wantsPlaying = false;
// player.play() was called and the player was not paused since. A report that says "not playing" is something else
// pausing the player (a call, the lock screen, a headset) only while this is true.
let playRequested = false;
// Seeks on their way. The position the player reports can still be the old one until they are done.
let seeking = 0;
// Playing from the end starts again from 0.
let restartFromStart = false;
// The file was fetched again once because the player could not open it. A second failure is the end of it.
let refetched = false;
// What a player being opened calls when it has loaded its file, failed, or taken too long.
let settleLoad: ((result: "loaded" | "error" | "timeout") => void) | null = null;

// A report this close to the end of the devotional, with the player not playing, is the end: the report that says
// "finished" is lost when the app was suspended (the lock screen can play a devotional out while JS sleeps).
const END_TOLERANCE_MS = 300;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function update(patch: Partial<PlayerState>) {
  const state = usePlayerStore.getState();
  const changed = (Object.keys(patch) as (keyof PlayerState)[]).some((key) => state[key] !== patch[key]);
  if (changed) usePlayerStore.setState(patch);
}

// Lets go of the player and everything that belongs to it. Never throws.
function releasePlayer() {
  const old = player;
  const oldListener = listener;
  const waiter = settleLoad;
  player = null;
  listener = null;
  settleLoad = null;
  ready = false;
  playRequested = false;
  seeking = 0;
  try {
    oldListener?.remove();
  } catch {
    // Already removed.
  }
  waiter?.("error");
  if (old === null) return;
  clearLockScreen(old);
  try {
    old.pause();
  } catch {
    // Nothing to pause.
  }
  try {
    old.release();
  } catch {
    // Already released.
  }
}

// The audio cannot be had (or stopped working): the devotional stays loaded, paused, with the reason.
function fail(gen: number, error: PlaybackError) {
  if (gen !== generation) return;
  wantsPlaying = false;
  playRequested = false;
  update({ status: "paused", isBuffering: false, error });
}

function failPlayback() {
  try {
    player?.pause();
  } catch {
    // Nothing to pause.
  }
  fail(generation, "unavailable");
}

// Moves the player to a position. The store already shows it: this only keeps the player (and with it the lock screen)
// in step, and picks the player's own position up again when the move is done.
function moveTo(ms: number): Promise<void> {
  const current = player;
  if (current === null) return Promise.resolve();
  seeking += 1;
  return current
    .seekTo(ms / 1000)
    .catch(() => undefined)
    .then(() => {
      seeking = Math.max(0, seeking - 1);
      const { status, durationMs } = usePlayerStore.getState();
      if (seeking === 0 && player === current && status !== "ended") {
        update({ positionMs: clamp(current.currentTime * 1000, 0, durationMs) });
      }
    });
}

// The devotional played out. It stays shown as finished, with the position at the end, but the player is rewound and paused
// behind it: a player left at its end plays nothing when the lock screen presses Play.
function finish() {
  wantsPlaying = false;
  playRequested = false;
  update({ positionMs: usePlayerStore.getState().durationMs, status: "ended", isBuffering: false });
  try {
    player?.pause();
  } catch {
    // Nothing to pause.
  }
  void moveTo(0);
}

// One report from the player, turned into what the screens show. The ways a player says it is not playing differ: iOS says
// "waiting" while it gets data for a play that was asked for, Android keeps saying "playing" while it buffers (and keeps
// saying so after a pause during the buffering, until the buffering ends), and both say plain "paused" when something else
// paused it. So a "waiting" report counts only while the person wants sound, which the app's own pause clears at once. (The
// report's own isBuffering is not used: on iOS it is also true for a paused player whose buffer is empty.)
function reconcile(status: AudioStatus) {
  const { durationMs, status: shown } = usePlayerStore.getState();
  if (status.didJustFinish) {
    finish();
    return;
  }
  const waiting =
    status.timeControlStatus === "waitingToPlayAtSpecifiedRate" || status.playbackState === "buffering";
  const patch: Partial<PlayerState> = {};
  if (status.playing && !waiting) {
    // Sound is coming out, whoever asked for it: the lock screen and a headset can start it too.
    wantsPlaying = true;
    playRequested = true;
    patch.status = "playing";
    patch.isBuffering = false;
  } else if (waiting && wantsPlaying) {
    patch.status = "playing";
    patch.isBuffering = true;
  } else if (playRequested) {
    if (durationMs > 0 && status.currentTime * 1000 >= durationMs - END_TOLERANCE_MS) {
      finish();
      return;
    }
    // Asked to play, and now neither playing nor waiting: something else paused it.
    wantsPlaying = false;
    playRequested = false;
    patch.status = "paused";
    patch.isBuffering = false;
  }
  // The position follows the player, except behind a finished devotional and while a seek is on its way.
  if (seeking === 0 && (patch.status ?? shown) !== "ended") {
    patch.positionMs = clamp(status.currentTime * 1000, 0, durationMs);
  }
  update(patch);
}

function onStatus(status: AudioStatus) {
  if (status.error) {
    settleLoad?.("error");
    if (ready) failPlayback();
    return;
  }
  if (status.isLoaded) settleLoad?.("loaded");
  if (ready) reconcile(status);
}

// Makes the player for a file on the phone and waits until it has loaded it. Reports of the player begin the moment it
// exists, so the listener is attached before anything is asked of it, and the state it is in at that moment is read
// directly (a report sent before the listener was there is not repeated).
function openPlayer(uri: string): Promise<"loaded" | "error" | "timeout"> {
  let created: AudioPlayer;
  try {
    created = createAudioPlayer(
      { uri },
      {
        updateInterval: PLAYER_UPDATE_MS,
        keepAudioSessionActive: KEEP_SESSION_ACTIVE,
        // AirPlay still works through the audio session. What it must not do is take the file away from the app.
        allowsExternalPlayback: false,
      },
    );
  } catch {
    return Promise.resolve("error");
  }
  player = created;
  // A report from a player that was let go of since (a retry makes a new one within the same load) is not this one's.
  listener = created.addListener("playbackStatusUpdate", (status) => {
    if (player === created) onStatus(status);
  });
  if (created.isLoaded) return Promise.resolve("loaded");
  return new Promise((resolve) => {
    const timer = setTimeout(() => finishLoad("timeout"), LOAD_TIMEOUT_MS);
    const finishLoad = (result: "loaded" | "error" | "timeout") => {
      clearTimeout(timer);
      if (settleLoad === finishLoad) settleLoad = null;
      resolve(result);
    };
    settleLoad = finishLoad;
  });
}

async function startPlayback(gen: number) {
  const current = player;
  if (current === null || !ready || gen !== generation) return;
  try {
    if (restartFromStart) {
      restartFromStart = false;
      // Not "asked to play" yet: the report that ends this move says "not playing", and that is not a pause by someone else.
      await moveTo(0);
      // Paused, or another devotional loaded, while the player was moving.
      if (gen !== generation || player !== current || !wantsPlaying) return;
    }
    playRequested = true;
    current.play();
  } catch {
    failPlayback();
  }
}

// Everything between a load and a devotional that can play: the session, the file, the player, the lock screen.
async function prepare(gen: number): Promise<void> {
  const current = track;
  if (current === null || gen !== generation) return;
  update({ error: null });
  await setSessionMode("playback");
  if (gen !== generation) return;
  const file = await getDevotionalFile(current.entryId, current.audioPath);
  if (gen !== generation) return;
  if (!file.ok) {
    fail(gen, file.code === "NETWORK" ? "offline" : "unavailable");
    return;
  }
  const opened = await openPlayer(file.uri);
  if (gen !== generation) return;
  const opening = player;
  if (opened !== "loaded" || opening === null) {
    // A file the player cannot open is fetched again once: a damaged copy is the likely cause.
    if (!refetched) {
      refetched = true;
      releasePlayer();
      forgetDevotionalFile(current.entryId);
      await prepare(gen);
      return;
    }
    releasePlayer();
    fail(gen, "unavailable");
    return;
  }
  ready = true;
  const { rate, positionMs, status } = usePlayerStore.getState();
  try {
    opening.setPlaybackRate(rate, "high");
  } catch {
    // The speed is applied again at the next change.
  }
  activateLockScreen(opening, current);
  // A position chosen before the sound was ready (the scrubber was dragged, or the app was told where to start).
  if (positionMs > 0 && status !== "ended") await moveTo(positionMs);
  if (gen !== generation || player !== opening) return;
  if (wantsPlaying) await startPlayback(gen);
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  entryId: null,
  title: "",
  subtitle: "",
  durationMs: 0,
  positionMs: 0,
  status: "idle",
  isBuffering: false,
  error: null,
  rate: 1,
  ambientSound: "off",
  ambientVolume: 0.5,

  // The same entry does nothing, so reopening a reflection never resets its position. Another entry stops the one that
  // is playing and starts at 0, paused, while its audio is made ready in the background.
  load: (next, ambient) => {
    if (next.entryId === get().entryId) return;
    generation += 1;
    releasePlayer();
    track = next;
    wantsPlaying = false;
    restartFromStart = false;
    refetched = false;
    set({
      entryId: next.entryId,
      title: next.title,
      subtitle: next.subtitle,
      durationMs: next.durationMs,
      positionMs: 0,
      status: "paused",
      isBuffering: false,
      error: null,
    });
    if (!ambientSeeded) {
      ambientSeeded = true;
      set({ ambientSound: ambient.ambientSound, ambientVolume: ambient.ambientVolume });
    }
    void prepare(generation);
  },

  play: () => {
    const { entryId, status, error } = get();
    if (entryId === null || status === "playing") return;
    wantsPlaying = true;
    if (status === "ended") {
      restartFromStart = true;
      set({ positionMs: 0 });
    }
    // The sound has not started yet: the first report from the player says when it has.
    set({ status: "playing", isBuffering: true });
    if (error !== null) {
      // The audio could not be had last time: fetch it again, from the start.
      releasePlayer();
      refetched = false;
      forgetDevotionalFile(entryId);
      void prepare(generation);
      return;
    }
    if (ready) void startPlayback(generation);
    // Otherwise prepare() starts it when the file is ready.
  },

  pause: () => {
    wantsPlaying = false;
    if (get().status !== "playing") return;
    playRequested = false;
    const current = player;
    try {
      current?.pause();
    } catch {
      // Nothing to pause.
    }
    set({ status: "paused", isBuffering: false });
    if (current !== null && ready && seeking === 0) {
      update({ positionMs: clamp(current.currentTime * 1000, 0, get().durationMs) });
    }
  },

  toggle: () => {
    if (get().status === "playing") get().pause();
    else get().play();
  },

  // Reaching the end ends the track, seeking back from the end pauses it, and seeking while playing keeps playing.
  seekTo: (ms) => {
    const { entryId, durationMs, status } = get();
    if (entryId === null || !Number.isFinite(ms)) return;
    const positionMs = clamp(ms, 0, durationMs);
    restartFromStart = false;
    if (positionMs >= durationMs) {
      wantsPlaying = false;
      playRequested = false;
      set({ positionMs, status: "ended", isBuffering: false });
      try {
        player?.pause();
      } catch {
        // Nothing to pause.
      }
      void moveTo(0);
      return;
    }
    set({ positionMs, status: status === "ended" ? "paused" : status });
    if (ready) void moveTo(positionMs);
  },

  skipBy: (deltaMs) => get().seekTo(get().positionMs + deltaMs),

  setRate: (rate) => {
    set({ rate });
    try {
      // The voice keeps its pitch at every speed.
      player?.setPlaybackRate(rate, "high");
    } catch {
      // Applied again with the next player.
    }
  },

  // TODO(27): persist the ambient choice to users_profile
  setAmbient: (sound) => set({ ambientSound: sound }),

  // TODO(27): persist the ambient choice to users_profile
  setAmbientVolume: (volume) => set({ ambientVolume: clamp(volume, 0, 1) }),

  stop: () => {
    generation += 1;
    wantsPlaying = false;
    restartFromStart = false;
    refetched = false;
    track = null;
    releasePlayer();
    ambientSeeded = false;
    set({
      entryId: null,
      title: "",
      subtitle: "",
      durationMs: 0,
      positionMs: 0,
      status: "idle",
      isBuffering: false,
      error: null,
      rate: 1,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
  },

  reseedAmbient: () => {
    ambientSeeded = false;
  },
}));

// Back in the foreground: the lock screen, a headset or a call may have changed the player while JS was asleep, and no report
// is sent for what happened then.
AppState.addEventListener("change", (state) => {
  if (state !== "active" || player === null || !ready) return;
  try {
    reconcile(player.currentStatus);
  } catch {
    // Released.
  }
});
```

---

## 3. The checks the review created (`supabase/tests/playback/`)

Two files, already in the repo: `world.cjs` (the fakes) and `run.cjs` (**127 checks**). They run the app's real TypeScript (the player store, the audio session, the devotional files, the lock screen, the recorder's share of the session, `getPlaybackTrack` and the sign-out cleanup) against:

- a fake `AudioPlayer` with two profiles, the iPhone's and Android's, which say "waiting for data" in different words, keep different wishes while they buffer, and report a pause at different moments (`flags.reportLagMs` makes a report arrive a moment after it was made, as a native event does). It can start and stop sound, buffer in the middle of a sound or while paused, finish a file, fail, be paused or started from outside (a call, the lock screen, a headset), skip from the lock screen, land a little away from a seek, and sleep (JS asleep: reports are sent and lost);
- expo-file-system's `File`, `Directory` and `Paths` (downloads with delays and failures by status, `AbortSignal`, a half-written file), Storage's `createSignedUrl` (and its `StorageApiError`s) and expo-asset;
- a virtual clock, so a download, a wait for data or a whole devotional takes no real time. Each check also has a real 20-second limit, so a promise that never settles fails by name instead of leaving Node to exit quietly.

Every check ends by asserting that the development log holds no link, path, id or title. Do not edit the files to make a check pass; if one is wrong, say so in the report.

```
node --no-warnings supabase/tests/playback/run.cjs                          # about 10 seconds
ONLY="store(android)" node --no-warnings supabase/tests/playback/run.cjs      # one group while you work
FAILFAST=1 TIMINGS=1 node --no-warnings supabase/tests/playback/run.cjs       # stop at the first failure; milliseconds per check
GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/playback/run.cjs
```

The groups are `session:` (4), `file:` (13), `lock:` (6), `store(ios):` (46) and `store(android):` (46: the same 46 checks, each against that platform's reports), `store:` (3), `track:` (1), `recorder:` (4) and `contract:` (4: the source text says that only `audioSession.ts` calls `setAudioModeAsync`, that only the store makes a player and no screen or component imports `expo-audio`, that the player files never log, and that the mock and track-player are gone).

### 3.1 The older checks (already edited in the repo)

Three of the older checks describe the code before this step. The review has edited them, so they show as modified in `git status`, and they are red until the code is in (section 0, point 3). Do not edit them again. What changed, with the numbers before and after:

- `supabase/tests/recording/run.cjs` (63 passed, 5 failed before; 68 passed after). The fake world has a `@/store/playerStore` whose `pause` is counted (the recorder now imports the store, and the real one cannot load in plain Node: it pulls in expo-file-system). Two constants, `PLAYBACK_MODE` and `RECORDING_MODE`, hold the six fields; the five recorder checks expect them where they expected `{ allowsRecording: true, playsInSilentMode: true }` and `{ allowsRecording: false }`, and the start check expects one `pause` of the player.
- `supabase/tests/offline/run.cjs` (1 of 44 failed before; 44 after). The sign-out check fakes `@/services/devotionalAudio` (expo-file-system cannot load in plain Node) and asserts that the player stops before the devotional files go.
- `supabase/tests/profile-sync/run.cjs` (87 passed, 1 failed before; 88 after). The same fake in both environments, with a counter (`devotionalsDeleted`) asserted after sign-out (1) and after account deletion (2).

`supabase/tests/journal-data/` and `supabase/tests/process-entry/parity.cjs` are not touched. `git diff supabase/tests/recording/run.cjs supabase/tests/offline/run.cjs supabase/tests/profile-sync/run.cjs` shows all of it (about 30 added lines).

### 3.2 The breakages

127 deliberate breakages of the code (made by a runner kept outside the repo, because it edits a copy of the files): each makes one change in a scratch copy of the proven files, runs the checks, and must be stopped by a check with a name. **All 127 were caught, none survived, none crashed a run.** By file: `audioSession.ts` 8 (a partial mode is sent, the silent switch not honoured, background off, no microphone in the recording mode, a failure thrown or reported as success, ...), `devotionalAudio.ts` 26 (any entry id is a path, the cache in the documents folder, a link that lives an hour, an empty file counted as audio, a download straight into place, a download that cannot be stopped, one that ends after sign-out and is kept, a failed one that leaves its part, no pruning, 13 kept, the oldest kept, a missing object not recognised, ...), `lockScreen.ts` 7 (skip buttons of ten seconds, no back button, the dev server's address as the picture, the picture looked up again, never arriving, a failure thrown, clearing that does nothing), `playerStore.ts` 78 (a pause that is not held, a wait shown for a play nobody asked for, a pause from outside that is not followed, a late report from a released player taken, a finished player not rewound, an error ignored, a stale load not dropped, the background pausing the sound, ...), `recorder.ts` 5, `account.ts` 2 and `selectors.ts` 1. The screens (mini player, Now Playing, the Journal card and its feed) are not in this list: no check renders a screen. They are proven by the typecheck, the lint, the bundle, the breakage smoke test of section 7 and the phone walk-through.

---

## 4. AGENTS.md updates

**Already made in the review (do not repeat):** the Instructional Memory line about the iOS account (lock-screen and background playback of a devotional is no longer on its "not verified until step 35" list); the Tech Stack (the `react-native-track-player` bullet is gone, the `expo-audio` bullet covers playback, the sentence about the development build says what is true); the vendor note on `enableBackgroundPlayback` (step 26 decided `true`); two new vendor notes, "expo-audio 58 playback" and "expo-file-system 58 download"; the Backend notes (a 300-second link used once); the sign-out sentence; the Reflection and Now Playing specifications and "Leaving Now Playing or Reflection does not pause"; the Journal card's play pill sentence; the Audio Rules block "Playback (expo-audio, step 26)" in place of the track-player block, the spoken-devotional bullets and the ambient bullet; the architecture tree (`constants/audio.ts`, `audioSession.ts`, `devotionalAudio.ts`, `lockScreen.ts`, `playerStore.ts`, `assets/images`, `tests/playback`); and, in "Linting and Validation", the playback command with its switches and the fakes the profile-sync note lists.

**You make these, once the code is in and the checks pass.** AGENTS.md is CRLF: use the same script as section 2, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them.

**4.1 Audio Rules and vendor notes.** Read "Playback (expo-audio, step 26)", "expo-audio 58 playback" and "expo-file-system 58 download" against what you built and correct any number or name that differs (nothing should). Change "none of it was run on a phone in the review" in the first of them to say which parts the walk-through showed.

**4.2 Architecture tree.** In the `components/` entry add that `MiniPlayerCard` reads `isBuffering` and `error` (the spinner and the calm line) and that `JournalCard` takes `onPlay` (the pill of a ready card); in the `hooks/` entry nothing changes (`usePlayback` returns the whole store as before). The `127` of the `playback/` entry must equal what your run prints.

**4.3 Release gate.** The count that `grep -rnE "TEMP\(|TODO: real" src` prints changes to 13 (10 `TEMP(` and 3 `TODO: real`; it was 15 after step 25): both `TEMP(26)` lines of `playerStore.ts` went, and so did the three `TODO(26)` lines, which are not gate lines. Write the number you get, in the same paragraph, and say which markers stay (four `TEMP(29)`, four `TEMP(30)`, two `TEMP(31)`).

**4.4 Build Status & Decisions Log: a "Step 26 — Devotional playback" entry**, in the form of the steps before it: the decisions (this prompt's list and any you struck), the files added and changed, the differences from this prompt, the measured results (the checks, the bundles, the native config diff, the breakages), what the phone walk-through showed (B0 to B14, one line each, in your words and the user's), what was not verified, and the open items and markers left (`TODO(27)` in `playerStore.ts`).

---

## 5. Rules

- No new dependency, no `any`, no new token, no layout change beyond: the spinner in the play button, the calm line, the footer line of Now Playing and the play pill of a Journal card.
- Never log a link, a path, a title, an id or a transcript; never log anything about a crisis entry. The one development line in these files names a session mode that could not be set.
- `setAudioModeAsync` is called only in `src/services/audioSession.ts`; `createAudioPlayer` only in `src/store/playerStore.ts`; the lock-screen calls only in `src/services/lockScreen.ts`; no screen or component imports `expo-audio`. Every call into a native player is inside a `try`/`catch` (a released player throws on every call).
- A devotional is loaded only when the person acts on a player, and never plays by itself except from the pill of a Journal card the person tapped. A crisis entry never reaches a player (`getPlaybackTrack` answers null for it).
- The download link is made at the moment of the download, used once and never kept, logged or shown.
- Ambient sound is step 27: `setAmbient` and `setAmbientVolume` change the store and nothing audible.
- Do not edit `supabase/functions/`, `supabase/migrations/`, `package.json` or `package-lock.json`. `app.json` changes by exactly one line. Do not regenerate or replace `assets/images/player-artwork.png`.
- Keep each file's line endings (the list is in section 2; the files in section 1 are LF).

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **27 (ambient sound).** The ambient bed is a second `expo-audio` player, and `setAmbient` and `setAmbientVolume` still carry their `TODO(27)`. Prompt 27 says "drive this from the step 26 status listener": the listener is private to `playerStore.ts`, so subscribe to the store instead (`usePlayerStore.subscribe`) and follow `status`, treating `status === "playing"` with `isBuffering` true as "not yet" (the voice has not started), `paused` and `idle` as pause, and `ended` as pause and rewind. Because every call into the audio session goes through `audioSession.ts`, the ambient player must not call `setAudioModeAsync`, and it must never call `setActiveForLockScreen` (only one player can be the lock-screen player, and it is the devotional's). A take already pauses the devotional through the store, so an ambient bed that follows the store pauses with it. Prompt 27 names `src/screens/NowPlayingScreen.tsx` and `src/screens/ProfileScreen.tsx`: they are `src/screens/journal/NowPlayingScreen.tsx` and `src/screens/profile/ProfileScreen.tsx`.
- **28 (notifications).** Prompt 28 says to "close the step 26 `// TODO(28)`": step 26 leaves none. A notification tap opens Reflection and never starts playback, which is already how the app works.
- **31 (account).** Sign-out and account deletion already delete the devotionals downloaded to the phone (`deleteAllDevotionalAudio`, called by `signOutCleanup`). Deleting the account must also remove `{userId}/devotionals/` in Storage, and the files there are `.wav` (prompt 31 says `.mp3`).
- **32 (tone).** Step 32 may measure the length of a spoken devotional against "about 60 seconds" (two minutes today). It does not change the player.
- **34 (analytics).** Prompt 34 lists `devotional_played` with `rate: 0.75 | 1 | 1.25 | 1.5`: the app's rates are `PlaybackRate`, 0.8, 1 and 1.2. The event belongs where the person presses play (the first play of a loaded devotional), never carries an id, a title or a path, and does not exist for a crisis entry (which cannot be played). No `TODO(34)` was added in this step.
- **35 (the iOS account).** Prompt 35 lists "track-player lock-screen playback" among the things logged as "not verified on iOS": playback and the lock screen are checked in Expo Go by this step. What a development build can still change is how the background audio mode behaves outside Expo Go (the `audio` background mode comes from `app.json`'s `enableBackgroundPlayback`, introspected in the review) and CarPlay.
- **Fast Refresh.** Editing `playerStore.ts` while a devotional plays leaves the old native player playing under a new store. After any edit of it, reload the app.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. Red first (section 0.3), then apply sections 1 and 2.
2. `npm run typecheck` and `npm run lint` exit 0. Read the whole output; nothing is disabled with a comment.
3. `node --no-warnings supabase/tests/playback/run.cjs` ends `127 checks passed`. Then the older ones: recording `68 passed, 0 failed`, offline `44 of 44 passed`, profile-sync `88 passed, 0 failed` (about 35 seconds), journal-data `86 checks passed` (about a minute) and parity `7 of 7`. Put the last line of each in the report.
4. `npx expo install --check` says "Dependencies are up to date" and `npx expo-doctor` passes. `git diff --stat -- package.json package-lock.json` prints nothing, and `git diff -- app.json` shows one changed line. Read the native configuration before and after that line with `npx expo config --type introspect --json`: after it, `ios.infoPlist.UIBackgroundModes` is `["audio"]`, the Android permissions gain `android.permission.FOREGROUND_SERVICE` and `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`, the manifest gains the service `expo.modules.audio.service.AudioControlsService` (`foregroundServiceType` `mediaPlayback`, not exported), and nothing else differs. (The review's run showed exactly that.)
5. Bundle both platforms, one at a time, to a folder outside the repo (host memory, AGENTS.md): `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform android --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then `ios`. Both exit 0 (about 10.8 MB each). In the unminified bundles `Audio needs a connection.`, `We couldn’t load the audio. Tap play to try again.`, `Play devotional`, `waitingToPlayAtSpecifiedRate`, `keepAudioSessionActive` and `player-artwork` each appear (the review's iOS bundle is 10.80 MB and the Android one 10.77 MB), and `TEMP(26)`, `track-player` and `devFooter` do not. (`expo-av` appears once, in a comment inside expo-audio's own source: nothing imports it.) A release bundle has no developer panel, and this step adds nothing to it. Do not export while the emulator and Metro are both running.
6. Greps, each with its result named:
   - `grep -rn "TEMP(26)\|TODO(26)" src` finds nothing;
   - `grep -rn "setAudioModeAsync" src` finds only `src/services/audioSession.ts`;
   - `grep -rn "createAudioPlayer" src` finds only `src/store/playerStore.ts`;
   - `grep -rn "from \"expo-audio\"" src` finds only `src/constants/audio.ts` (step 23), `src/services/recorder.ts`, `src/services/audioSession.ts`, `src/services/lockScreen.ts` (types only) and `src/store/playerStore.ts`;
   - `grep -rn "track-player\|trackPlayer" src package.json app.json` finds nothing;
   - `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 13 (the number you write into AGENTS.md);
   - `grep -rn "console\." src/store/playerStore.ts src/services/audioSession.ts src/services/devotionalAudio.ts src/services/lockScreen.ts` finds only the `__DEV__`-guarded warning in `audioSession.ts`.
7. Line endings: the CRLF files of section 2 are still CRLF (`tr -cd '\r' < file | wc -c` equals the line count) and `git diff --stat` shows only real changes, no whole-file rewrites. The new files are LF.
8. **Breakage smoke test** (the review's run is in section 3.2; prove the checks are wired to *your* files). One at a time, make the break, run the group named, see that check fail by name, then restore the line (`git diff` shows nothing for it, and nothing for the new files that was not there before):
   - in `audioSession.ts`, replace `await setAudioModeAsync(MODES[mode]);` by `await setAudioModeAsync({ allowsRecording: MODES[mode].allowsRecording });` (`ONLY="session:"`);
   - in `devotionalAudio.ts`, replace `createSignedUrl(path, DEVOTIONAL_LINK_SECONDS)` by `createSignedUrl(path, 3600)` (`ONLY="file:"`);
   - in `devotionalAudio.ts`, replace `{ idempotent: true, signal }` by `{ idempotent: true }` (`ONLY="file:"`);
   - in `devotionalAudio.ts`, replace the entry id pattern `/^[A-Za-z0-9_-]{1,80}$/` by `/^.*$/` (`ONLY="file:"`);
   - in `lockScreen.ts`, replace `seekForwardIntervalSeconds: SKIP_MS / 1000,` by `seekForwardIntervalSeconds: 10,` (`ONLY="lock:"`);
   - in `lockScreen.ts`, delete the line `if (artworkUrl !== null) return;` (`ONLY="lock:"`);
   - in `playerStore.ts`, replace `} else if (waiting && wantsPlaying) {` by `} else if (waiting) {` (`ONLY="store("`);
   - in `playerStore.ts`, replace `if (player === created) onStatus(status);` by `onStatus(status);` (`ONLY="store("`);
   - in `playerStore.ts`, replace `if (ready) failPlayback();` by `void ready;` (`ONLY="store("`);
   - in `recorder.ts`, delete the line `usePlayerStore.getState().pause();` (`ONLY="recorder:"`);
   - in `selectors.ts`, delete the line `audioPath,` from `getPlaybackTrack` (`ONLY="track:"`);
   - in `account.ts`, delete the line `await deleteAllDevotionalAudio();` (run the offline and the profile-sync checks).
9. With the user's yes only (see C): boot the emulator as AGENTS.md says (Metro first, then the emulator; never against the real project without asking), with the Expo Go 58 APK installed, and play a devotional once. Put every override back and shut the emulator down.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", B0 to B14. The implementer asks for the results one by one and writes them into the log entry. B1 to B3 prove the real round trip (download, sound, store), B4 and B5 the lock screen, B6 to B9 the audio session and the interruptions, B10 the offline file, B11 and B12 the switching and the end, B13 the sign-out.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; Android on a device or an emulator; the native players themselves (what AVPlayer and ExoPlayer really report in a call, at the end of a file, while buffering: the checks use fakes shaped from the sources); what the lock screen draws and the numbered skip icons on Android; the sound itself and how it plays on a Bluetooth speaker or in a car; VoiceOver and TalkBack on the spinner, the calm line and the pill's action; how a first play feels on a slow connection; and whether `keepAudioSessionActive` keeps the iOS card as the sources say (B5 is where it is seen).

---

## 8. Report

Say, in this order and briefly: the files created, changed and replaced (one line each); that no package, migration, function or secret changed and that `app.json` changed by one line (and the native configuration diff); the `TEMP(26)` and `TODO(26)` list with how each was closed; the checks (typecheck, lint, the 127, the five older ones, doctor, both bundles and what was found in them, the greps with their results, the breakages and which check named each); the phone walk-through results B0 to B14 (and any you did not get); the Android run if you said yes; the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; what was not verified; the known limits and the question about "never auto-resume"; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
