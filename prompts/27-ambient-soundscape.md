# 27-ambient-soundscape.md

Read AGENTS.md first and follow it strictly.

Add the ambient sound bed under a devotional: a second `expo-audio` player loops a bundled sound (Soft Rain, Gentle Piano or Morning Birds) under the voice, mixed on the phone, fading in when the voice is heard and out when it pauses or ends. The step 12 chips and volume on Now Playing play it and save the choice as the user's default; Profile gets a short Preview of the default. The spoken devotional on the server (a WAV since step 22) stays voice only. Screens keep their look, except for the Preview button and its line on Profile.

**The code is written and proven.** The old text of this step was written before steps 12 to 26 were built: it names files in the wrong folders, a `constants/ambient.ts` that AGENTS.md plans as `constants/sounds.ts`, an "MP3" that is a WAV, a "switch" and a helper line that do not exist, a status listener that is private to the store, and no sound files (none exist anywhere). The review checked it against the installed packages and the repo (below), so this prompt carries the finished files word for word (sections 1 and 2), the script that makes the loops (section 0.5) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint (with the React Compiler rules) clean, **64 Node checks** (`supabase/tests/ambient/`) pass with the app's real player store, ambient player and recorder running against the step 26 fakes of expo-audio's iOS and Android players, and **56 deliberate breakages** of the code were each caught by a named check. The older checks pass at their numbers (playback 133, recording 68, offline 44, profile-sync 88, journal-data 86, parity 7 of 7) once the small edits the review already made to two of them are counted (section 3.1), and both platforms bundle with three test loops (synthetic sounds made with ffmpeg for the proof, never committed). What the review could not do, because it has no phone and no ears on it: hear the loops, the mix and the fades. That part is yours, in "What you do yourself".

**One thing must come from you before the step can be built: the three sounds** (section A below, step by step). The implementer never downloads, generates or substitutes a sound. Everything else needs nothing new: no package, no migration, no policy, no Edge Function, no deploy, no secret, and no native configuration (step 26 already turned on background playback, which the bed rides on).

Sources, read in the review on 2026-10-27 (the installed packages, not web pages, so they are the versions this app runs):

- `expo-audio` 58.0.10: the TypeScript, the Swift and the Kotlin sources and `CHANGELOG.md` (`loop`, `volume`, `replace`, how two players share the iOS audio session and Android's audio focus, the media session every Android player has, interruptions)
- media3 1.9.1's `MediaSessionImpl` and `MediaSessionLegacyStub` (a player's session is active from the moment it is made), React Native 0.88's `JavaTimerManager.kt` and `RCTTiming.mm` (JS timers in the background), Metro's asset types (`.m4a` is one)
- the spoken devotionals' loudness, measured with ffmpeg's EBU R128 meter on three real WAV files (-21.8 to -22.0 LUFS)
- Freesound's FAQ and Pixabay's license summary (the two licenses section A allows)
- the code of steps 12 to 26 (`src/`), `AGENTS.md`, the designs (`prompt_material/05-reflection.html` and `07-profile.html`: no preview control and no helper line under the chips), and prompts 31 and 34 (they read what this step builds)

---

## What the review found (these changed the prompt)

