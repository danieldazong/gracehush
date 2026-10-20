# 27-ambient-soundscape.md

Read AGENTS.md first and follow it strictly.

Add the ambient sound bed for devotionals: a second expo-audio player
that loops a bundled sound under the devotional, mixed on the device.
Wire it to the step 12 store fields (ambientSound, ambientVolume), the
Now Playing ambient card, the Profile ambient default (step 15/18) and a
short Profile preview. The server MP3 (step 22) stays voice-only. Screens
keep their exact look.

AGENTS.md requires approval before adding assets you don't have rights
to, adding dependencies and changing native config. No new dependencies
are expected. No migrations.

Docs (source of truth, follow exactly):

- https://docs.expo.dev/versions/latest/sdk/audio/
  (createAudioPlayer with a local require() source, loop, volume,
  play/pause/seekTo, release, playbackStatusUpdate)

---

## 1. Before writing code

1. Read src/store/playerStore.ts and src/services/lockScreen.ts (step
   26), src/services/audioSession.ts, src/screens/NowPlayingScreen.tsx
   (ambient card, // TODO(27)), src/screens/ProfileScreen.tsx (ambient
   section, // TODO(27)), src/data/journalRepository.ts (updateProfile),
   src/types/index.ts (AmbientSound union), src/constants/app.ts and
   src/services/account.ts.
2. List every AmbientSound value except 'off'. For each one, check
   assets/audio/ambient/ for {value}.m4a. If any file is missing, stop
   and ask the user to provide it with its source and license. Never
   download, generate or substitute a sound.
3. Ask the user for each file's source and license, and write them to
   assets/audio/ambient/LICENSES.md:
   | sound | file | source | license | attribution required |
   If any license requires attribution, add the credit line to
   PROFILE legal copy (copy.ts) and show it in the Profile Legal
   section under the existing BSB credit (step 20 TODO(31) line) as
   plain DM Sans 12 mauve text.
4. Check each file: mono or stereo AAC .m4a, 60–90 seconds, under
   1.5 MB. Report duration and size. If a file is larger, a different
   format or clicks at the loop point (listen to the join), report it
   and ask the user for a corrected file. Do not re-encode audio
   yourself.

---

## 2. Constants: src/constants/ambient.ts

export const AMBIENT_SOURCES: Record<Exclude<AmbientSound, 'off'>,
number> = { <value>: require('../../assets/audio/ambient/<value>.m4a'),
... };
export const AMBIENT_LABELS: Record<AmbientSound, string>
// display names from copy.ts; 'off' → "None"
export const MAX_AMBIENT_GAIN = 0.35;
export const AMBIENT_FADE_IN_MS = 600;
export const AMBIENT_FADE_OUT_MS = 800;
export const AMBIENT_PREVIEW_MS = 8000;
export function ambientGain(volume: number): number
// clamp(volume, 0, 1) \*_ 2 _ MAX_AMBIENT_GAIN

- The Record type makes TypeScript fail if a sound value has no file.
- Unit test ambientGain: 0 → 0, 1 → 0.35, 0.5 → 0.0875, out of range
  clamps.

---

## 3. Ambient player: src/services/ambientPlayer.ts

setAmbient(sound: AmbientSound): void
setAmbientVolume(volume: number): void
startAmbient(opts?: { fade?: boolean }): void
pauseAmbient(opts?: { fade?: boolean }): void
stopAmbient(): void
previewAmbient(sound, volume): void
stopPreview(): void
releaseAmbient(): void

Rules:

- One player, module scope: createAudioPlayer(source) only when the
  first non-'off' sound is needed. loop = true. Never call
  setActiveForLockScreen on it.
- setAmbient: 'off' → stopAmbient. Another sound → player.replace(the
  new source), keep looping, and keep playing if it was playing (fade
  in). Only the selected sound is loaded.
- Volume always = ambientGain(volume) × fade factor. setAmbientVolume
  applies at once (no fade).
- Fades: one ramp at a time, about 30 ms steps with setTimeout; a new
  ramp cancels the old one. Fade out ends with pause().
- AppState not 'active' → skip fades: set the final volume and
  play/pause immediately (JS timers are throttled in the background).
- The ambient playback rate is always 1.0, whatever the devotional
  speed.
- Seeking the devotional never touches the ambient player.
- Errors: log the category in **DEV** only; the devotional keeps
  playing without ambient sound.

---

## 4. Store wiring: src/store/playerStore.ts

Keep every field and action. Remove // TODO(27) markers you close.

- Devotional status → ambient:
  playing → startAmbient({ fade: true }) when ambientSound ≠ 'off'
  paused / idle → pauseAmbient({ fade: true })
  ended → pauseAmbient({ fade: true }) and ambient seek to 0
  buffering → no change
  Drive this from the step 26 status listener, so lock-screen and
  headphone controls also move the ambient player.
- setAmbient(sound) and setAmbientVolume(v) update the store, call the
  ambient player, and save as the user's default:
  debounced 800 ms updateProfile({ ambientSound, ambientVolume })
  (step 18 columns). Failure → keep the session value, no error on the
  player screens, retry on the next change. Close the step 12
  // TODO(27): persist ambient choice.
- load() keeps the step 12 rule: ambient values come from the profile
  the first time; later loads keep the session values (which now match
  the saved default).
- stop() → stopAmbient().
- Recording starts (audioSession 'recording', step 26) → the store's
  pause() already runs, so ambient pauses with it. Confirm.

---

## 5. Now Playing (step 12 ambient card)

- No layout change. The switch, chips and volume ProgressScrubber now
  drive the store actions in section 4.
- Remove the step 12 // TODO(27): play ambient bed comment.
- Helper text stays "Soft sound beneath your devotional."

---

## 6. Profile preview (step 15 ambient section)

- Add a small text button "Preview" (plum, DM Sans Medium 13) to the
  right of the ambient chips, per the existing row style. Hidden when
  the sound is 'off'. accessibilityLabel "Preview {sound label}".
- Tap → previewAmbient(selected, volume): fade in, play
  AMBIENT_PREVIEW_MS, fade out, stop. The button shows "Stop" while
  previewing; tapping it stops with a fade.
- Changing the chip or volume during a preview updates the preview.
- Disabled (opacity 0.5, not focusable) while a devotional is playing,
  with the helper "Pause your devotional to preview."
- The preview stops on blur (useFocusEffect cleanup), app background
  and sign out.
- Saving the default still never changes a devotional already playing
  (step 15 rule): Profile changes call updateProfile only, not the
  store actions. Close the step 15 // TODO(27).

---

## 7. Cleanup

signOutCleanup: stopPreview(), stopAmbient(), releaseAmbient().

---

## 8. Rules

- No new dependencies, no `any`, no layout changes except the Preview
  button and its helper line.
- No remote ambient files. No sound without a license entry.
- Never log sound choices with user ids. Allowed: error categories.
- // TODO(34): ambient_changed { sound, source: 'now_playing' |
  'profile' }.

