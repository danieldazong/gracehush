// The step 27 checks: the ambient bed under a devotional and Profile's preview. They run the app's real player store, ambient
// player, recorder and audio session in Node, on the step 26 fakes of expo-audio's iOS and Android players (playback/world.cjs),
// with a virtual clock, so a fade, a preview or a whole loop takes no real time. The last checks read the shipped files: the
// sound map, the license table and each loop's MP4 header.
//
//   node --no-warnings supabase/tests/ambient/run.cjs          (from the repo root; a few seconds)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/ambient/run.cjs
//
// What it cannot show is the sound: whether a loop clicks at its seam, how loud the bed is under the voice, and what a real
// headset or call does. Those are the phone checks in the step 27 prompt. Exit code 0 only when every check passes.
//   ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either);
//   FAILFAST=1 stops at the first failure; TIMINGS=1 prints how long each check took.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../playback/world.cjs");

const REPO = process.env.GRACEHUSH_REPO;
let passed = 0;
const failures = [];
const output = []; // everything the app wrote to the console during the current check
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => void output.push(args.map(String).join(" "));
}
let running = null;
let finished = false;
let stopped = false;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20_000;
process.on("exit", () => {
  if (finished) return;
  fs.writeSync(1, `${passed} passed, stopped while running: ${running}${String.fromCharCode(10)}`);
  process.exitCode = 1;
});

// What must never reach the development log: a link, a path, an entry id, a title, or the person's choice of sound.
const FORBIDDEN_IN_LOGS = ["https://", "file:///", "user_a", "entry-", "Peace in the midst", "soft-rain", "gentle-piano", "morning-birds"];