1. **Wrong paths and names.** `src/screens/NowPlayingScreen.tsx` is `src/screens/journal/NowPlayingScreen.tsx` and `src/screens/ProfileScreen.tsx` is `src/screens/profile/ProfileScreen.tsx`; the Profile chips are in `src/components/profile/AmbientPanel.tsx`. AGENTS.md's Image Rule plans the ambient files in `src/constants/sounds.ts`, so that is the file, not `constants/ambient.ts`. The server's devotional is a WAV (step 22), not an MP3.
2. **"None" and "Off".** The old text calls the off chip "None" and makes a new `AMBIENT_LABELS` map. `copy.ambient.labels` is the one map since step 12 and the chip reads "Off" everywhere: nothing new.
3. **No switch, no helper line.** Now Playing's ambient card has chips and a volume track, no switch, and the line "Soft sound beneath your devotional." exists in neither the code nor the design (`#view-nowplaying` in `prompt_material/05-reflection.html`). Nothing is added there.
4. **No sound files exist.** There is no `assets/audio/` at all. The old text asks the implementer to stop and ask, and forbids re-encoding. New: you choose and download three sounds under a license that allows a sold app and needs no credit (section A), and the implementer turns each into a seamless loop with one script (section 0.5) that the review proved on synthetic sounds: 75 seconds of whole AAC frames, the first 3 seconds cross-faded into the end so the last sample runs into the first, one constant gain to the spoken devotional's own loudness, AAC-LC 128 kbps. It prints what it measured and refuses a loop with a jump at its seam. You listen to them in the walk-through. A license that needs a credit would need a credits line in the app, so the step does not use one.
5. **The step 26 listener is private**, so the bed follows the player store (`usePlayerStore.subscribe`), as the step 26 notes say. It comes in when the voice is heard, not while the file is downloaded or opened (the store says `playing` with `isBuffering` then), stays while the voice waits for data again, and goes when the devotional pauses, ends or another one is loaded. The lock screen, a headset and a call move it too, because they move the store.
6. **A fade would leak into a recording.** A take starts a few hundred milliseconds after the store pauses the devotional, so an 800 ms fade-out would still be playing from the speaker when the microphone opens. `startRecording` stops the bed at once.
7. **Two players share one audio session, safely.** On iOS a player made with `keepAudioSessionActive: false` cannot end the session while the devotional's player (made with `true`, step 26) holds it, so the bed never drops the lock-screen card; an interruption pauses and resumes every player together. On Android audio focus is one request for all players. The bed never touches the lock screen, the audio session or the speed. (AGENTS.md now has the vendor note "expo-audio 58: a second player, the ambient bed".)
8. **A headset button can land on the bed's player (Android).** Every expo-audio player on Android has a media session of its own, active from the moment it is made, and Android sends a headset or car button to the session that started playing last: the bed's. So a stop or a start of the bed that the app did not ask for is passed on to the devotional (pause or play), and the two never go apart. A report sent just before the app's own call is not counted (1.5 seconds), a start after Profile's preview never starts a devotional, and a start nothing wants is paused again. iOS sends its remote commands only to the lock-screen player, so there this only meets interruptions, which move both players anyway.
9. **JS timers stop away from the foreground on Android** (React Native's `JavaTimerManager`) and slow down on iOS, so a fade made of timers could be left half done there. Away from the foreground the bed jumps instead of fading, a fade that is running ends at once when the app leaves, and a preview stops.
10. **Saving the choice.** The old text adds a debounce to the store and saves from its actions. The store stays a player and imports no repository: Now Playing saves a chip when it is pressed and the volume when the finger lifts, through `updateProfile` (step 18: kept on the phone at once and sent by the profile sync, offline too). A failed save changes nothing on the player; the next change saves again. Profile still changes only the default and never what is playing (step 15).
11. **The end.** The old text rewinds the bed to its start when a devotional ends. A loop has no beginning worth returning to; dropped (one call fewer into the player).
12. **The level.** `MAX_AMBIENT_GAIN` 0.35 with the volume squared (the old text's numbers), and the loops made at the voice's measured loudness (-22 LUFS): at 100% the bed is about 9 dB under the voice, at the default 50% about 21 dB under, which is soft. One number changes it if you want it louder.
13. **The old TODOs.** Four lines are closed (section 0.7): two `TODO(27)` in `playerStore.ts` (persist the ambient choice), one in `ProfileScreen.tsx` (a Preview button) and one in `account.ts` (stop the preview: the store's `stop()` does it). The `TODO(34)` for `ambient_changed` gets its Now Playing twin.
14. **Two older checks needed small edits, and they are already made** (section 3.1): the playback contract says two files may make a player now, and the recorder checks expect the bed to be stopped once when a take starts. The playback fakes learned `loop`, `volume` and `replace`.

---

## What you do yourself (read this first)

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set. Not touched by this step. |

Nothing to create in Supabase, Clerk, Google Cloud or RevenueCat, and nothing to deploy. The sounds are files inside the app: nothing is fetched to play them.

### A. Get the three sounds (do this before you say "implement")

The app needs three recordings, one for each chip: **Soft Rain**, **Gentle Piano** and **Morning Birds**. You choose them, because it is your app's sound, and you download them; the implementer then makes each into a seamless 75-second loop and checks it. It takes about 20 minutes.

**What each should sound like**

| sound | choose | avoid |
| --- | --- | --- |
| Soft Rain | steady, soft rain on a roof, a window or leaves, the same all the way through | thunder, wind gusts, traffic, voices, loud drips right at the microphone |
| Gentle Piano | slow, quiet, sparse piano that never builds up | drums, strings, singing, a famous tune, a big crescendo |
| Morning Birds | a calm dawn chorus, birds at a little distance | traffic, people, dogs, one loud bird right at the microphone |

Each needs **at least 80 seconds** of usable sound (2 to 5 minutes is ideal). Anything you would not want under a prayer is not usable.

**Licenses you can use.** The app is sold, so the license must allow commercial use, and this step adds no credits screen, so it must need no credit:

- **Creative Commons 0** (CC0) on Freesound: anyone may use it for anything, with no credit.
- **Pixabay Content License** on Pixabay: free use, no credit needed, changes allowed.
- **A recording you made yourself.**

Not usable: "Attribution" (CC BY), "Attribution NonCommercial", "NoDerivatives", "Sampling+", anything that says "personal use only", music from YouTube or a streaming app, and the output of an AI music generator.

**Freesound (CC0), step by step** (good for the rain and the birds)

1. Go to freesound.org and press **Join** to make a free account (Freesound needs one to download). Confirm the email it sends, then log in.
2. Search for `gentle rain` (later `dawn chorus`, or `ambient piano`).
3. In the search filters, set the license to **Creative Commons 0**.
4. Press the play button on a result to listen. Pick one that fits the table above.
5. Open its page. The license is shown beside the sound: it must say **Creative Commons 0**.
6. Press **Download**. Keep the file as it comes (WAV, FLAC, AIFF, MP3 and OGG are all fine).
7. Copy the page's address from the browser bar (it looks like `https://freesound.org/people/<name>/sounds/<number>/`).

**Pixabay (Pixabay Content License), step by step** (good for the piano)

1. Go to pixabay.com/music/ (or pixabay.com/sound-effects/ for rain and birds).
2. Search for `calm piano` or `ambient piano`, and listen with the play button.
3. Open the track. Under the download button it names the license: **Pixabay Content License**. Pixabay may ask you to sign in with a free account to download.
4. Press **Download** (MP3 is fine) and copy the page's address.

**Your own recording**: the Voice Memos app on the iPhone, in a quiet place, for 2 minutes or more. AirDrop does not reach a Windows PC, so press the recording's share button and email it to yourself (or save it to iCloud Drive or OneDrive), then download it on the PC.

**Where to put them.** Make a folder on the Desktop called `gracehush-sounds` (beside the `gracehush` project folder, not inside it) and save the three files there, renamed `soft-rain`, `gentle-piano` and `morning-birds` (keep each file's own extension, for example `soft-rain.wav` or `gentle-piano.mp3`). When you say "implement", paste the three page addresses into the message (for your own recording write "own recording").

What happens next: the implementer opens each page to read its license, makes the loops and puts them in the app, with a file that records each source, author and license (`assets/audio/ambient/LICENSES.md`, part of the public repo: for your own recording the author is written as "Gracehush", never a person's name). You hear them in B1. If one does not sound right where it loops, ask for another part of the same recording, or pick another sound: only that file changes.

### B. Phone walk-through (iPhone, Expo Go)

When the implementer has finished and its checks pass, it asks whether to start this walk-through (AGENTS.md, "Guided phone walk-through"). Before B0: **restart Metro** with `npx expo start -c` (new files and new sound assets), then force-quit and reopen Expo Go. Any account and plan will do, as long as it has a reflection with **real audio** (its purple card shows a length such as `0:00 / 1:53`). It costs nothing new: the loops are inside the app, and a devotional's first play downloads it once, as in step 26. **Keep Expo Go open and the screen on for the whole walk-through**: in Expo Go the iPhone stops all sound when the screen locks (step 26 found that Expo Go carries an older expo-audio; the lock screen with the bed waits for step 35), and the implementer can read nothing while the app is in the background. Headphones help with B1. Most of what this step changes is heard, not shown, so many checks end with a one-word answer from you.

**B0. Start**
- **Do:** sign in, open Profile and press "Supabase check (dev)".
- **Expect:** `data source: supabase` and `signed in: yes`.
- **Read:** the player store's `status` and `ambientSound`, and the data source (inspector).

**B1. Each sound, through its loop point**
- **Do:** open a reflection with audio, open the player, drag the ambient volume to 100%, choose **Soft Rain** and press play. Listen for 80 seconds from the moment you chose the sound (the loop starts again at 75). Then choose **Gentle Piano** and listen 80 seconds, then **Morning Birds**.
- **Expect:** each fades in once the voice starts, and passes its loop point with no click, gap or jump. (Heard: answer "smooth" or say what you heard, per sound.)
- **Read:** the store's `ambientSound` after each choice; ask the user.

**B2. How loud**
- **Do:** with a sound playing, drag the ambient volume to 100%, then to the left end, then to the middle.
- **Expect:** at 100% the voice is still clearly louder; at the left end the sound is gone and the voice plays on; at the middle it is soft. (Heard: say if 100% is too loud or the middle too quiet.)
- **Read:** the store's `ambientVolume` (1, 0, about 0.5); ask the user.

**B3. Fades**
- **Do:** press pause, then play; then drag the scrubber to the last few seconds and let it finish.
- **Expect:** the sound fades out in under a second on pause, comes back with the voice on play, and fades out when the devotional ends. (Heard.)
- **Read:** the store's `status` (`paused`, `playing`, `ended`); ask the user.

**B4. Seek and speed**
- **Do:** while both play, drag the scrubber, press the 15-second buttons, then the 0.8x and 1.2x chips.
- **Expect:** the sound does not jump, speed up, slow down or change pitch. (Heard.)
- **Read:** the store's `rate` (0.8, then 1.2) and `status` (`playing`); ask the user.

**B5. Another sound, and Off**
- **Do:** while both play, choose another sound; then choose **Off**.
- **Expect:** a short dip, then the new sound fades in; Off fades the sound out and the voice goes on. (Heard.)
- **Read:** the store's `ambientSound`, then `off`, with `status` still `playing`; ask the user.

**B6. Control Center**
- **Do:** choose a sound again. While both play, swipe down from the top-right corner (do not lock the phone) and press pause; then press play.
- **Expect:** the voice and the sound stop together and at once, and both come back on play. (Heard.)
- **Read:** the store's `status` (`paused`, then `playing`); ask the user.

**B7. Headphones**
- **Do:** with Bluetooth headphones playing both, switch the headphones off; after a few seconds, switch them on again.
- **Expect:** both pause, and nothing starts by itself when they come back.
- **Read:** the store's `status` stays `paused`; ask the user.

**B8. Recording**
- **Do:** while both play, go to Journal, tap the microphone, then the big round microphone. Discard the take.
- **Expect:** the voice and the sound stop at once: no rain still fading while the recording starts. (Heard.)
- **Read:** the store's `status` (`paused`) at the moment the recording started; ask the user.

**B9. Saved as the default**
- **Do:** open the player, choose **Gentle Piano** and drag the volume until the readout says about "Vol 70%" (note the number). Open Profile, then Ambient Soundscape. Then force-quit Expo Go, reopen it and open Profile again.
- **Expect:** the row says "Gentle Piano" with the number you noted (for example "Gentle Piano, 70% volume") before and after the restart, and the next devotional you open starts with Gentle Piano.
- **Read:** `getProfile()` (inspector, through the repository) answers `ambientSound` `gentle-piano` and an `ambientVolume` near 0.7; optional: in Supabase, Table Editor, `users_profile`, the user's row, `ambient_sound` is `gentle-piano` (ask the user to look).

**B10. Preview**
- **Do:** pause any devotional. On Profile, open Ambient Soundscape and press **Preview**; wait until it ends. Press Preview again, then another chip. Press Preview again, then switch to the Journal tab. Then play a devotional, come back to Profile and look at the button. Then choose **Off**.
- **Expect:** the sound fades in, plays about 8 seconds and fades out, and the button reads **Stop** while it plays; another chip plays the new sound for its own 8 seconds; switching tabs stops it; while a devotional plays the button is dimmed with "Pause your devotional to preview." under it; with Off there is no button.
- **Read:** `isPreviewing()` of `src/services/ambientPlayer.ts` (true while it plays, false after 8 seconds and after the tab change); a screenshot of the dimmed button; ask the user about the sound.

**B11. Sign out**
- **Do:** while both play, sign out (Profile, Sign Out, confirm).
- **Expect:** everything stops at once. (Heard.)
- **Read:** the store's `status` is `idle`, `ambientSound` is `off` and `isPreviewing()` is false; ask the user.

**B12. A timer (optional)**
- **Do:** set a 1-minute timer in the Clock app, play a devotional with a sound, and stop the timer when it rings.
- **Expect:** both pause together while it rings; whether they come back by themselves is the iPhone's own rule (AGENTS.md, Audio Rules, "Interruptions follow the platform"). Siri is not part of any check.
- **Read:** the store's `status`; ask the user what both did.

Not testable on the iPhone in Expo Go, and said so in the report: the lock screen and background playback with the bed (step 35), a headset or car button on Android (finding 8), and a call from a real person.

### C. Android (optional, and only with your yes)

The emulator holds your own signed-in account and its Expo Go cannot open this SDK 58 project until the newer APK is installed. The implementer asks first; if you say no, Android is reported "not verified".

### If something goes wrong: what it means

| what you hear or see | what it means |
| --- | --- |
| a click, a gap or a jump at the 75-second mark | that loop's seam: the implementer makes it again from another part of the recording (`--start`) or with a longer cross-fade (`--fade 5`); if it persists, pick another sound |
| the sound is too loud at 100%, or too quiet at 50% | `MAX_AMBIENT_GAIN` in `src/constants/audio.ts` (0.35) is the one number; the files stay as they are |
| no sound at all under the voice | the bed is Off, or that sound's file would not play: tell the implementer (the development log says "[ambient] the sound could not be played") |
| the sound starts before the voice | a bug: the bed must wait for the voice (tell the implementer) |
| the sound keeps playing after you pause | a bug: tell the implementer what you did just before |
| Preview does nothing | a devotional is playing (the button is dimmed then), or the sound is Off |
| after editing `playerStore.ts` or `ambientPlayer.ts` the sound doubles | development only: Fast Refresh runs the file again and leaves the old native player playing. Reload the app |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **The sounds are yours**, under CC0, the Pixabay Content License or your own recording, so no credit is needed and no credits screen is built (finding 4). Each file's source, author and license are in `assets/audio/ambient/LICENSES.md`, which a check reads.
2. **The implementer makes the loops** with the script of section 0.5 (finding 4): 75 seconds, a 3-second equal-power cross-fade at the seam, one constant gain to -22 LUFS (lower if the true peak would pass -1.5 dBTP), AAC-LC 128 kbps, 44.1 kHz stereo, a whole number of AAC frames, no metadata; about 1.2 MB each. This replaces the old "do not re-encode audio yourself": you approve each loop by ear in B1.
3. **The files**: `assets/audio/ambient/soft-rain.m4a`, `gentle-piano.m4a`, `morning-birds.m4a` and `LICENSES.md`; `src/constants/sounds.ts` imports them (AGENTS.md's planned name, the same pattern as `images.ts`), and `src/types/assets.d.ts` declares `*.m4a`.
4. **One ambient player** in `src/services/ambientPlayer.ts`, made when a sound is first needed: looping, silent at first, `keepAudioSessionActive: false`, `allowsExternalPlayback: false`, a report each second. It never calls the lock screen, `setAudioModeAsync` or `setPlaybackRate`, and it is let go of when nothing needs it (Off, a recording, sign-out). The store makes the devotional's player and this file makes the bed's: the only two `createAudioPlayer` calls.
5. **The level** (finding 12): gain = volume² × 0.35.
6. **Fades**: in over 600 ms once the voice is heard and the file is open; out over 800 ms on a pause, the end or another devotional; a 250 ms dip before another sound; each in proportion to how far it has to go. A new volume is heard at once. Away from the foreground there are no fades (finding 9).
7. **The bed follows the store** (finding 5); `stop()` lets go of it (sign-out).
8. **A start or stop from outside** (finding 8) moves the devotional, with the 1.5-second grace (`AMBIENT_REMOTE_GRACE_MS`).
9. **A take stops the bed at once** (finding 6).
10. **Now Playing saves the choice as the default** (finding 10).
11. **Profile's Preview**: a text button with a play icon under the volume track, hidden while the sound is Off. It plays the default sound at the default volume for 8 seconds (`AMBIENT_PREVIEW_MS`) with the fades, reads **Stop** while it plays, follows a new chip (a new 8 seconds) and the volume under the finger, and stops on leaving Profile, on leaving the app and on sign-out. While a devotional plays it is dimmed and disabled, with "Pause your devotional to preview." under it; it stays reachable by a screen reader, which hears that it is disabled and why.
12. **No rewind at the end** (finding 11).
13. **A sound whose file will not play** is let go of, the devotional plays on, the development log says only that it failed, and it is tried again only when it is chosen again.
14. **Known limits and questions**, reported, not decided: (a) a button pressed within 1.5 seconds of the app's own start or stop of the bed is seen at the next report if it started the bed, and not at all if it stopped it (rare); (b) on Android a car or a Bluetooth display may show the bed's session, with no title, while the bed plays: expo-audio gives every player a media session and has no switch to turn one off (an upstream request); (c) the loops add about 3.6 MB to the app; (d) in development the loops are streamed from Metro over Wi-Fi, so the first start can be a moment late; (e) **a question for you:** whether the default 50% is too soft (finding 12 and B2).

---

## 0. Before you write code

1. Read AGENTS.md: the vendor note "expo-audio 58: a second player, the ambient bed", "Playback (expo-audio, step 26)" and "Ambient soundscape" in the Audio Rules, and "Linting and Validation". Read these files: `src/store/playerStore.ts`, `src/services/audioSession.ts`, `src/services/recorder.ts`, `src/services/account.ts`, `src/screens/journal/NowPlayingScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/components/profile/AmbientPanel.tsx`, `src/data/journalRepository.ts` (`updateProfile`), `src/constants/audio.ts`, `src/constants/images.ts`, `src/types/index.ts`, `src/types/assets.d.ts`, and `supabase/tests/ambient/run.cjs` with `supabase/tests/playback/world.cjs`.
2. **Baseline.** `node --version` must be 22.5 or newer. `npm run typecheck` and `npm run lint` must pass. These must already pass and are not touched by this step: `node --no-warnings supabase/tests/offline/run.cjs` (`44 of 44 passed`), `node --no-warnings supabase/tests/profile-sync/run.cjs` (`88 passed, 0 failed`), `node --no-warnings supabase/tests/journal-data/run.cjs` (`86 checks passed`) and `node supabase/tests/process-entry/parity.cjs` (`7 of 7`). Write down `git status --short`: `src/`, `assets/`, `package.json`, `package-lock.json` and `app.json` must be clean. The review's own files may show as modified or new until they are committed: `AGENTS.md` and its copy, this prompt, `supabase/tests/ambient/`, `supabase/tests/playback/world.cjs`, `supabase/tests/playback/run.cjs` and `supabase/tests/recording/run.cjs`.
3. **Red first.** Run the new checks and the two edited older ones, and see exactly this (the code of this step is not in yet):
   - `node --no-warnings supabase/tests/ambient/run.cjs` prints `2 checks passed, 62 FAILED`: 15 failures say `cannot resolve @/services/ambientPlayer` (the checks that call the ambient player directly), most of the others `Cannot read properties of null` (the old store never makes an ambient player, so there is none to read), and the `files:` and `contract:` checks find no loops, no `LICENSES.md` and no `ambientPlayer.ts`. The two that pass are "with the sound off, playing a devotional makes no ambient player" on each platform, which stays true;
   - `node --no-warnings supabase/tests/playback/run.cjs` prints `131 checks passed, 2 FAILED` (the two `contract:` checks, which name `ambientPlayer.ts`);
   - `node --no-warnings supabase/tests/recording/run.cjs` prints `67 passed, 1 failed` (the start check, which counts one stop of the bed).
4. **The sounds.** The folder `gracehush-sounds` on the user's Desktop, next to the repo folder (`../gracehush-sounds` from the repo root), must hold `soft-rain.*`, `gentle-piano.*` and `morning-birds.*`, and the user's message must give a page address (or "own recording") for each. Open each page (WebFetch is fine: it is a public page) and read its license and its author's name. The license must be CC0 (Freesound shows "Creative Commons 0"), the Pixabay Content License, or the user's own recording. **If a file or an address is missing, or a license is anything else, stop and ask: write no code** (the app cannot bundle without the files). Never download, generate or substitute a sound yourself.
5. **Make the loops.** `ffmpeg -version` and `ffprobe -version` must answer (AGENTS.md: the WinGet package `Gyan.FFmpeg`). Write the script of section 0.5 into your scratchpad, word for word, and run it once per sound from the repo root, for example:
   ```
   node <scratchpad>/make-ambient-loop.cjs --in "../gracehush-sounds/soft-rain.wav" --out assets/audio/ambient/soft-rain.m4a --start 5
   ```
   `--start` skips the first seconds of the recording (a fade-in or a rustle at its start: 5 is a good first try); `--length` (60 to 85, default 75) and `--fade` (1 to 6, default 3) are rarely needed. It prints a report and exits 0 only when the loop passes: the right length to the sample, at most 1.5 MB, -22 LUFS or under (or less, if the true peak needed it), and no jump at the seam beyond what the sound itself does elsewhere. If it prints `"ok": false`, read `problems`: try another `--start` (15 seconds later), or `--fade 5`; after three tries, ask the user for another part or another sound. If it says the source is too short, it needs 78 seconds after `--start`. The script reads only the source and writes only the `.m4a` (and a temporary folder it deletes).
6. **Write `assets/audio/ambient/LICENSES.md`** from this template (LF). A check reads its first table: the columns exactly as here, one row per sound, the source a page address (`https://...`) or `Own recording`, the author as the page names them (for an own recording `Gracehush`: the repo is public, so never a person's name or email), the license exactly `CC0 1.0`, `Pixabay Content License` or `Own recording`, and the credit `No`. The second table holds what each run used and printed.
   ```
   # Ambient loops

   The three sounds the Ambient Soundscape chips play under a devotional (step 27). Each loop was made from the source
   below with the step 27 loop script: 75 seconds of whole AAC frames whose first 3 seconds cross-fade into the end, one
   constant gain to the spoken devotional's loudness (-22 LUFS, or lower to keep the true peak under -1.5 dBTP), AAC-LC
   128 kbps, 44.1 kHz stereo, no metadata. None of these licenses needs a credit in the app.

   | Sound | File | Source | Author | License | Credit required |
   | --- | --- | --- | --- | --- | --- |
   | soft-rain | soft-rain.m4a | <page address> | <author> | <license> | No |
   | gentle-piano | gentle-piano.m4a | <page address> | <author> | <license> | No |
   | morning-birds | morning-birds.m4a | <page address> | <author> | <license> | No |

   ## How each loop was made

   | Sound | Source file | Start (s) | Length (s) | Fade (s) | Loudness (LUFS) | True peak (dBTP) |
   | --- | --- | --- | --- | --- | --- | --- |
   | soft-rain | <the downloaded file's name> | <start> | 75 | 3 | <lufs> | <truePeak> |
   | gentle-piano | <the downloaded file's name> | <start> | 75 | 3 | <lufs> | <truePeak> |
   | morning-birds | <the downloaded file's name> | <start> | 75 | 3 | <lufs> | <truePeak> |
   ```
7. List every `TODO(27)` with file:line (`grep -rn "TODO(27)\|TEMP(27)" src`). Four today: `src/store/playerStore.ts` twice (persist the ambient choice), `src/screens/profile/ProfileScreen.tsx` (a Preview button next to the chips) and `src/services/account.ts` (stop the ambient preview). The edits below close each one, and `grep` must find none at the end.
8. **No install, no native change.** `package.json`, `package-lock.json` and `app.json` must be byte-identical at the end.

### 0.5 The loop script (`make-ambient-loop.cjs`, in your scratchpad, not the repo)

Proven in the review on three synthetic sources (a noise "rain", a decaying-sine "piano" in mono and a chirping "birds", WAV and MP3, 48 and 44.1 kHz): each came out exactly 75.000 seconds when decoded (3,307,520 samples), 1.21 to 1.24 MB, -21.7 to -22.4 LUFS, with no jump at the seam; a copy with the cross-fade taken out was refused for the piano (a jump) and the birds (a level change), while a hard cut in steady noise has no click to find, which is why the seam is cross-faded whatever the sound.

```js
// Makes one seamless ambient loop for Gracehush (step 27) from a downloaded recording, and checks it.
//
//   node make-ambient-loop.cjs --in <source file> --out <assets/audio/ambient/NAME.m4a> [--start 0] [--length 75] [--fade 3]
//
// What it does, in order:
//   1. ffmpeg decodes `length + fade` seconds of the source from `start`, as 44.1 kHz stereo 32-bit float.
//   2. The loop is `length` seconds (rounded to a whole number of 1,024-sample AAC frames). Its first `fade` seconds are the
//      source's own start faded in, mixed with the source's audio just after the loop's end faded out (an equal-power
//      crossfade), so the last sample of the loop runs straight into its first: no click, no gap, no level jump.
//   3. One constant gain brings it to the spoken devotional's loudness (-22 LUFS), or lower if its true peak would pass
//      -1.5 dBTP. A constant gain keeps the seam seamless (a compressor would not).
//   4. ffmpeg encodes AAC-LC, 128 kbps, 44.1 kHz stereo, in an .m4a with no metadata and the index at the front.
//   5. It decodes the result again and prints what it measured: length, size, loudness, true peak, and the seam.
// It needs ffmpeg and ffprobe on the PATH. It reads only the source and writes only the output (and a temp folder).
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RATE = 44_100;
const CHANNELS = 2;
const FRAME = 1_024; // AAC frame: a loop of whole frames needs no padding at its end
const TARGET_LUFS = -22; // the spoken devotional's loudness, measured on the real WAV files
const MAX_TRUE_PEAK = -1.5;
const MAX_BYTES = 1_500_000;

function args() {
  const out = { start: 0, length: 75, fade: 3 };
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i += 2) {
    const key = list[i].replace(/^--/, "");
    const value = list[i + 1];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    out[key] = ["start", "length", "fade"].includes(key) ? Number(value) : value;
  }
  if (!out.in || !out.out) throw new Error("usage: --in <source> --out <file.m4a> [--start s] [--length s] [--fade s]");
  if (!(out.length >= 60 && out.length <= 85)) throw new Error("--length must be 60 to 85 seconds");
  if (!(out.fade >= 1 && out.fade <= 6)) throw new Error("--fade must be 1 to 6 seconds");
  if (!(out.start >= 0)) throw new Error("--start must be 0 or more");
  return out;
}

function ffmpeg(list, options = {}) {
  return execFileSync("ffmpeg", ["-hide_banner", "-nostdin", ...list], { maxBuffer: 1 << 30, ...options });
}

function readFloats(file) {
  const bytes = fs.readFileSync(file);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

// Integrated loudness and true peak, from ffmpeg's loudnorm analysis (it only measures here).
function measureFile(input, raw) {
  const list = raw
    ? ["-f", "f32le", "-ar", String(RATE), "-ac", String(CHANNELS), "-i", input]
    : ["-i", input];
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostdin", ...list, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
    { maxBuffer: 1 << 30, encoding: "utf8" },
  );
  const text = run.stderr;
  const json = JSON.parse(text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1));
  return { lufs: Number(json.input_i), truePeak: Number(json.input_tp) };
}

function main() {
  const opts = args();
  if (!fs.existsSync(opts.in)) throw new Error(`no such file: ${opts.in}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gracehush-loop-"));
  try {
    const frames = Math.round((opts.length * RATE) / FRAME) * FRAME;
    const fadeSamples = Math.round(opts.fade * RATE);
    const sourceRaw = path.join(temp, "source.f32");
    ffmpeg(["-ss", String(opts.start), "-t", String((frames + fadeSamples) / RATE + 0.5), "-i", opts.in, "-vn", "-ac",
      String(CHANNELS), "-ar", String(RATE), "-f", "f32le", "-y", sourceRaw], { stdio: ["ignore", "ignore", "pipe"] });
    const source = readFloats(sourceRaw);
    const available = source.length / CHANNELS;
    if (available < frames + fadeSamples) {
      throw new Error(
        `the source has ${(available / RATE).toFixed(1)} s after --start; this loop needs ${((frames + fadeSamples) / RATE).toFixed(1)} s`,
      );
    }

    // The loop with its crossfaded seam.
    const loop = new Float32Array(frames * CHANNELS);
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < CHANNELS; c += 1) {
        const at = i * CHANNELS + c;
        if (i < fadeSamples) {
          const angle = (Math.PI / 2) * (i / fadeSamples);
          loop[at] = source[at] * Math.sin(angle) + source[(frames + i) * CHANNELS + c] * Math.cos(angle);
        } else {
          loop[at] = source[at];
        }
      }
    }

    // One constant gain to the target, held under the true-peak ceiling.
    const loopRaw = path.join(temp, "loop.f32");
    fs.writeFileSync(loopRaw, Buffer.from(loop.buffer));
    const before = measureFile(loopRaw, true);
    const gainDb = Math.min(TARGET_LUFS - before.lufs, MAX_TRUE_PEAK - before.truePeak);
    const gain = 10 ** (gainDb / 20);
    for (let i = 0; i < loop.length; i += 1) loop[i] *= gain;
    fs.writeFileSync(loopRaw, Buffer.from(loop.buffer));

    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    ffmpeg(["-f", "f32le", "-ar", String(RATE), "-ac", String(CHANNELS), "-i", loopRaw, "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", "-map_metadata", "-1", "-y", opts.out], { stdio: ["ignore", "ignore", "pipe"] });

    // Check what was written, decoded the way a player decodes it.
    const decodedRaw = path.join(temp, "decoded.f32");
    ffmpeg(["-i", opts.out, "-f", "f32le", "-ac", String(CHANNELS), "-ar", String(RATE), "-y", decodedRaw], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const decoded = readFloats(decodedRaw);
    const decodedFrames = decoded.length / CHANNELS;
    const after = measureFile(opts.out, false);
    const size = fs.statSync(opts.out).size;

    // The seam: the step from the last sample to the first against the steps inside the loop, and the level just before
    // the end against the level just after the start.
    const steps = [];
    for (let i = 1; i < decodedFrames; i += 97) {
      for (let c = 0; c < CHANNELS; c += 1) steps.push(Math.abs(decoded[i * CHANNELS + c] - decoded[(i - 1) * CHANNELS + c]));
    }
    steps.sort((a, b) => a - b);
    const typicalStep = steps[Math.floor(steps.length * 0.99)] || 1e-9;
    let seamStep = 0;
    for (let c = 0; c < CHANNELS; c += 1) {
      seamStep = Math.max(seamStep, Math.abs(decoded[c] - decoded[(decodedFrames - 1) * CHANNELS + c]));
    }
    const rms = (from, count) => {
      let sum = 0;
      for (let i = from; i < from + count; i += 1) for (let c = 0; c < CHANNELS; c += 1) sum += decoded[i * CHANNELS + c] ** 2;
      return Math.sqrt(sum / (count * CHANNELS)) || 1e-9;
    };
    // The level of the 100 ms just after the start against the 100 ms just before the end, and the same jump between
    // neighbouring windows everywhere inside the loop: music has jumps of its own (a note starting), and the seam may have
    // one as big as those, not bigger.
    const window = Math.round(0.1 * RATE);
    const levelJumpDb = 20 * Math.log10(rms(0, window) / rms(decodedFrames - window, window));
    const jumps = [];
    for (let i = window; i + window <= decodedFrames; i += Math.round(window / 2)) {
      jumps.push(Math.abs(20 * Math.log10(rms(i, window) / rms(i - window, window))));
    }
    jumps.sort((a, b) => a - b);
    const usualJumpDb = jumps[Math.floor(jumps.length * 0.99)] ?? 0;

    const report = {
      file: path.basename(opts.out),
      seconds: Number((decodedFrames / RATE).toFixed(3)),
      samplesExact: decodedFrames === frames,
      bytes: size,
      underSizeLimit: size <= MAX_BYTES,
      gainDb: Number(gainDb.toFixed(2)),
      lufs: after.lufs,
      truePeak: after.truePeak,
      seamStepVs99thPercentile: Number((seamStep / typicalStep).toFixed(2)),
      seamLevelJumpDb: Number(levelJumpDb.toFixed(2)),
      loopLevelJump99thDb: Number(usualJumpDb.toFixed(2)),
    };
    const problems = [];
    if (!report.samplesExact) problems.push(`decodes to ${decodedFrames} samples, not ${frames}`);
    if (!report.underSizeLimit) problems.push(`${size} bytes is over ${MAX_BYTES}`);
    if (report.seconds < 60 || report.seconds > 90) problems.push("not 60 to 90 seconds");
    if (after.truePeak > MAX_TRUE_PEAK + 0.6) problems.push(`true peak ${after.truePeak} dBTP`);
    if (after.lufs > TARGET_LUFS + 1) problems.push(`louder than ${TARGET_LUFS} LUFS`);
    if (after.lufs < TARGET_LUFS - 6) problems.push("more than 6 dB under the target: a very peaky source, pick another part or sound");
    if (report.seamStepVs99thPercentile > 1.5) problems.push("a jump at the seam: listen to it, or try another --start");
    if (Math.abs(levelJumpDb) > Math.max(2, usualJumpDb + 1)) {
      problems.push("the level changes at the seam more than anywhere inside the loop: try another --start or a longer --fade");
    }
    report.ok = problems.length === 0;
    report.problems = problems;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`make-ambient-loop: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
```

---

## 1. The files to create (verbatim)

Both LF. They are the finished, proven files: do not reword them, and do not add what is not here. The sound files and `LICENSES.md` are yours to make (section 0, points 5 and 6).

### 1.1 `src/constants/sounds.ts`

The loops by sound, imported the way `images.ts` imports pictures. The `Record` makes the typecheck fail when a sound has no file.

```ts
import gentlePiano from "@/assets/audio/ambient/gentle-piano.m4a";
import morningBirds from "@/assets/audio/ambient/morning-birds.m4a";
import softRain from "@/assets/audio/ambient/soft-rain.m4a";
import type { AmbientLoop } from "@/types";

// The ambient loops bundled with the app (step 27), one for each sound the chips offer. Each is a seamless loop made from a
// recording whose source and license are in assets/audio/ambient/LICENSES.md. The Record makes typecheck fail when a sound
// has no file. Only services/ambientPlayer.ts plays them.
export const sounds: Record<AmbientLoop, number> = {
  "soft-rain": softRain,
  "gentle-piano": gentlePiano,
  "morning-birds": morningBirds,
};
```

### 1.2 `src/services/ambientPlayer.ts`

The bed and the preview: one player, the fades, the start and stop from outside, and the end of everything at a recording or a sign-out. The store calls `setAmbientBed` on every change and `stopAmbient` in `stop()`; the recorder calls `stopAmbient`; Profile calls the four preview functions.

```ts
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { AppState } from "react-native";

import {
  AMBIENT_FADE_IN_MS,
  AMBIENT_FADE_OUT_MS,
  AMBIENT_FADE_STEP_MS,
  AMBIENT_PREVIEW_MS,
  AMBIENT_REMOTE_GRACE_MS,
  AMBIENT_SWITCH_MS,
  AMBIENT_UPDATE_MS,
  MAX_AMBIENT_GAIN,
} from "@/constants/audio";
import { sounds } from "@/constants/sounds";
import type { AmbientLoop, AmbientSound } from "@/types";

// The ambient bed (step 27): a second expo-audio player that loops a bundled sound under the devotional, mixed on the phone.
// The player store says what it wants (setAmbientBed) and this file makes it so. Profile's preview plays the same player
// while no devotional is playing. It never touches the audio session (audioSession.ts does), the lock screen (the
// devotional's player owns it) or the speed (the bed always plays at 1x).
//
// What is heard is ambientGain(volume) times a fade from 0 to 1. A paused player is always left at volume 0, so a start
// that nobody here asked for (see onStatus) is silent until a fade brings it in.

// What the player store wants under the devotional: the session's sound and volume, and whether the voice is being heard.
export type AmbientBed = { sound: AmbientSound; volume: number; on: boolean };
// A play or a pause that reached this player from outside the app, which the player store turns into the same action on
// the devotional (see onStatus).
export type AmbientRemoteCommand = "play" | "pause";

type Output = { sound: AmbientLoop; volume: number; from: "bed" | "preview" };

let bed: AmbientBed = { sound: "off", volume: 0, on: false };
let preview: { sound: AmbientLoop; volume: number } | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const previewListeners = new Set<() => void>();
let remoteHandler: ((command: AmbientRemoteCommand) => void) | null = null;

// ---- the native player. It is made when a sound is first needed and let go of when nothing will need it soon.
let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
let loaded: AmbientLoop | null = null;
// play() was called and pause() was not since (or the player started by itself and was not paused since).
let asked = false;
// 0 to 1: how far the current fade has come. 0 whenever the player is paused.
let fade = 0;
// ambientGain of the volume being heard.
let level = 0;
// What the player last played: a start that comes from outside counts for the devotional only after the bed.
let served: "bed" | "preview" | null = null;
let ramp: { timer: ReturnType<typeof setTimeout>; to: number } | null = null;
// When the app last called play, pause or replace. A report this soon after one can still describe the moment before it.
let lastCallAt = Number.NEGATIVE_INFINITY;
// A sound whose file would not play. It is not tried again until another sound is chosen.
let broken: AmbientLoop | null = null;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// The gain for a volume of 0 to 1: the volume squared, times MAX_AMBIENT_GAIN. Half the volume is a quarter of the gain,
// about 12 dB down, which sounds about half as loud. A volume outside 0 to 1, or not a number, is clamped first.
export function ambientGain(volume: number): number {
  const clamped = clamp01(volume);
  return clamped * clamped * MAX_AMBIENT_GAIN;
}

function goal(): Output | null {
  if (bed.on) {
    return bed.sound === "off" || bed.sound === broken ? null : { sound: bed.sound, volume: bed.volume, from: "bed" };
  }
  if (preview === null || preview.sound === broken) return null;
  return { sound: preview.sound, volume: preview.volume, from: "preview" };
}

function called() {
  lastCallAt = Date.now();
}

function applyVolume() {
  if (player === null) return;
  try {
    player.volume = level * fade;
  } catch {
    // Released.
  }
}

function cancelRamp() {
  if (ramp === null) return;
  clearTimeout(ramp.timer);
  ramp = null;
}

function isLoaded(): boolean {
  try {
    return player?.isLoaded === true;
  } catch {
    return false;
  }
}

// Moves the fade to `to`, in steps, over `fullMs` times the distance to go, and then settles again. Away from the foreground
// it jumps at once: JS timers are throttled there (Android stops them), so a fade could be left half done.
function fadeTo(to: number, fullMs: number) {
  cancelRamp();
  const from = fade;
  const ms = fullMs * Math.abs(to - from);
  if (ms < AMBIENT_FADE_STEP_MS || AppState.currentState !== "active") {
    fade = to;
    applyVolume();
    settle();
    return;
  }
  const startedAt = Date.now();
  const step = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / ms);
    fade = from + (to - from) * progress;
    applyVolume();
    if (progress < 1) {
      ramp = { timer: setTimeout(step, AMBIENT_FADE_STEP_MS), to };
      return;
    }
    ramp = null;
    settle();
  };
  ramp = { timer: setTimeout(step, AMBIENT_FADE_STEP_MS), to };
}

// A fade that is running ends now, where it was going.
function finishRamp() {
  if (ramp === null) return;
  const { to } = ramp;
  cancelRamp();
  fade = to;
  applyVolume();
  settle();
}

// Lets go of the player. Never throws.
function release() {
  cancelRamp();
  const old = player;
  const oldSubscription = subscription;
  player = null;
  subscription = null;
  loaded = null;
  asked = false;
  fade = 0;
  served = null;
  try {
    oldSubscription?.remove();
  } catch {
    // Already removed.
  }
  if (old === null) return;
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

// The sound would not play. The devotional plays on without it, and a preview of it ends.
function fail(sound: AmbientLoop | null) {
  // Only that something failed: the choice of sound is the user's.
  if (__DEV__) console.warn("[ambient] the sound could not be played");
  broken = sound;
  release();
  if (preview !== null && preview.sound === sound) endPreview();
}

// Puts `sound` in the player: a new player the first time (looping, silent), the same player otherwise.
function open(sound: AmbientLoop): boolean {
  try {
    if (player === null) {
      const created = createAudioPlayer(sounds[sound], {
        updateInterval: AMBIENT_UPDATE_MS,
        // The devotional's player keeps the session while a devotional is loaded. This one never holds it on its own, so
        // the end of a preview hands the sound back to the other apps.
        keepAudioSessionActive: false,
        // With AirPlay, a player that hands its file to the receiver stops looping (expo-audio 58.0.0).
        allowsExternalPlayback: false,
      });
      player = created;
      subscription = created.addListener("playbackStatusUpdate", (status) => {
        if (player === created) onStatus(status);
      });
      created.loop = true;
      created.volume = 0;
      asked = false;
      fade = 0;
    } else {
      called();
      player.replace(sounds[sound]);
    }
    loaded = sound;
    return true;
  } catch {
    fail(sound);
    return false;
  }
}

// The state changes before the native call: a report the call sends must already find it.
function start() {
  if (player === null) return;
  fade = 0;
  applyVolume();
  asked = true;
  called();
  try {
    player.play();
  } catch {
    fail(loaded);
  }
}

function stopPlayer() {
  if (player === null) return;
  asked = false;
  fade = 0;
  applyVolume();
  called();
  try {
    player.pause();
  } catch {
    // Nothing to pause.
  }
}

// Silence: a fade out, then a pause. When nothing will need the sound soon (the bed is off and there is no preview), the
// player is let go of, so it holds no file and, on Android, no media session.
function quiet() {
  if (asked && fade > 0) {
    fadeTo(0, AMBIENT_FADE_OUT_MS);
    return;
  }
  cancelRamp();
  if (asked) stopPlayer();
  if (bed.sound === "off" && preview === null) release();
}

// Takes one step towards what is wanted now. Every change calls it, and so does the end of every fade.
function settle() {
  const target = goal();
  if (target === null) {
    quiet();
    return;
  }
  served = target.from;
  level = ambientGain(target.volume);
  if (loaded !== target.sound) {
    // Another sound: the one that is playing dips out first, and settle() runs again when it is silent.
    if (asked && fade > 0) {
      fadeTo(0, AMBIENT_SWITCH_MS);
      return;
    }
    if (!open(target.sound)) return;
  }
  if (!asked) start();
  if (fade >= 1) {
    applyVolume();
    return;
  }
  // The sound fades in once its file is open. Until then the first report that says it is open calls settle() again.
  if (isLoaded()) fadeTo(1, AMBIENT_FADE_IN_MS);
}

// A start or a stop that the app did not ask for. The lock screen never reaches this player (the devotional's player owns
// it), but the system stops and restarts every player around a call or an alarm, and on Android a headset or car button
// can land here: every expo-audio player has a media session of its own, and the one that started playing last gets the
// button. A stop of the bed is passed on as a pause of the devotional, and a start after the bed as a play of it, so the two
// never go apart. A report sent just before the app's own last call is not counted.
function onStatus(status: AudioStatus) {
  if (status.error) {
    fail(loaded);
    return;
  }
  if (Date.now() - lastCallAt >= AMBIENT_REMOTE_GRACE_MS) {
    // Paused for real, not merely waiting for data: iOS says "waiting", and Android is not loaded while it buffers.
    const stopped = !status.playing && status.isLoaded && status.timeControlStatus === "paused";
    if (asked && stopped) {
      remoteStop();
      return;
    }
    if (!asked && status.playing) {
      remoteStart();
      return;
    }
  }
  // The file is open: a fade-in that was waiting for it can begin.
  if (status.isLoaded && asked && fade < 1 && ramp === null) settle();
}

function remoteStop() {
  cancelRamp();
  asked = false;
  fade = 0;
  applyVolume();
  if (served === "preview") endPreview();
  else if (bed.on) remoteHandler?.("pause");
  settle();
}

function remoteStart() {
  // It is playing, at volume 0: nothing is heard until a fade brings it in.
  asked = true;
  if (served === "bed" && !bed.on) remoteHandler?.("play");
  // Anything that does not want it now pauses it again.
  settle();
}

function notifyPreview() {
  for (const listener of [...previewListeners]) listener();
}

function endPreview() {
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (preview === null) return;
  preview = null;
  notifyPreview();
}

// ---- for the player store

// What the devotional wants under it. The store calls it on every change, so nothing happens when nothing changed.
export function setAmbientBed(next: AmbientBed): void {
  const volume = clamp01(next.volume);
  if (next.sound === bed.sound && volume === bed.volume && next.on === bed.on) return;
  if (next.sound !== bed.sound) broken = null;
  bed = { sound: next.sound, volume, on: next.on };
  // The bed wins over a preview: the preview ends when a devotional starts (from the lock screen, for example).
  if (bed.on) endPreview();
  settle();
}

export function setAmbientRemoteHandler(handler: (command: AmbientRemoteCommand) => void): void {
  remoteHandler = handler;
}

// Everything off at once and the player let go of: a recording is about to start (the microphone must not hear the bed),
// or the user signs out.
export function stopAmbient(): void {
  endPreview();
  release();
}

// ---- for Profile

// Plays `sound` at `volume` for AMBIENT_PREVIEW_MS, with a fade in and out, or changes the preview that is playing (a new
// sound plays its full time again, a new volume is heard at once). Never over a devotional that is playing.
export function previewAmbient(sound: AmbientSound, volume: number): void {
  if (bed.on) return;
  if (sound === "off") {
    stopPreview();
    return;
  }
  const isNew = preview === null || preview.sound !== sound;
  if (isNew) broken = null;
  const starting = preview === null;
  preview = { sound, volume: clamp01(volume) };
  if (isNew) {
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      endPreview();
      settle();
    }, AMBIENT_PREVIEW_MS);
  }
  if (starting) notifyPreview();
  settle();
}

export function stopPreview(): void {
  if (preview === null) return;
  endPreview();
  settle();
}

export function isPreviewing(): boolean {
  return preview !== null;
}

export function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

// Away from the foreground: a fade that is running ends at once (Android stops JS timers there), and a preview, which
// belongs to Profile, stops at once. A bed under a devotional plays on.
AppState.addEventListener("change", (state) => {
  if (state === "active") return;
  finishRamp();
  if (preview !== null) {
    endPreview();
    settle();
  }
});
```

---

## 2. Edits to the existing files

Each block gives the text to find (it occurs exactly once in its file, as LF text) and the text that replaces it. One file is replaced whole (2.10). These files use CRLF line endings: `src/types/index.ts`, `src/constants/copy.ts`, `src/store/playerStore.ts`, `src/services/account.ts`, `src/screens/journal/NowPlayingScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/components/profile/AmbientPanel.tsx`. These use LF: `src/types/assets.d.ts`, `src/constants/audio.ts`, `src/services/recorder.ts`. Keep each file's endings: the Edit tool matches a single line in a CRLF file, but a block of several lines may not match, so apply a multi-line block with a small Node script that matches on the LF text and writes CRLF back (the review's own script did exactly that, and the result is byte-identical to the proven files).

Anything not listed stays as it is: no layout, no token, no class and no other copy string changes. **Delete nothing else.**

### 2.1 `src/types/index.ts`

A name for the sounds that have a file.

a) Find:

```ts
export type AmbientSound = "off" | "soft-rain" | "gentle-piano" | "morning-birds";
```

Replace with:

```ts
export type AmbientSound = "off" | "soft-rain" | "gentle-piano" | "morning-birds";
// A sound that has a file to loop (step 27): every choice but "off".
export type AmbientLoop = Exclude<AmbientSound, "off">;
```

### 2.2 `src/types/assets.d.ts`

An `.m4a` import is a number, like a picture.

a) Find:

```ts
declare module "*.png" {
  const source: number;
  export default source;
}
```

Replace with:

```ts
declare module "*.png" {
  const source: number;
  export default source;
}

declare module "*.m4a" {
  const source: number;
  export default source;
}
```

### 2.3 `src/constants/audio.ts`

The bed's numbers, each with its reason, below the playback ones.

a) Find:

```ts
// How long the app waits for that link before the audio counts as needing a connection. A request with no connection can
// wait for minutes (a session token that cannot be refreshed), and a play that waited that long would start by itself when
// the connection came back.
export const DEVOTIONAL_LINK_TIMEOUT_MS = 15_000;
```

Replace with:

```ts
// How long the app waits for that link before the audio counts as needing a connection. A request with no connection can
// wait for minutes (a session token that cannot be refreshed), and a play that waited that long would start by itself when
// the connection came back.
export const DEVOTIONAL_LINK_TIMEOUT_MS = 15_000;

// ---- The ambient bed under a devotional (step 27)

// The loudest the ambient sound gets, as a share of its file's level: 0.35 is about 9 dB down. The loops are made at the
// spoken devotional's own loudness (-22 LUFS, measured on the real WAV files), so at 100% the voice is still clearly on top.
// The volume is squared first (ambientGain in services/ambientPlayer.ts).
export const MAX_AMBIENT_GAIN = 0.35;

// The fades: in when the voice is heard, out when it pauses or ends, and a short dip when the sound is changed while it plays.
export const AMBIENT_FADE_IN_MS = 600;
export const AMBIENT_FADE_OUT_MS = 800;
export const AMBIENT_SWITCH_MS = 250;
// One step of a fade.
export const AMBIENT_FADE_STEP_MS = 30;

// How long Profile's preview plays, its fade in included, before it fades out by itself.
export const AMBIENT_PREVIEW_MS = 8_000;

// How often the ambient player reports. Nothing draws from it, so once a second is plenty.
export const AMBIENT_UPDATE_MS = 1_000;

// A start or a stop of the ambient player that comes this long after the app's own last call to it was made by something
// else: the system around a call, or a headset or car button on Android (services/ambientPlayer.ts).
export const AMBIENT_REMOTE_GRACE_MS = 1_500;
```

### 2.4 `src/constants/copy.ts`

The Preview button's five strings, with the Profile ambient strings.

a) Find:

```ts
      helper: "This is the sound your next devotional starts with.",
      showHint: "Shows the sounds",
      hideHint: "Hides the sounds",
    },
```

Replace with:

```ts
      helper: "This is the sound your next devotional starts with.",
      showHint: "Shows the sounds",
      hideHint: "Hides the sounds",
      // The preview (step 27): a few seconds of the chosen sound, while no devotional is playing.
      preview: "Preview",
      previewLabel: (label: string) => `Preview ${label}`,
      stop: "Stop",
      stopLabel: "Stop the preview",
      previewBlocked: "Pause your devotional to preview.",
    },
```

### 2.5 `src/store/playerStore.ts`

The store imports the ambient player, says so in two comments, lets go of the bed in `stop()`, and, at the end of the file, follows itself with the bed and answers a start or stop that reached the bed. The two `TODO(27)` lines go. No state or action is added, renamed or removed.

a) Find:

```ts
import { KEEP_SESSION_ACTIVE, LOAD_TIMEOUT_MS, PLAYER_UPDATE_MS } from "@/constants/audio";
import { setSessionMode } from "@/services/audioSession";
```

Replace with:

```ts
import { KEEP_SESSION_ACTIVE, LOAD_TIMEOUT_MS, PLAYER_UPDATE_MS } from "@/constants/audio";
import { setAmbientBed, setAmbientRemoteHandler, stopAmbient } from "@/services/ambientPlayer";
import { setSessionMode } from "@/services/audioSession";
```

b) Find:

```ts
  rate: PlaybackRate;
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
```

Replace with:

```ts
  rate: PlaybackRate;
  // The session's ambient bed (step 27): services/ambientPlayer.ts plays it under the voice (see the end of this file).
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
```

c) Find:

```ts
  // A full reset, for sign-out (step 15): the sound stops, the lock screen is cleared and the player is released.
  stop: () => void;
```

Replace with:

```ts
  // A full reset, for sign-out (step 15): the sound stops, the lock screen is cleared and the player is released, and so
  // are the ambient bed and Profile's preview (step 27).
  stop: () => void;
```

d) Find:

```ts
  // TODO(27): persist the ambient choice to users_profile
  setAmbient: (sound) => set({ ambientSound: sound }),

  // TODO(27): persist the ambient choice to users_profile
  setAmbientVolume: (volume) => set({ ambientVolume: clamp(volume, 0, 1) }),
```

Replace with:

```ts
  // The bed follows at once (the subscription at the end of this file). Now Playing also saves the choice as the default
  // the next devotional starts with; Profile changes only that default (step 15).
  setAmbient: (sound) => set({ ambientSound: sound }),

  setAmbientVolume: (volume) => set({ ambientVolume: clamp(volume, 0, 1) }),
```

e) Find:

```ts
    track = null;
    releasePlayer();
    ambientSeeded = false;
```