---

## 9. AGENTS.md updates

- Audio Rules: ambient is a bundled loop per AmbientSound value, mixed
  on device, never baked into the MP3; max gain 0.35 with a squared
  curve; plays only with the devotional (preview excepted); not
  registered with the lock screen; licenses in
  assets/audio/ambient/LICENSES.md.
- Profile: Now Playing ambient changes save as the default.

---

## 10. Verify (dev build, physical iPhone and Android phone)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Each sound plays under the devotional with no click at the loop
   point (listen through two loops).
2. Volume at 100%: the voice is still clearly louder than the ambient
   sound. At 0%: silent.
3. Play / pause / end: ambient fades in and out with the devotional.
4. Seek and change speed: ambient is unaffected.
5. Lock screen pause and play: ambient follows instantly.
6. Background on Android for 4+ minutes: both keep playing.
7. Start a recording: both pause.
8. Change sound in Now Playing, kill and reopen: the new default is
   saved (check users_profile) and used next time.
9. Profile preview: 8 seconds with fades, stops on leaving Profile,
   disabled while a devotional plays.
10. Ambient 'off': nothing loads (no ambient player created).
11. Sign out while playing: everything stops and releases.

Report: sounds and file details; LICENSES.md contents; any attribution
added; files created and changed; test results 1–11; and every TODO
left for step 34.