async function test(name, fn) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  output.length = 0;
  running = name;
  let limit;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished: a promise was never settled")), CHECK_LIMIT_MS);
      }),
    ]);
    for (const line of output) {
      for (const word of FORBIDDEN_IN_LOGS) assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    W.uninstallClock();
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const OFF = { ambientSound: "off", ambientVolume: 0.5 };
const RAIN = { ambientSound: "soft-rain", ambientVolume: 0.5 };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const last = (list) => list[list.length - 1];

function rig(options) {
  return W.world(options);
}
// The gain the app should reach for a volume, from the app's own constant.
function gainOf(w, volume) {
  return w.ambientService().ambientGain(volume);
}
// A devotional loaded and ready to play, with the given ambient choice copied from the profile.
async function loaded(w, ambient = RAIN, n = 1) {
  const store = w.store();
  store.getState().load(W.track(n), ambient);
  await W.advance(100);
  return store;
}
// Plays it and waits until the bed has faded all the way in (it waits for the voice, then for its own file).
async function heard(w, store) {
  store.getState().play();
  await W.advance(1000);
}
const volumesSince = (player, from) => player.volumes.filter(([at]) => at >= from).map(([, value]) => value);
const view = (store) => {
  const { entryId, status, isBuffering } = store.getState();
  return { entryId, status, isBuffering };
};

(async () => {
  // ============================================================ A. the gain
  await test("gain: 0 is silent, 1 is MAX_AMBIENT_GAIN, half is a quarter of it, and anything else is clamped", async () => {
    const w = rig();
    const { ambientGain } = w.ambientService();
    const { MAX_AMBIENT_GAIN } = w.env.use("@/constants/audio");
    assert.equal(MAX_AMBIENT_GAIN, 0.17);
    assert.equal(ambientGain(0), 0);
    assert.ok(near(ambientGain(1), 0.17));
    assert.ok(near(ambientGain(0.5), 0.0425));
    assert.ok(near(ambientGain(0.2), 0.0068));
    assert.equal(ambientGain(-1), 0);
    assert.ok(near(ambientGain(2), 0.17));
    assert.equal(ambientGain(Number.NaN), 0);
    assert.equal(ambientGain(Number.POSITIVE_INFINITY), 0);
  });

  for (const platform of ["ios", "android"]) {
    const tag = `bed(${platform})`;

    // ============================================================ B. the bed follows the voice
    await test(`${tag}: with the sound off, playing a devotional makes no ambient player`, async () => {
      const w = rig({ platform });
      const store = await loaded(w, OFF);
      await heard(w, store);
      assert.equal(view(store).status, "playing");
      assert.equal(w.ambients().length, 0);
    });

    await test(`${tag}: the bed comes in only when the voice is heard, as one looping player that fades up to its gain`, async () => {
      const w = rig({ platform });
      W.clock.now = 0;
      const store = w.store();
      // The devotional's file takes 3 seconds to download.
      w.fsScript.downloads.push({ ms: 3000 });
      store.getState().load(W.track(1), RAIN);
      store.getState().play();
      await W.advance(2000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", isBuffering: true });
      assert.equal(w.ambients().length, 0, "nothing under a voice that has not started");
      await W.advance(1100);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", isBuffering: false });
      const ambient = w.ambient();
      assert.ok(ambient, "the bed is made when the voice is heard");
      // The player is made silent: its first volume is the moment it was made.
      const [madeAt, firstVolume] = ambient.volumes[0];
      assert.equal(firstVolume, 0);
      assert.ok(madeAt >= 3000, "after the download");
      assert.equal(ambient.source, W.SOUNDS["soft-rain"]);
      assert.deepEqual(ambient.options, { updateInterval: 1000, keepAudioSessionActive: false, allowsExternalPlayback: false });
      assert.equal(ambient.loop, true);
      await W.advance(1000);
      const gain = gainOf(w, 0.5);
      assert.ok(near(ambient.volume, gain), `the bed reaches its gain: ${ambient.volume}`);
      const steps = volumesSince(ambient, madeAt).filter((value) => value > 0 && value < gain);
      assert.ok(steps.length >= 12 && steps.length <= 25, `a fade of about 20 steps: ${steps.length}`);
      for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] >= steps[i - 1], "the fade only rises");
      const reached = ambient.volumes.find(([, value]) => near(value, gain))[0];
      // The fade waits for the file to open (30 ms in this fake), then takes AMBIENT_FADE_IN_MS.
      assert.ok(reached - madeAt >= 600 && reached - madeAt <= 700, `in about AMBIENT_FADE_IN_MS: ${reached - madeAt} ms`);
      assert.equal(ambient.calls.play, 1);
      assert.deepEqual(ambient.calls.setActive, [], "never on the lock screen");
      assert.deepEqual(ambient.calls.setRate, [], "never another speed");
      assert.equal(w.live().calls.setActive.length, 1, "the devotional's player owns the lock screen");
    });

    await test(`${tag}: a file that opens slowly is still faded in from silence once it opens`, async () => {
      const w = rig({ platform });
      w.flags.ambientLoadMs = 500;
      const store = await loaded(w);
      store.getState().play();
      await W.advance(400);
      const ambient = w.ambient();
      assert.deepEqual(ambient.volumes.map(([, value]) => value).filter((value) => value > 0), [], "silent until it opens");
      await W.advance(200);
      assert.ok(ambient.volume < gainOf(w, 0.5) / 2, "the fade has only just begun");
      await W.advance(700);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
    });

    await test(`${tag}: pausing fades the bed out, then pauses it, and keeps its player for the next play`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      const from = W.clock.now;
      store.getState().pause();
      await W.advance(400);
      assert.ok(ambient.volume > 0 && ambient.volume < gainOf(w, 0.5), "half way out");
      assert.equal(ambient.calls.pause, 0, "still playing while it fades");
      await W.advance(500);
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.calls.pause, 1);
      assert.equal(ambient.sound, false);
      const out = volumesSince(ambient, from);
      for (let i = 1; i < out.length; i += 1) assert.ok(out[i] <= out[i - 1], "the fade only falls");
      assert.equal(ambient.released, false, "kept: the sound is still chosen");
      store.getState().play();
      await W.advance(800);
      assert.equal(w.ambients().length, 1, "the same player plays again");
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
      assert.equal(ambient.calls.play, 2);
    });

    await test(`${tag}: a pause half way through the fade in fades out in half the time`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      store.getState().play();
      // The file opens after 30 ms, then 300 of the 600 ms fade in: half way.
      await W.advance(330);
      const ambient = w.ambient();
      assert.ok(Math.abs(ambient.volume / gainOf(w, 0.5) - 0.5) < 0.06, `half way: ${ambient.volume}`);
      store.getState().pause();
      await W.advance(350);
      assert.equal(ambient.calls.pause, 0);
      await W.advance(100);
      assert.equal(ambient.calls.pause, 1, "half the fade out for half the level");
      assert.equal(ambient.volume, 0);
    });

    await test(`${tag}: a bed that waits for data is not taken for a stop`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      await W.advance(2000);
      const ambient = w.ambient();
      ambient.rebuffer(800);
      await W.advance(100);
      assert.equal(view(store).status, "playing");
      assert.equal(w.live().sound, true);
      await W.advance(1000);
      assert.equal(ambient.sound, true);
      assert.equal(ambient.calls.pause, 0);
    });

    await test(`${tag}: the end of the devotional fades the bed out and pauses it`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 4000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 4000 }), RAIN);
      await W.advance(100);
      await heard(w, store);
      const ambient = w.ambient();
      await W.advance(4500);
      assert.equal(view(store).status, "ended");
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.calls.pause, 1);
      assert.equal(ambient.sound, false);
    });

    await test(`${tag}: seeking, skipping and changing the speed never touch the bed`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      const before = { volumes: ambient.volumes.length, play: ambient.calls.play, pause: ambient.calls.pause };
      store.getState().seekTo(30_000);
      store.getState().skipBy(15_000);
      store.getState().setRate(1.2);
      store.getState().setRate(0.8);
      await W.advance(2000);
      assert.deepEqual(
        { volumes: ambient.volumes.length, play: ambient.calls.play, pause: ambient.calls.pause },
        before,
      );
      assert.deepEqual(ambient.calls.seekTo, []);
      assert.deepEqual(ambient.calls.setRate, []);
      assert.equal(ambient.rate, 1);
      assert.equal(ambient.sound, true);
    });

    await test(`${tag}: a voice that waits for data again keeps the bed playing`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      w.live().rebuffer(600);
      await W.advance(300);
      assert.equal(view(store).isBuffering, true);
      assert.equal(ambient.sound, true);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)), "not even a dip");
      await W.advance(800);
      assert.equal(view(store).isBuffering, false);
      assert.equal(ambient.calls.pause, 0);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
    });

    await test(`${tag}: another sound while it plays dips out, swaps the file in the same player, and fades the new one in`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      const from = W.clock.now;
      store.getState().setAmbient("gentle-piano");
      await W.advance(200);
      assert.deepEqual(ambient.calls.replace, [], "the old sound is still dipping out");
      await W.advance(100);
      assert.deepEqual(ambient.calls.replace, [W.SOUNDS["gentle-piano"]]);
      const swappedAt = ambient.volumes.findIndex(([at, value]) => at >= from && value === 0);
      assert.ok(swappedAt >= 0, "silent when the file is swapped");
      await W.advance(800);
      assert.equal(w.ambients().length, 1);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
      assert.equal(ambient.source, W.SOUNDS["gentle-piano"]);
      assert.equal(ambient.calls.pause, 0, "a swap is not a pause");
      assert.equal(view(store).status, "playing", "a swap never moves the devotional");
    });

    await test(`${tag}: a new volume while it plays is heard at once, and a fade that is running uses it`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      const count = ambient.volumes.length;
      store.getState().setAmbientVolume(1);
      assert.equal(ambient.volumes.length, count + 1, "one change, no ramp");
      assert.ok(near(ambient.volume, 0.17));
      store.getState().setAmbientVolume(0);
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.calls.pause, 0, "a volume of 0 is still the bed");
      // During a fade in.
      store.getState().setAmbientVolume(0.5);
      store.getState().pause();
      await W.advance(1000);
      store.getState().play();
      await W.advance(300);
      store.getState().setAmbientVolume(0.8);
      await W.advance(600);
      assert.ok(near(ambient.volume, gainOf(w, 0.8)));
    });

    await test(`${tag}: choosing Off while it plays fades it out and lets go of the player`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      store.getState().setAmbient("off");
      await W.advance(400);
      assert.equal(ambient.released, false, "still fading");
      await W.advance(500);
      assert.equal(ambient.calls.pause >= 1, true);
      assert.equal(ambient.released, true);
      assert.equal(view(store).status, "playing");
      store.getState().setAmbient("morning-birds");
      await W.advance(800);
      const birds = w.ambient();
      assert.notEqual(birds, ambient, "a new player for the next sound");
      assert.equal(birds.source, W.SOUNDS["morning-birds"]);
      assert.ok(near(birds.volume, gainOf(w, 0.5)));
    });

    await test(`${tag}: loading another devotional fades the bed out`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      store.getState().load(W.track(2), RAIN);
      await W.advance(900);
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.calls.pause, 1);
      assert.equal(ambient.released, false);
    });

    // ============================================================ C. away from the foreground, and the lock screen
    await test(`${tag}: away from the foreground a pause is at once, with no fade, and a fade that is running ends at once`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      w.appState.emit("background");
      // The lock screen pauses the devotional while the app is in the background.
      w.live().systemPause();
      assert.equal(view(store).status, "paused");
      assert.equal(ambient.volume, 0, "at once: JS timers may not run here");
      assert.equal(ambient.calls.pause, 1);
      w.live().systemPlay();
      assert.equal(view(store).status, "playing");
      assert.equal(ambient.sound, true);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)), "and comes in at once");
      // A fade that is running when the app leaves.
      w.appState.emit("active");
      store.getState().pause();
      await W.advance(200);
      assert.ok(ambient.volume > 0);
      w.appState.emit("background");
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.calls.pause, 2);
    });

    await test(`${tag}: the lock screen's pause and play move the bed with the devotional`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      w.live().systemPause();
      await W.advance(900);
      assert.equal(ambient.volume, 0);
      assert.equal(ambient.sound, false);
      w.live().systemPlay();
      await W.advance(700);
      assert.equal(ambient.sound, true);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
    });

    // ============================================================ D. a start or a stop that came from outside the app
    await test(`${tag}: a button that paused the bed's own player pauses the devotional too`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      await W.advance(2000);
      const ambient = w.ambient();
      const devotional = w.live();
      ambient.systemPause();
      assert.equal(view(store).status, "paused");
      assert.equal(devotional.sound, false);
      assert.equal(ambient.volume, 0, "left silent, so a start from outside is not heard");
      await W.advance(3000);
      assert.equal(view(store).status, "paused", "nothing starts again by itself");
      assert.equal(devotional.sound, false);
    });

    await test(`${tag}: a button that started the bed's player after the bed starts the devotional, and the bed comes back with the voice`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      store.getState().pause();
      await W.advance(3000);
      const ambient = w.ambient();
      assert.equal(ambient.volume, 0, "a paused bed is left silent");
      const from = W.clock.now;
      ambient.systemPlay();
      assert.equal(view(store).status, "playing");
      await W.advance(1000);
      assert.equal(w.live().sound, true, "the voice plays");
      assert.equal(ambient.sound, true);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
      const rise = volumesSince(ambient, from);
      assert.ok(rise.length >= 12, "it fades in");
      assert.ok(rise[0] < gainOf(w, 0.5) / 4, "from silence");
    });

    await test(`${tag}: a call stops both players and the system starts both again, and they stay in step`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      await W.advance(2000);
      const ambient = w.ambient();
      const devotional = w.live();
      ambient.systemPause();
      devotional.systemPause();
      assert.equal(view(store).status, "paused");
      await W.advance(5000);
      devotional.systemPlay();
      ambient.systemPlay();
      await W.advance(1000);
      assert.equal(view(store).status, "playing");
      assert.equal(devotional.sound, true);
      assert.equal(ambient.sound, true);
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
      // The other order.
      await W.advance(2000);
      devotional.systemPause();
      ambient.systemPause();
      await W.advance(5000);
      ambient.systemPlay();
      devotional.systemPlay();
      await W.advance(1000);
      assert.equal(view(store).status, "playing");
      assert.ok(near(ambient.volume, gainOf(w, 0.5)));
    });

    await test(`${tag}: reports sent around the app's own play and pause are not taken for a button`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      w.flags.reportLagMs = 300;
      await heard(w, store);
      await W.advance(2000);
      const ambient = w.ambient();
      store.getState().pause();
      await W.advance(3000);
      assert.equal(ambient.sound, false);
      assert.equal(view(store).status, "paused", "a late report of the bed playing does not start the devotional");
      assert.equal(w.live().sound, false);
    });

    await test(`${tag}: a sound that will not play is let go of, the devotional plays on, and it is tried again only after another choice`, async () => {
      const w = rig({ platform });
      w.flags.ambientFailNextLoads = 1;
      const store = await loaded(w);
      await heard(w, store);
      const first = w.ambients()[0];
      assert.equal(first.released, true);
      assert.equal(view(store).status, "playing");
      assert.deepEqual(output, ["[ambient] the sound could not be played"]);
      store.getState().pause();
      await W.advance(1000);
      store.getState().play();
      await W.advance(1000);
      assert.equal(w.ambients().length, 1, "the same sound is not tried again");
      store.getState().setAmbient("gentle-piano");
      await W.advance(1000);
      assert.equal(w.ambients().length, 2);
      assert.ok(near(w.ambient().volume, gainOf(w, 0.5)));
      // Chosen again later, it is tried again.
      store.getState().setAmbient("soft-rain");
      await W.advance(1500);
      assert.deepEqual(w.ambient().calls.replace, [W.SOUNDS["soft-rain"]]);
      assert.ok(near(w.ambient().volume, gainOf(w, 0.5)));
    });

    // ============================================================ E. a recording, and signing out
    await test(`${tag}: a take stops the bed at once, with no fade, and lets go of its player`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      await w.env.use("@/services/recorder").startRecording(() => undefined);
      assert.equal(ambient.released, true);
      assert.equal(ambient.sound, false);
      assert.equal(view(store).status, "paused");
      await W.advance(2000);
      assert.equal(w.ambient(), null, "nothing plays under the take");
      await w.env.use("@/services/recorder").cancelRecording();
      store.getState().play();
      await W.advance(1000);
      assert.ok(near(w.ambient().volume, gainOf(w, 0.5)), "a new player after the take");
    });

    await test(`${tag}: signing out (the store's stop) lets go of the bed and ends a preview at once`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const ambient = w.ambient();
      store.getState().stop();
      assert.equal(ambient.released, true);
      await W.advance(2000);
      assert.equal(w.ambient(), null);
      const service = w.ambientService();
      service.previewAmbient("soft-rain", 0.5);
      await W.advance(500);
      let ends = 0;
      service.subscribePreview(() => (ends += 1));
      store.getState().stop();
      assert.equal(service.isPreviewing(), false);
      assert.equal(ends, 1);
      assert.equal(w.ambient(), null);
    });

    // ============================================================ F. Profile's preview
    await test(`${tag}: a preview fades in, plays AMBIENT_PREVIEW_MS, fades out and stops by itself, and says when it starts and ends`, async () => {
      const w = rig({ platform });
      W.clock.now = 0;
      const service = w.ambientService();
      let changes = 0;
      const unsubscribe = service.subscribePreview(() => (changes += 1));
      service.previewAmbient("morning-birds", 0.5);
      assert.equal(service.isPreviewing(), true);
      assert.equal(changes, 1);
      const preview = w.ambient();
      assert.equal(preview.source, W.SOUNDS["morning-birds"]);
      await W.advance(1000);
      assert.ok(near(preview.volume, gainOf(w, 0.5)));
      await W.advance(6900);
      assert.equal(service.isPreviewing(), true);
      await W.advance(200);
      assert.equal(service.isPreviewing(), false, "8 seconds");
      assert.equal(changes, 2);
      await W.advance(900);
      assert.equal(last(preview.volumes)[1], 0);
      assert.equal(preview.released, true, "nothing else needs it");
      unsubscribe();
      service.previewAmbient("soft-rain", 0.5);
      assert.equal(changes, 2, "a listener that left hears nothing");
    });

    await test(`${tag}: a new sound during a preview plays its full time again, and a new volume is heard at once`, async () => {
      const w = rig({ platform });
      W.clock.now = 0;
      const service = w.ambientService();
      service.previewAmbient("soft-rain", 0.5);
      await W.advance(5000);
      service.previewAmbient("gentle-piano", 0.5);
      await W.advance(1200);
      const player = w.ambient();
      assert.deepEqual(player.calls.replace, [W.SOUNDS["gentle-piano"]]);
      await W.advance(5000);
      assert.equal(service.isPreviewing(), true, "11 seconds in, 6 after the new sound");
      const count = player.volumes.length;
      service.previewAmbient("gentle-piano", 1);
      assert.equal(player.volumes.length, count + 1);
      assert.ok(near(player.volume, 0.17));
      await W.advance(2000);
      assert.equal(service.isPreviewing(), false, "a volume change does not restart it");
    });

    await test(`${tag}: Stop fades the preview out, and Off stops it too`, async () => {
      const w = rig({ platform });
      const service = w.ambientService();
      service.previewAmbient("soft-rain", 0.5);
      await W.advance(1000);
      const player = w.ambient();
      service.stopPreview();
      assert.equal(service.isPreviewing(), false);
      await W.advance(400);
      assert.ok(player.volume > 0, "it fades");
      await W.advance(500);
      assert.equal(player.released, true);
      service.previewAmbient("gentle-piano", 0.5);
      await W.advance(1000);
      service.previewAmbient("off", 0.5);
      assert.equal(service.isPreviewing(), false);
      await W.advance(1000);
      assert.equal(w.ambient(), null);
      service.stopPreview();
    });

    await test(`${tag}: a preview never plays over a devotional, and a devotional that starts ends it`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      await heard(w, store);
      const service = w.ambientService();
      service.previewAmbient("morning-birds", 1);
      assert.equal(service.isPreviewing(), false);
      assert.equal(w.ambient().source, W.SOUNDS["soft-rain"], "the bed is untouched");
      assert.ok(near(w.ambient().volume, gainOf(w, 0.5)));
      // A preview, then the devotional starts (from the lock screen, say): the bed takes over in the same player.
      store.getState().pause();
      await W.advance(1000);
      service.previewAmbient("morning-birds", 1);
      await W.advance(1000);
      let ends = 0;
      service.subscribePreview(() => (ends += 1));
      w.live().systemPlay();
      assert.equal(service.isPreviewing(), false);
      assert.equal(ends, 1);
      await W.advance(1500);
      const player = w.ambient();
      assert.equal(w.ambients().length, 1);
      assert.equal(player.source, W.SOUNDS["soft-rain"], "the bed's sound is back");
      assert.ok(near(player.volume, gainOf(w, 0.5)));
    });

    await test(`${tag}: leaving the foreground stops a preview at once`, async () => {
      const w = rig({ platform });
      const service = w.ambientService();
      service.previewAmbient("soft-rain", 0.5);
      await W.advance(1000);
      const player = w.ambient();
      w.appState.emit("background");
      assert.equal(service.isPreviewing(), false);
      assert.equal(last(player.volumes)[1], 0);
      assert.equal(player.sound, false);
      assert.equal(player.released, true);
    });

    await test(`${tag}: a start of the ambient player after a preview never starts a devotional`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      const service = w.ambientService();
      service.previewAmbient("gentle-piano", 0.5);
      await W.advance(10_000);
      const player = w.ambient();
      assert.equal(player.sound, false);
      await W.advance(2000);
      player.systemPlay();
      assert.equal(view(store).status, "paused");
      assert.equal(w.live().sound, false);
      assert.equal(player.sound, false, "paused again at once");
      assert.equal(player.volume, 0);
      // A start that comes right after the app's own pause is only seen at the next report: it is paused then.
      const before = player.calls.pause;
      player.systemPlay();
      await W.advance(500);
      assert.equal(player.sound, true, "not seen yet");
      await W.advance(2000);
      assert.equal(player.sound, false, "paused at the next report");
      assert.equal(player.calls.pause, before + 1);
      assert.equal(view(store).status, "paused");
      assert.equal(w.live().calls.play, 0);
    });

    await test(`${tag}: a button that paused the preview's player ends the preview, and the devotional stays as it was`, async () => {
      const w = rig({ platform });
      const store = await loaded(w);
      const service = w.ambientService();
      service.previewAmbient("gentle-piano", 0.5);
      await W.advance(3000);
      w.ambient().systemPause();
      assert.equal(service.isPreviewing(), false);
      assert.equal(view(store).status, "paused");
      assert.equal(w.live().calls.play, 0);
    });
  }

  // ============================================================ G. the files and the rules, read from the source
  {
    const files = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    })(path.join(REPO, "src"));
    const rel = (file) => path.relative(REPO, file).split(path.sep).join("/");
    const mentioning = (pattern) => files.filter((file) => pattern.test(fs.readFileSync(file, "utf8"))).map(rel).sort();
    const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");
    const LOOPS = ["soft-rain", "gentle-piano", "morning-birds"];

    await test("contract: the ambient player never touches the lock screen, the audio session or the speed", () => {
      const text = read("src/services/ambientPlayer.ts");
      for (const call of ["setActiveForLockScreen", "updateLockScreenMetadata", "setAudioModeAsync", "setPlaybackRate", "seekTo("]) {
        assert.ok(!text.includes(call), `ambientPlayer.ts calls ${call}`);
      }
      assert.deepEqual(mentioning(/from "@\/services\/ambientPlayer"/), [
        "src/screens/profile/ProfileScreen.tsx",
        "src/services/recorder.ts",
        "src/store/playerStore.ts",
      ]);
    });

    await test("contract: only sounds.ts names an audio file, and it names one for every sound but Off", () => {
      assert.deepEqual(mentioning(/@\/assets\/audio\//), ["src/constants/sounds.ts"]);
      const text = read("src/constants/sounds.ts");
      const { AMBIENT_SOUNDS } = (() => {
        const w = rig();
        return w.env.use("@/constants/app");
      })();
      assert.deepEqual([...AMBIENT_SOUNDS].filter((sound) => sound !== "off"), LOOPS);
      // Each sound plays its own file: "soft-rain": softRain, and softRain is imported from soft-rain.m4a.
      const imports = new Map([...text.matchAll(/import (\w+) from "@\/assets\/audio\/ambient\/([\w-]+)\.m4a";/g)].map((m) => [m[1], m[2]]));
      const entries = [...text.matchAll(/^\s+"([\w-]+)": (\w+),$/gm)].map((m) => [m[1], m[2]]);
      assert.deepEqual(entries.map(([sound]) => sound).sort(), [...LOOPS].sort());
      for (const [sound, name] of entries) assert.equal(imports.get(name), sound, `${sound} plays ${imports.get(name)}.m4a`);
    });

    await test("contract: the old markers are gone", () => {
      assert.deepEqual(mentioning(/TODO\(27\)/), []);
      assert.ok(mentioning(/TODO\(34\): ambient_changed \{ sound, source: 'now_playing' \}/).includes("src/screens/journal/NowPlayingScreen.tsx"));
      assert.ok(mentioning(/TODO\(34\): ambient_changed \{ sound, source: 'profile' \}/).includes("src/screens/profile/ProfileScreen.tsx"));
    });

    // The shipped loops (made in step 27 from the user's sources): an AAC .m4a each, 60 to 90 seconds, under 1.5 MB.
    function readMp4(buffer) {
      const out = { brands: [], codecs: [], timescale: null, duration: null, channels: null, rate: null };
      const walk = (start, end, depth) => {
        let at = start;
        while (at + 8 <= end) {
          let size = buffer.readUInt32BE(at);
          const type = buffer.toString("latin1", at + 4, at + 8);
          let header = 8;
          if (size === 1) {
            size = Number(buffer.readBigUInt64BE(at + 8));
            header = 16;
          } else if (size === 0) size = end - at;
          if (size < header || at + size > end) throw new Error(`a broken box: ${type}`);
          const body = at + header;
          if (type === "ftyp") {
            out.brands.push(buffer.toString("latin1", body, body + 4));
            for (let i = body + 8; i + 4 <= at + size; i += 4) out.brands.push(buffer.toString("latin1", i, i + 4));
          } else if (type === "mvhd") {
            const version = buffer.readUInt8(body);
            out.timescale = buffer.readUInt32BE(body + (version === 1 ? 20 : 12));
            out.duration = version === 1 ? Number(buffer.readBigUInt64BE(body + 24)) : buffer.readUInt32BE(body + 16);
          } else if (type === "stsd") {
            walk(body + 8, at + size, depth + 1);
          } else if (type === "mp4a") {
            out.codecs.push("mp4a");
            out.channels = buffer.readUInt16BE(body + 16);
            out.rate = buffer.readUInt32BE(body + 24) >>> 16;
          } else if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) {
            walk(body, at + size, depth + 1);
          } else if (depth > 0 && type !== "stsd" && type.startsWith("mp4") === false) {
            // Other sample entries (a video track, say) are named but not read.
            if (depth >= 6) out.codecs.push(type);
          }
          at += size;
        }
      };
      walk(0, buffer.length, 0);
      return out;
    }

    await test("files: every loop is an AAC .m4a of 60 to 90 seconds, under 1.5 MB, with one audio track", () => {
      for (const sound of LOOPS) {
        const file = path.join(REPO, "assets", "audio", "ambient", `${sound}.m4a`);
        assert.ok(fs.existsSync(file), `${sound}.m4a is in assets/audio/ambient/`);
        const buffer = fs.readFileSync(file);
        assert.ok(buffer.length <= 1_500_000, `${sound}.m4a is ${buffer.length} bytes`);
        const mp4 = readMp4(buffer);
        assert.ok(mp4.brands.includes("M4A ") || mp4.brands.includes("isom") || mp4.brands.includes("mp42"), `${sound}: an MP4 file`);
        assert.deepEqual(mp4.codecs, ["mp4a"], `${sound}: one AAC track and nothing else`);
        const seconds = mp4.duration / mp4.timescale;
        assert.ok(seconds >= 60 && seconds <= 90, `${sound}.m4a lasts ${seconds.toFixed(2)} s`);
        assert.ok(mp4.channels === 1 || mp4.channels === 2, `${sound}: mono or stereo`);
        assert.equal(mp4.rate, 44_100, `${sound}: 44.1 kHz`);
      }
    });

    await test("files: LICENSES.md names a source, an allowed license and no credit for every loop", () => {
      const file = path.join(REPO, "assets", "audio", "ambient", "LICENSES.md");
      assert.ok(fs.existsSync(file), "assets/audio/ambient/LICENSES.md exists");
      // The first table of the file: the one whose header starts with "Sound | File".
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      const first = lines.findIndex((line) => /^\|\s*Sound\s*\|\s*File\s*\|/.test(line));
      assert.ok(first >= 0, "a table with the columns Sound, File, Source, Author, License, Credit required");
      const table = [];
      for (let i = first; i < lines.length && lines[i].startsWith("|"); i += 1) table.push(lines[i]);
      const rows = table
        .filter((line) => !/^\|\s*-/.test(line))
        .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
      const header = rows.shift();
      assert.deepEqual(header, ["Sound", "File", "Source", "Author", "License", "Credit required"]);
      const ALLOWED = ["CC0 1.0", "Pixabay Content License", "Own recording"];
      assert.deepEqual(rows.map((row) => row[0]).sort(), [...LOOPS].sort());
      for (const [sound, name, source, author, license, credit] of rows) {
        assert.equal(name, `${sound}.m4a`);
        assert.ok(/^https:\/\/\S+$/.test(source) || (license === "Own recording" && source === "Own recording"), `${sound}: a source page`);
        assert.ok(author.length > 0, `${sound}: an author`);
        assert.ok(ALLOWED.includes(license), `${sound}: ${license} is not an allowed license`);
        assert.equal(credit, "No", `${sound}: a license that needs a credit is not used in this step`);
      }
    });
  }

  // ------------------------------------------------------------------ done
  finished = true;
  console.log = (...args) => fs.writeSync(1, `${args.map(String).join(" ")}${String.fromCharCode(10)}`);
  console.log(`${passed} checks passed${failures.length > 0 ? `, ${failures.length} FAILED` : ""}`);
  if (failures.length > 0) {
    console.log(failures.map((failure) => `  FAIL ${failure}`).join(String.fromCharCode(10)));
    process.exit(1);
  }
})().catch((error) => {
  fs.writeSync(1, `THE RUN CRASHED ${String(error && error.stack ? error.stack : error)}${String.fromCharCode(10)}`);
  process.exit(1);
});