Replace with:

```ts
    track = null;
    releasePlayer();
    stopAmbient();
    ambientSeeded = false;
```

f) Find:

```ts
AppState.addEventListener("change", (state) => {
  if (state !== "active" || player === null || !ready) return;
  try {
    reconcile(player.currentStatus);
  } catch {
    // Released.
  }
});
```

Replace with:

```ts
AppState.addEventListener("change", (state) => {
  if (state !== "active" || player === null || !ready) return;
  try {
    reconcile(player.currentStatus);
  } catch {
    // Released.
  }
});

// ---- the ambient bed (step 27). It is heard only with the voice: it comes in when the voice is heard (not while the file is
// downloaded or opened), stays while the voice waits for data again, and goes when the devotional pauses, ends or another
// one is loaded. Because it follows this store, the lock screen, a headset and a call move it too.
let bedOn = false;
usePlayerStore.subscribe((state) => {
  if (state.status !== "playing") bedOn = false;
  else if (!state.isBuffering) bedOn = true;
  setAmbientBed({ sound: state.ambientSound, volume: state.ambientVolume, on: bedOn });
});

// A button that reached the ambient player instead of the devotional's (Android gives every player a media session) moves
// the devotional the same way, so the two never go apart.
// (play and pause do nothing when there is nothing to do.)
setAmbientRemoteHandler((command) => {
  const { play, pause } = usePlayerStore.getState();
  if (command === "pause") pause();
  else play();
});
```

### 2.6 `src/services/recorder.ts`

A take stops the bed at once.

a) Find:

```ts
import { setSessionMode } from "@/services/audioSession";
import { usePlayerStore } from "@/store/playerStore";
```

Replace with:

```ts
import { stopAmbient } from "@/services/ambientPlayer";
import { setSessionMode } from "@/services/audioSession";
import { usePlayerStore } from "@/store/playerStore";
```

b) Find:

```ts
  // A devotional that is playing stops: the take must not hear it, and the microphone takes the audio session.
  usePlayerStore.getState().pause();
```

Replace with:

```ts
  // A devotional that is playing stops: the take must not hear it, and the microphone takes the audio session. The ambient
  // bed stops at once as well, with no fade, which would still be playing from the speaker when the microphone opens.
  usePlayerStore.getState().pause();
  stopAmbient();
```

### 2.7 `src/services/account.ts`

The store's `stop()` already ends the bed and the preview, so the `TODO(27)` line goes and two comments say so. No import is added.

a) Find:

```ts
// device-level (AGENTS.md, Authentication Rules). Steps 17, 24, 26, 27, 28, 30, 33 and 34 each add their line.
```

Replace with:

```ts
// device-level (AGENTS.md, Authentication Rules). Steps 17, 24, 26, 28, 30, 33 and 34 each add their line (step 27's is
// inside the player store's stop()).
```

b) Find:

```ts
  // A full reset of the player: the sound stops, the lock screen is cleared and the player is released, and the position,
  // the speed and the session's ambient choice go. Then the devotionals downloaded to this phone, and any download still
  // running (step 26): a prayer's audio must not outlive the session either.
  usePlayerStore.getState().stop();
  await deleteAllDevotionalAudio();
  // TODO(27): stop the ambient preview
  // TODO(28): cancel the scheduled affirmation notifications
```

Replace with:

```ts
  // A full reset of the player: the sound stops, the lock screen is cleared and the player is released, and the position,
  // the speed and the session's ambient choice go, with the ambient bed and Profile's preview (step 27). Then the
  // devotionals downloaded to this phone, and any download still running (step 26): a prayer's audio must not outlive the
  // session either.
  usePlayerStore.getState().stop();
  await deleteAllDevotionalAudio();
  // TODO(28): cancel the scheduled affirmation notifications
```

### 2.8 `src/screens/journal/NowPlayingScreen.tsx`

A chip and the volume (when the finger lifts) are saved as the default too, and the `ambient_changed` marker for step 34 gets its Now Playing twin.

a) Find:

```tsx
import { colors, gradients, layout, radii, shadows } from "@/constants/theme";
import { getPlaybackTrack } from "@/data/selectors";
```

Replace with:

```tsx
import { colors, gradients, layout, radii, shadows } from "@/constants/theme";
import { updateProfile } from "@/data/journalRepository";
import { getPlaybackTrack } from "@/data/selectors";
```

b) Find:

```tsx
              selected={sound === ambientSound}
              onPress={() => playback.setAmbient(sound)}
            />
```

Replace with:

```tsx
              selected={sound === ambientSound}
              onPress={() => {
                playback.setAmbient(sound);
                // What is chosen here is also the sound the next devotional starts with (step 27). A save that fails
                // changes nothing on this screen: the next change saves again.
                void updateProfile({ ambientSound: sound });
                // TODO(34): ambient_changed { sound, source: 'now_playing' }
              }}
            />
```

c) Find:

```tsx
              onSeekEnd={(volume) => {
                playback.setAmbientVolume(volume);
                setIsTouching(false);
              }}
```

Replace with:

```tsx
              onSeekEnd={(volume) => {
                playback.setAmbientVolume(volume);
                // Saved once, when the finger lifts.
                void updateProfile({ ambientVolume: volume });
                setIsTouching(false);
              }}
```

### 2.9 `src/screens/profile/ProfileScreen.tsx`

The preview: whether it plays (`useSyncExternalStore` over the ambient player), whether a devotional plays (one store field, so no re-render on every tick), a stop on leaving the tab, and the panel's new props. The `TODO(27)` line goes.

a) Find:

```tsx
import { useCallback, useRef, useState, type ReactNode } from "react";
```

Replace with:

```tsx
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
```

b) Find:

```tsx
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
```

Replace with:

```tsx
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
import { isPreviewing, previewAmbient, stopPreview, subscribePreview } from "@/services/ambientPlayer";
```

c) Find:

```tsx
  const restoreRunning = useRef(false);
  useAnnounce(dialogError);

  // Leaving the tab (or opening a screen over it) clears every notice.
  useFocusEffect(useCallback(() => () => setNotices([]), []));
```

Replace with:

```tsx
  const restoreRunning = useRef(false);
  useAnnounce(dialogError);
  // The ambient preview (step 27) plays only while no devotional is playing.
  const previewing = useSyncExternalStore(subscribePreview, isPreviewing);
  const devotionalPlaying = usePlayerStore((store) => store.status === "playing");

  // Leaving the tab (or opening a screen over it) clears every notice and stops a preview.
  useFocusEffect(
    useCallback(
      () => () => {
        setNotices([]);
        stopPreview();
      },
      [],
    ),
  );
```

d) Find:

```tsx
      usePlayerStore.getState().reseedAmbient();
      // TODO(27): a Preview button next to the chips
      // TODO(34): ambient_changed { sound, source: 'profile' }
```

Replace with:

```tsx
      usePlayerStore.getState().reseedAmbient();
      // TODO(34): ambient_changed { sound, source: 'profile' }
```

e) Find:

```tsx
                      <AmbientPanel
                        sound={ready.profile.ambientSound}
                        volume={ready.profile.ambientVolume}
                        onChangeSound={(ambientSound) => changeAmbient({ ambientSound })}
                        onChangeVolume={(ambientVolume) => changeAmbient({ ambientVolume })}
                        onSeekingChange={setIsSeeking}
                      />
```

Replace with:

```tsx
                      <AmbientPanel
                        sound={ready.profile.ambientSound}
                        volume={ready.profile.ambientVolume}
                        // A preview that is playing follows a new choice at once (Off stops it).
                        onChangeSound={(ambientSound) => {
                          if (previewing) previewAmbient(ambientSound, ready.profile.ambientVolume);
                          changeAmbient({ ambientSound });
                        }}
                        onChangeVolume={(ambientVolume) => {
                          if (previewing) previewAmbient(ready.profile.ambientSound, ambientVolume);
                          changeAmbient({ ambientVolume });
                        }}
                        onSeekingChange={setIsSeeking}
                        previewing={previewing}
                        previewBlocked={devotionalPlaying}
                        onTogglePreview={() => {
                          if (previewing) stopPreview();
                          else previewAmbient(ready.profile.ambientSound, ready.profile.ambientVolume);
                        }}
                        onDragVolume={(ambientVolume) => {
                          if (previewing) previewAmbient(ready.profile.ambientSound, ambientVolume);
                        }}
                      />
```

### 2.10 `src/components/profile/AmbientPanel.tsx` (whole file)

The Preview button (a 44-tall text button with a play or stop icon, plum, `text-label-md`) and its line, under the volume track; the volume under the finger is passed on while dragging. Everything else is as it was.

```tsx
import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChoiceChip } from "@/components/ChoiceChip";
import { Icon } from "@/components/Icon";
import { ProgressScrubber } from "@/components/ProgressScrubber";
import { AMBIENT_SOUNDS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import type { AmbientSound } from "@/types";

const { nowPlaying } = copy;
const text = copy.profile.ambient;

const icons = {
  quieter: { android: "volume_down", ios: "speaker.fill" },
  louder: { android: "volume_up", ios: "speaker.wave.3.fill" },
  preview: { android: "play_circle", ios: "play.circle" },
  stop: { android: "stop_circle", ios: "stop.circle" },
} satisfies Record<string, SymbolViewProps["name"]>;

type AmbientPanelProps = {
  sound: AmbientSound;
  volume: number; // 0–1
  onChangeSound: (sound: AmbientSound) => void;
  // The finger lifted (or a screen reader moved the value): save this volume.
  onChangeVolume: (volume: number) => void;
  // A finger is on the volume track. The screen stops its ScrollView while it is, or Android's ScrollView takes
  // the drag once the finger drifts about 8dp vertically (found in step 12).
  onSeekingChange: (seeking: boolean) => void;
  // The preview (step 27): `previewing` while it plays, and `previewBlocked` while a devotional is playing, when there is
  // no preview. The volume under the finger is passed on while dragging, so a preview that is playing follows it.
  previewing: boolean;
  previewBlocked: boolean;
  onTogglePreview: () => void;
  onDragVolume: (volume: number) => void;
};

// What the Ambient Soundscape row opens in place: the same chips and volume as Now Playing, for the sound the
// next devotional starts with, and a short preview of it. The volume is dimmed and disabled while the sound is
// off, so the panel never changes height.
export function AmbientPanel({
  sound,
  volume,
  onChangeSound,
  onChangeVolume,
  onSeekingChange,
  previewing,
  previewBlocked,
  onTogglePreview,
  onDragVolume,
}: AmbientPanelProps) {
  // The volume under the finger while dragging. Only the end of the drag is saved.
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const shown = dragVolume ?? volume;
  const isOff = sound === "off";

  return (
    <View className="gap-3 pb-4 pl-[68px] pr-4">
      {/* The chips wrap instead of scrolling sideways, so none is hidden at large text or from a screen reader. */}
      <View className="flex-row flex-wrap gap-2">
        {AMBIENT_SOUNDS.map((value) => (
          <ChoiceChip
            key={value}
            label={copy.ambient.labels[value]}
            accessibilityLabel={nowPlaying.ambientChip(copy.ambient.labels[value])}
            selected={value === sound}
            onPress={() => onChangeSound(value)}
          />
        ))}
      </View>
      {/* Android fades each child on its own unless told to composite the group, which let the thumb show the fill's end through it.
          The row wraps: when the slider would get under 96dp (320dp wide at 1.3x text) the readout drops under it. */}
      <View
        needsOffscreenAlphaCompositing
        className={
          isOff
            ? "flex-row flex-wrap items-center gap-x-2.5 gap-y-1 opacity-40"
            : "flex-row flex-wrap items-center gap-x-2.5 gap-y-1"
        }
      >
        <Icon name={icons.quieter} size={16} color={colors.mauve} />
        <View className="min-w-[96px] flex-1">
          <ProgressScrubber
            value={shown}
            max={1}
            step={0.1}
            color={colors.rosewood}
            trackHeight={6}
            disabled={isOff}
            accessibilityLabel={nowPlaying.volume.label}
            formatValueText={(next) => nowPlaying.volume.text(Math.round(next * 100))}
            onSeekStart={() => onSeekingChange(true)}
            onSeekChange={(next) => {
              setDragVolume(next);
              onDragVolume(next);
            }}
            onSeekEnd={(next) => {
              setDragVolume(null);
              onSeekingChange(false);
              onChangeVolume(next);
            }}
          />
        </View>
        <Icon name={icons.louder} size={16} color={colors.mauve} />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="shrink-0 text-label-md text-mauve"
          style={styles.tabular}
        >
          {nowPlaying.volume.short(Math.round(shown * 100))}
        </Text>
      </View>
      {/* Nothing to preview while the sound is off. While a devotional plays the button stays in place, dimmed, with the reason under it. */}
      {isOff ? null : (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              previewing ? text.stopLabel : text.previewLabel(copy.ambient.labels[sound])
            }
            accessibilityState={{ disabled: previewBlocked }}
            disabled={previewBlocked}
            onPress={onTogglePreview}
            style={({ pressed }) => [
              styles.preview,
              pressed && styles.pressed,
              previewBlocked && styles.disabled,
            ]}
          >
            <View className="min-h-11 flex-row items-center gap-1.5">
              <Icon name={previewing ? icons.stop : icons.preview} size={18} color={colors.plum} />
              <Text className="text-label-md text-plum">{previewing ? text.stop : text.preview}</Text>
            </View>
          </Pressable>
          {previewBlocked ? (
            <Text className="text-body-sm text-mauve">{text.previewBlocked}</Text>
          ) : null}
        </View>
      )}
      <Text className="text-body-sm text-mauve">{text.helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
  preview: { alignSelf: "flex-start" },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
```

---

## 3. The checks the review created (`supabase/tests/ambient/`)

One file, already in the repo: `run.cjs` (**64 checks**). It runs the app's real TypeScript (the player store and its subscription, the ambient player, the recorder's call to it, `stop()`) on the step 26 world of `supabase/tests/playback/world.cjs`: fakes of expo-audio's iOS and Android players with their own reports, a virtual clock, a fake `AppState` and fake downloads. A player made from a `require()` number is an ambient loop there (`loop`, `volume`, `replace`; it starts again at its end with no "finished" report), and the system or a button can start and stop either player (`systemPlay`, `systemPause`). Each check has a real 20-second limit, and every check ends by asserting that the development log holds no link, path, id, title or name of a sound.

```
node --no-warnings supabase/tests/ambient/run.cjs                     # a few seconds
ONLY="bed(ios)" node --no-warnings supabase/tests/ambient/run.cjs      # one group while you work
FAILFAST=1 TIMINGS=1 node --no-warnings supabase/tests/ambient/run.cjs # stop at the first failure; milliseconds per check
GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/ambient/run.cjs
```

The groups are `gain:` (1), `bed(ios):` (29) and `bed(android):` (29: the same checks, each against that platform's reports: the bed waits for the voice and for its own file, fades in, out and in proportion, survives seeking, speed and a rebuffer of the voice, dips before another sound, lets go on Off, follows a pause, the end and another devotional, jumps away from the foreground, follows the lock screen, passes a stop or a start of its own player on to the devotional, ignores the reports around its own calls and a wait for data, stops at once for a take and at sign-out, recovers from a file that will not play, and the preview: 8 seconds, a new sound, Stop, Off, never over a devotional, ended by one, stopped in the background, a start after it never moving the devotional), `contract:` (3: the ambient player never touches the lock screen, the session or the speed, and only Profile, the recorder and the store import it; only `sounds.ts` names an audio file, one per sound, each its own file; the old markers are gone and both `ambient_changed` markers are there) and `files:` (2: each loop is an AAC `.m4a` of 60 to 90 seconds at 44.1 kHz, under 1.5 MB, with one audio track, read from its MP4 header; and `LICENSES.md` names a source, an author, an allowed license and no credit for each). The two `files:` checks read what you made in section 0, so they pass only once the loops and `LICENSES.md` are in.

### 3.1 The older checks (already edited in the repo)

Two of the older checks describe the code before this step. The review has edited them, so they show as modified in `git status`, and they are red until the code is in (section 0, point 3). Do not edit them again.

- `supabase/tests/playback/world.cjs` and `run.cjs` (131 passed, 2 failed before; 133 after). The fake player learned `loop`, `volume` and `replace`, a player made from a number is an ambient loop with a load time of its own (`flags.ambientLoadMs`, `flags.ambientFailNextLoads`), `AppState` keeps the state it last sent (React Native sets `currentState` before it calls the listeners), and an Android player reports `isLoaded` only while ExoPlayer is ready or ended, as `AudioPlayer.kt` does. The world gains `ambient()`, `ambients()` and `ambientService()`, and `live()` returns the newest devotional player only. The `contract:` check now expects two files that make a player (`src/services/ambientPlayer.ts` and `src/store/playerStore.ts`), and the logging check reads `ambientPlayer.ts` too.
- `supabase/tests/recording/run.cjs` (67 passed, 1 failed before; 68 after). The fake world has an `@/services/ambientPlayer` whose `stopAmbient` is counted (the real one cannot load in plain Node: `sounds.ts` imports audio files), and the start check expects one stop of the bed.

`supabase/tests/offline/`, `profile-sync/`, `journal-data/` and `process-entry/parity.cjs` are not touched: `account.ts` gains no import.

### 3.2 The breakages

56 deliberate breakages of the code (made by a runner kept outside the repo, because it edits a copy of the files): each makes one change in a scratch copy of the proven files and the test loops, runs the checks, and must be stopped by a check with a name. **All 56 were caught, none survived, none crashed a run.** By area: the gain 3 (not squared, not clamped, another maximum), the player 6 (no loop, a player that keeps the session, AirPlay taking the file, made loud, four reports a second, another sound never swapped in), the fades 9 (no fade in, a fade in that does not wait for the file, no fade out, a 300 ms fade, no dip before another sound, a new volume that waits, fades not in proportion, fading away from the foreground, a running fade left half done there), keeping and letting go 5 (Off keeping the player, a pause letting it go, the state changed after `pause()` instead of before, `stopAmbient` keeping the player or the preview), starts and stops from outside 12 (a stop or a start not passed on, a start after a preview passed on, no grace, a wait for data taken for a stop, a preview left on after its player stopped, a start nobody wants left playing, what was played never noted, the store ignoring a pause or a play or never answering, the app's own calls not noted), errors 3, the preview 9, the store 4 (the bed before the voice, the bed stopping during a rebuffer, `stop()` keeping the bed, the store never telling the bed), the recorder 1, and the files 4 (a sound mapped to another's file, a license that needs a credit, a NonCommercial license, a row missing). Two negative controls on the files: an MP3 renamed to `.m4a` fails as not an MP4, and a 92-second loop fails its length. The screens (Now Playing's save, Profile's Preview button and the panel) are not in this list: no check renders a screen. They are proven by the typecheck, the lint, the bundle and the phone walk-through.

---

## 4. AGENTS.md updates

**Already made in the review (do not repeat):** the vendor note "expo-audio 58: a second player, the ambient bed" (looping, one session for two players, Android's focus and per-player media session, `isLoaded` while buffering, JS timers away from the foreground).

**You make these, once the code is in and the checks pass.** AGENTS.md is CRLF: use the same kind of script as section 2, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them.

**4.1 Tech Stack.** In the `expo-audio` bullet, after "with background and lock-screen playback", add ", and since step 27 a second player that loops the ambient sound under the voice (`services/ambientPlayer.ts`)".

**4.2 Architecture tree.**
- The `assets/audio/` line becomes `assets/audio/ambient/`, described as: the three ambient loops (`soft-rain.m4a`, `gentle-piano.m4a`, `morning-birds.m4a`: AAC, 75 seconds, step 27) and `LICENSES.md` (each one's source, author and license).
- In the `constants/` entry, "Planned: sounds.ts" becomes "and from step 27 sounds.ts (the ambient loops by sound: the only file that imports one)", and the `audio.ts` list gains "since step 27 the ambient ones: `MAX_AMBIENT_GAIN`, `AMBIENT_FADE_IN_MS`, `AMBIENT_FADE_OUT_MS`, `AMBIENT_SWITCH_MS`, `AMBIENT_FADE_STEP_MS`, `AMBIENT_PREVIEW_MS`, `AMBIENT_UPDATE_MS` and `AMBIENT_REMOTE_GRACE_MS`".
- In the `services/` entry add "From step 27 ambientPlayer.ts (`setAmbientBed`, `setAmbientRemoteHandler`, `stopAmbient`, `previewAmbient`, `stopPreview`, `isPreviewing`, `subscribePreview` and `ambientGain`: the second player, which loops the ambient bed under the voice and plays Profile's preview)".
- In the `store/` entry, `playerStore.ts` gains "since step 27 its subscription drives the ambient bed, and `stop()` lets go of it".
- In the `components/` entry, `AmbientPanel` gains the props `previewing`, `previewBlocked`, `onTogglePreview` and `onDragVolume` (the Preview button).
- In the `tests/` entry add `ambient/` ("64 checks of the ambient bed and the preview, step 27, on the playback fakes, and of the shipped loops and their license table: `node --no-warnings supabase/tests/ambient/run.cjs`").

**4.3 Screen Specifications.** In 5 (Reflection), the Now Playing bullet: after the ambient card's description add "; since step 27 the chosen sound loops under the voice (it fades in when the voice is heard and out on a pause or the end) and a chosen sound or volume is saved as the default". In 7 (Profile): the PREFERENCES group gains "and from step 27 a Preview button under the volume (8 seconds of the default sound; dimmed with “Pause your devotional to preview.” while a devotional plays)", and the sentence "The ambient default is the sound the next devotional starts with" gains "; since step 27 a sound or volume chosen on Now Playing is saved as the default too".

**4.4 Audio Rules, "Ambient soundscape".** Replace its two bullets with these four (the heading becomes "Ambient soundscape (step 27)"):

- A bundled loop per sound (`assets/audio/ambient/{soft-rain,gentle-piano,morning-birds}.m4a`, imported only by `src/constants/sounds.ts`), mixed on the phone by a second `expo-audio` player (`services/ambientPlayer.ts`) and never part of the spoken devotional's file. Each loop is 75 seconds of AAC with a cross-faded seam, made at the voice's loudness (-22 LUFS) by the step 27 script; its source, author and license (CC0, the Pixabay Content License or the owner's own recording: never one that needs a credit, because there is no credits screen) are in `assets/audio/ambient/LICENSES.md`.
- The gain is the volume squared times `MAX_AMBIENT_GAIN` (0.35: about 9 dB under the voice at 100%). The bed fades in over 600 ms when the voice is heard, out over 800 ms on a pause, the end or another devotional, dips for 250 ms before another sound, and never fades away from the foreground (JS timers stop there on Android). It plays only with the voice (Profile's preview excepted), at 1x whatever the devotional's speed, never on the lock screen, and never calls `setAudioModeAsync`.
- The bed follows the player store; a take stops it at once; `stop()` (sign-out) lets go of it; Off lets go of its player. A start or stop of the bed's own player that the app did not ask for (an interruption, or on Android a headset or car button that reached its media session) becomes a play or pause of the devotional after a 1.5-second grace; a start after a preview never starts a devotional.
- Now Playing's chips and volume save the choice as the default (`updateProfile`: a chip when pressed, the volume when the finger lifts). Profile changes only the default, and its Preview plays the default for 8 seconds while no devotional plays.

**4.5 Linting and Validation.** In the "No Docker on this machine" bullet, after the playback checks, add: "The ambient checks are `node --no-warnings supabase/tests/ambient/run.cjs` (64 checks, a few seconds, the same switches), on the playback fakes (a player made from a `require()` number is an ambient loop); its two `files:` checks read the shipped loops and `LICENSES.md`, so they fail in a tree without them. The step 27 review faked `@/services/ambientPlayer` for the recorder checks." And in "Verifying on this machine", where `ffmpeg` is named, add that it also makes the ambient loops (step 27, section 0.5 of its prompt).

**4.6 Release gate.** Unchanged: `grep -rnE "TEMP\(|TODO: real" src | wc -l` still prints 13 (this step adds and removes no such marker). Say so in the log entry.

**4.7 `docs/legal-brief.md`** (CRLF). In section 1 add a bullet: "The app bundles three ambient sound loops (soft rain, gentle piano, morning birds) under licenses that allow a sold app and need no credit (CC0, the Pixabay Content License or the owner's own recording); each source, author and license is in `assets/audio/ambient/LICENSES.md`. They play on the phone and are never sent anywhere."

**4.8 Build Status & Decisions Log: a "Step 27 — Ambient soundscape" entry**, in the form of the steps before it: the decisions (this prompt's list and any you struck), the three sources with their licenses and the loop reports (length, size, loudness, true peak, seam), the files added and changed, the differences from this prompt, the measured results (the checks, the bundles with their asset sizes, the breakage smoke test), what the phone walk-through showed (B0 to B12, one line each, in your words and the user's), what was not verified, and the open items (the known limits of decision 14).

---

## 5. Rules

- No new dependency, no `any`, no new token, and no layout change beyond the Preview button and its line on Profile.
- Never download, generate or substitute a sound; use only the user's three files, under the licenses of section A, and record them in `LICENSES.md`. Never write a person's name or email into the repo (the repo is public: an own recording's author is "Gracehush").
- Never log a sound choice, a link, a path, a title or an id. The one development line in `ambientPlayer.ts` says that a sound could not be played, and nothing else.
- `createAudioPlayer` only in `src/store/playerStore.ts` and `src/services/ambientPlayer.ts`; `setAudioModeAsync` only in `src/services/audioSession.ts`; the ambient player never calls the lock screen or `setPlaybackRate`; no screen or component imports `expo-audio`. Every call into a native player is inside a `try`/`catch` (a released player throws on every call).
- The bed plays only with the voice, never before it, and the app never starts a devotional by itself: a start of the bed's player passes to the devotional only after the bed (finding 8).
- The Preview button makes no haptic (it is not a value picker; AGENTS.md "Haptics" lists the moments that tick).
- Do not edit `supabase/functions/`, `supabase/migrations/`, `package.json`, `package-lock.json` or `app.json`.
- Keep each file's line endings (the list is in section 2; the files in section 1, the loops' `LICENSES.md` and the tests are LF).

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **28 (notifications).** Nothing from this step: no `TODO(28)` is added, and a notification never starts the bed (it never starts playback at all).
- **31 (account).** `assets/audio/ambient/LICENSES.md` is where prompt 31 looks for it. No license in it needs a credit, so prompt 31's "show the ambient attribution lines" has nothing to show (keep it that way, or add a credits line if a later sound needs one). Deleting an account has nothing to delete for the bed: it is in the app, not in Storage.
- **34 (analytics).** Two markers: `TODO(34): ambient_changed { sound, source: 'now_playing' }` at the chip press in `NowPlayingScreen.tsx` (new) and `{ sound, source: 'profile' }` after a successful save in `ProfileScreen.tsx` (step 15). The volume and a preview are not events. Never with a user id.
- **35 (the iOS account).** In the development build check what Expo Go cannot show: the bed in the background and with the lock screen (its pause and play move both), the iOS loop seam again (Expo Go's expo-audio is older than 58.0.10), and on Android a headset button while both play (finding 8) and that only the devotional shows a media notification.
- **Upstream.** expo-audio gives every Android player a media session with no way to turn it off (limit 14 b). Worth an issue on `expo/expo` if a car display ever shows the bed's empty session.
- **Fast Refresh.** Editing `playerStore.ts` or `ambientPlayer.ts` while something plays leaves the old native players playing. After any edit of either, reload the app.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. Red first (section 0.3), then the sounds, the loops and `LICENSES.md` (section 0, points 4 to 6), then apply sections 1 and 2.
2. `npm run typecheck` and `npm run lint` exit 0. Read the whole output; nothing is disabled with a comment.
3. `node --no-warnings supabase/tests/ambient/run.cjs` ends `64 checks passed` (the two `files:` checks read your loops and `LICENSES.md`). Then the older ones: playback `133 checks passed`, recording `68 passed, 0 failed`, offline `44 of 44 passed`, profile-sync `88 passed, 0 failed` (about 35 seconds), journal-data `86 checks passed` (about a minute) and parity `7 of 7`. Put the last line of each in the report, and each loop's report from section 0.5.
4. `npx expo install --check` says "Dependencies are up to date" and `npx expo-doctor` passes. `git diff --stat -- package.json package-lock.json app.json` prints nothing.
5. Bundle both platforms, one at a time, to a folder outside the repo (host memory, AGENTS.md): `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform android --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then `ios`. Both exit 0. Each export's `assets/` holds the three loops (files of exactly their byte sizes), and each unminified bundle holds `Pause your devotional to preview.`, `Stop the preview`, `keepAudioSessionActive: false` and `setAmbientRemoteHandler`, and no `TODO(27)`. (The review's bundles, with three test loops of 1.21 to 1.24 MB: Android 10.80 MB and iOS 10.83 MB of JavaScript.) The development line "[ambient] the sound could not be played" is behind `__DEV__`, so a release bundle does not hold it. Do not export while the emulator and Metro are both running.
6. Greps, each with its result named:
   - `grep -rn "TODO(27)\|TEMP(27)" src` finds nothing;
   - `grep -rn "createAudioPlayer" src` finds only `src/services/ambientPlayer.ts` and `src/store/playerStore.ts`;
   - `grep -rn "setAudioModeAsync" src` finds only `src/services/audioSession.ts`;
   - `grep -rn "setActiveForLockScreen\|setPlaybackRate\|seekTo(" src/services/ambientPlayer.ts` finds nothing;
   - `grep -rn "@/assets/audio/" src` finds only `src/constants/sounds.ts`;
   - `grep -rn "console\." src/services/ambientPlayer.ts` finds only the `__DEV__` line;
   - `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 13, unchanged.
7. Line endings: the CRLF files of section 2 are still CRLF (`tr -cd '\r' < file | wc -c` equals the line count) and `git diff --stat` shows only real changes, no whole-file rewrites (the whole-file `AmbientPanel.tsx` keeps CRLF). The new files are LF.
8. **Breakage smoke test** (the review's run is in section 3.2; prove the checks are wired to *your* files). One at a time, make the break, run the group named, see that check fail by name, then restore the line (`git diff` shows nothing for it):
   - in `ambientPlayer.ts`, replace `created.loop = true;` by `created.loop = false;` (`ONLY="bed(ios)"`);
   - in `ambientPlayer.ts`, replace `  if (isLoaded()) fadeTo(1, AMBIENT_FADE_IN_MS);` by `  fadeTo(1, AMBIENT_FADE_IN_MS);` (`ONLY="opens slowly"`);
   - in `ambientPlayer.ts`, replace `  else if (bed.on) remoteHandler?.("pause");` by `  else if (false) remoteHandler?.("pause");` (`ONLY="paused the bed's own player"`);
   - in `ambientPlayer.ts`, replace `  if (served === "bed" && !bed.on) remoteHandler?.("play");` by `  if (!bed.on) remoteHandler?.("play");` (`ONLY="after a preview never starts"`);
   - in `ambientPlayer.ts`, replace `  if (ms < AMBIENT_FADE_STEP_MS || AppState.currentState !== "active") {` by `  if (ms < AMBIENT_FADE_STEP_MS) {` (`ONLY="away from the foreground"`);
   - in `playerStore.ts`, replace `  else if (!state.isBuffering) bedOn = true;` by `  else bedOn = true;` (`ONLY="only when the voice is heard"`);
   - in `playerStore.ts`, delete the line `    stopAmbient();` in `stop()` (`ONLY="signing out"`);
   - in `recorder.ts`, delete the line `  stopAmbient();` (`ONLY="a take stops"`, and the recording checks);
   - in `assets/audio/ambient/LICENSES.md`, change one row's license to `CC BY 4.0` and its credit to `Yes` (`ONLY="files:"`).
9. With the user's yes only (section C): boot the emulator as AGENTS.md says (Metro first, then the emulator; never against the real project without asking), with the Expo Go 58 APK installed, and play a devotional with a sound once. Put every override back and shut the emulator down.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", section B, checks B0 to B12. When Part A passes, the implementer asks whether to start it and waits for the answer (AGENTS.md); then it gives one action at a time, reads the app through the dev server's inspector (read-only), and writes the results into the log entry. B1 and B2 are the sound itself (the loops and the level), B3 to B5 the bed following the voice, B6 to B8 the outside world (Control Center, a headset, a recording), B9 the saved default, B10 the preview, B11 the sign-out.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; Android on a device or an emulator; the lock screen and background playback with the bed (Expo Go stops all sound when the phone locks: step 35); a headset or car button that reaches the bed's media session on Android (the checks model it; no device here can show it); a call; the native players themselves (what AVQueuePlayer and ExoPlayer do at the loop seam and in a call: the checks use fakes shaped from the sources); VoiceOver and TalkBack on the Preview button; and how the loops sound on a speaker, in headphones and in a car.

---

## 8. Report

Say, in this order and briefly: the three sounds (source, author, license, and each loop's report: length, size, loudness, true peak, seam); the files created, changed and replaced (one line each); that no package, migration, function, secret or `app.json` line changed; the `TODO(27)` list with how each was closed; the checks (typecheck, lint, the 64, the older ones, doctor, both bundles and what was found in them, the greps with their results, the breakages and which check named each); the phone walk-through results B0 to B12 (and any you did not get); the Android run if the user said yes; the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; what was not verified; the known limits and the question about the default level; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
