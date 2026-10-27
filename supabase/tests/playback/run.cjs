// The step 26 checks: playing a devotional. They run the app's real player store, audio session, devotional files and lock
// screen in Node, on fakes of expo-audio's AudioPlayer (shaped like the iOS and the Android player: they say "waiting for
// data" in different words), expo-file-system's download, Storage's signed links and expo-asset (world.cjs), with a virtual
// clock, so a download, a buffering pause or the end of a devotional takes no real time.
//
//   node --no-warnings supabase/tests/playback/run.cjs         (from the repo root; about 10 seconds)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/playback/run.cjs
//
// It needs no device, no emulator and no Supabase project. What it cannot show is the native player itself: how iOS or
// Android really behave when a call comes in, what the lock screen draws, and how the sound is. Those are the phone
// checks in the step 26 prompt. Exit code 0 only when every check passes.
//   ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either);
//   FAILFAST=1 stops at the first failure; TIMINGS=1 prints how long each check took.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("./world.cjs");
const { StorageApiError, StorageUnknownError } = W.storageJs;

let passed = 0;
const failures = [];
const output = []; // everything the app wrote to the console during the current check
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => void output.push(args.map(String).join(" "));
}
let running = null;
let finished = false;
let stopped = false;
// The real timers, taken before any check installs the virtual clock: a check that waits for something that never happens
// must fail by name, not leave Node to exit quietly with nothing printed.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20_000;
process.on("exit", () => {
  if (finished) return;
  fs.writeSync(1, `${passed} passed, stopped while running: ${running}${String.fromCharCode(10)}`);
  process.exitCode = 1;
});

// What must never reach the development log: a link, a path, an entry id, a title.
const FORBIDDEN_IN_LOGS = ["https://", "token=", "file:///", "user_a", "entry-", "Peace in the midst", "devotionals/"];

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
const AMBIENT = { ambientSound: "off", ambientVolume: 0.5 };
const FILE = (n) => `file:///cache/devotionals/entry-${n}.wav`;
const PATH = (n) => `user_a/devotionals/entry-${n}.wav`;
const MODE_FIELDS = ["allowsBackgroundRecording", "allowsRecording", "interruptionMode", "playsInSilentMode", "shouldPlayInBackground", "shouldRouteThroughEarpiece"];

function rig(options) {
  return W.world(options);
}
const view = (store) => {
  const { entryId, status, positionMs, isBuffering, error } = store.getState();
  return { entryId, status, positionMs, isBuffering, error };
};
// A devotional loaded and ready: the session, the file, the player and the lock screen are all done.
async function ready(w, n = 1) {
  const store = w.store();
  store.getState().load(W.track(n), AMBIENT);
  await W.advance(100);
  return { store, player: w.live() };
}
// Plays it and lets `ms` of the devotional go by.
async function playFor(w, store, ms) {
  store.getState().play();
  await W.advance(ms);
}
const storageApi = (status, statusCode, message = "m", code) => new StorageApiError(message, status, statusCode, "storage", code);

(async () => {
  // ============================================================ A. the audio session
  await test("session: the playback mode sets all six fields", async () => {
    const w = rig();
    const { setSessionMode } = w.env.use("@/services/audioSession");
    assert.equal(await setSessionMode("playback"), true);
    assert.deepEqual(w.modes(), [
      {
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        allowsRecording: false,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      },
    ]);
  });

  await test("session: the recording mode sets all six fields, with the microphone on and playing in the background off", async () => {
    const w = rig();
    const { setSessionMode } = w.env.use("@/services/audioSession");
    await setSessionMode("recording");
    assert.deepEqual(w.modes(), [
      {
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        allowsRecording: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      },
    ]);
  });

  await test("session: every call carries every field, and a repeated mode is set again", async () => {
    const w = rig();
    const { setSessionMode } = w.env.use("@/services/audioSession");
    await setSessionMode("playback");
    await setSessionMode("recording");
    await setSessionMode("recording");
    await setSessionMode("playback");
    assert.equal(w.modes().length, 4);
    assert.deepEqual(w.modes().map((mode) => mode.allowsRecording), [false, true, true, false]);
    for (const mode of w.modes()) assert.deepEqual(Object.keys(mode).sort(), MODE_FIELDS);
  });

  await test("session: a mode that cannot be set is reported, never thrown, and asked for again next time", async () => {
    const w = rig();
    const { setSessionMode } = w.env.use("@/services/audioSession");
    w.flags.failMode = true;
    assert.equal(await setSessionMode("playback"), false);
    assert.equal(w.modes().length, 0);
    w.flags.failMode = false;
    assert.equal(await setSessionMode("playback"), true);
    assert.equal(w.modes().length, 1);
    // The warning names the mode and nothing else.
    assert.ok(output.every((line) => line === "[audio] the playback session mode could not be set"), output.join(" | "));
  });

  // ============================================================ B. the devotional file
  {
    const entryId = "entry-1";
    const link = (w) => w.env.use("@/services/devotionalAudio");

    await test("file: the failure of a link request is read from what Storage answered", async () => {
      const w = rig();
      const { toStorageFailure } = link(w);
      const { NoSessionError } = w.env.use("@/utils/supabaseErrors");
      // A missing object is HTTP 400 with a body that says 404; newer builds send a real 404.
      assert.equal(toStorageFailure(storageApi(400, "404", "The object cannot be found")), "NOT_FOUND");
      assert.equal(toStorageFailure(storageApi(404, "404")), "NOT_FOUND");
      assert.equal(toStorageFailure(storageApi(404, "400")), "NOT_FOUND");
      assert.equal(toStorageFailure(storageApi(401, "401")), "UNAUTHORIZED");
      assert.equal(toStorageFailure(storageApi(403, "403")), "UNAUTHORIZED");
      assert.equal(toStorageFailure(storageApi(400, "400", "Invalid JWT")), "UNKNOWN");
      assert.equal(toStorageFailure(storageApi(500, "500")), "UNKNOWN");
      assert.equal(toStorageFailure(new StorageUnknownError("Network request failed", new TypeError("Network request failed"))), "NETWORK");
      assert.equal(toStorageFailure(new StorageUnknownError("x", new NoSessionError())), "UNAUTHORIZED");
      assert.equal(toStorageFailure(new NoSessionError()), "UNAUTHORIZED");
      assert.equal(toStorageFailure(new TypeError("Network request failed")), "NETWORK");
      assert.equal(toStorageFailure("weird"), "NETWORK");
    });

    await test("file: the failure of a download is read from its message: a status means the server answered", async () => {
      const w = rig();
      const { toDownloadFailure } = link(w);
      assert.equal(toDownloadFailure(new Error("Unable to download file: response has status 403")), "UNAUTHORIZED");
      assert.equal(toDownloadFailure(new Error("response has status 401")), "UNAUTHORIZED");
      assert.equal(toDownloadFailure(new Error("response has status: 404")), "NOT_FOUND");
      assert.equal(toDownloadFailure(new Error("HTTP 500")), "UNKNOWN");
      assert.equal(toDownloadFailure(new Error("response has status 400")), "UNKNOWN");
      assert.equal(toDownloadFailure(new Error("The Internet connection appears to be offline.")), "NETWORK");
      assert.equal(toDownloadFailure(new Error("no response")), "NETWORK");
      assert.equal(toDownloadFailure(new Error("Download failed")), "NETWORK");
      assert.equal(toDownloadFailure("not an error"), "NETWORK");
    });

    await test("file: a devotional is downloaded once, with a five-minute link, and played from the phone after that", async () => {
      const w = rig();
      const first = await link(w).getDevotionalFile(entryId, PATH(1));
      assert.deepEqual(first, { ok: true, uri: FILE(1) });
      assert.deepEqual(w.supa.calls.signed, [{ bucket: "journal_media", path: PATH(1), seconds: 300 }]);
      assert.equal(w.fsCalls.downloads.length, 1);
      const download = w.fsCalls.downloads[0];
      assert.match(download.url, /^https:\/\/project\.example\/storage\/v1\/object\/sign\/journal_media\/user_a\/devotionals\/entry-1\.wav\?token=/);
      assert.equal(download.to, `${FILE(1)}.part`);
      assert.equal(download.options.idempotent, true);
      assert.ok(download.options.signal instanceof AbortSignal);
      assert.ok(w.fs.has(FILE(1)));
      assert.ok(!w.fs.has(`${FILE(1)}.part`), "the part is moved into place");
      const again = await link(w).getDevotionalFile(entryId, PATH(1));
      assert.deepEqual(again, { ok: true, uri: FILE(1) });
      assert.equal(w.supa.calls.signed.length, 1, "no second link");
      assert.equal(w.fsCalls.downloads.length, 1, "no second download");
    });

    await test("file: a saved file too small to be audio is replaced by a fresh download", async () => {
      const w = rig();
      w.fs.dirs.add("file:///cache/devotionals");
      w.fs.put(FILE(1), 100);
      const result = await link(w).getDevotionalFile(entryId, PATH(1));
      assert.deepEqual(result, { ok: true, uri: FILE(1) });
      assert.equal(w.fsCalls.downloads.length, 1);
      assert.ok(w.fs.files.get(FILE(1)).bytes.length >= 1024);
    });

    await test("file: an entry id that is not a plain id is never turned into a path", async () => {
      const w = rig();
      for (const bad of ["../x", "a/b", "", "x".repeat(81), "a b", "a.wav"]) {
        assert.deepEqual(await link(w).getDevotionalFile(bad, PATH(1)), { ok: false, code: "UNKNOWN" }, JSON.stringify(bad));
      }
      assert.equal(w.supa.calls.signed.length, 0);
      assert.equal(w.fsCalls.downloads.length, 0);
      link(w).forgetDevotionalFile("../x");
    });

    await test("file: two requests for the same devotional share one download", async () => {
      const w = rig();
      w.fsScript.downloads.push({ ms: 500 });
      const a = link(w).getDevotionalFile(entryId, PATH(1));
      const b = link(w).getDevotionalFile(entryId, PATH(1));
      await W.advance(600);
      assert.deepEqual(await a, { ok: true, uri: FILE(1) });
      assert.deepEqual(await b, { ok: true, uri: FILE(1) });
      assert.equal(w.supa.calls.signed.length, 1);
      assert.equal(w.fsCalls.downloads.length, 1);
    });

    await test("file: while the phone is known to be offline a saved devotional still plays, and one not saved answers NETWORK at once with no link asked", async () => {
      const w = rig();
      const net = w.env.use("@/store/offlineStore").useOfflineStore;
      assert.deepEqual(await link(w).getDevotionalFile(entryId, PATH(1)), { ok: true, uri: FILE(1) });
      net.getState().setNet(false, false);
      assert.deepEqual(await link(w).getDevotionalFile(entryId, PATH(1)), { ok: true, uri: FILE(1) });
      assert.deepEqual(await link(w).getDevotionalFile("entry-2", PATH(2)), { ok: false, code: "NETWORK" });
      // Connected to a network that does not reach the internet is the same.
      net.getState().setNet(true, false);
      assert.deepEqual(await link(w).getDevotionalFile("entry-2", PATH(2)), { ok: false, code: "NETWORK" });
      assert.equal(w.supa.calls.signed.length, 1, "no link asked while offline");
      assert.equal(w.fsCalls.downloads.length, 1);
      // A failed request elsewhere is not NetInfo: it does not stop a download.
      net.getState().setNet(true, true);
      net.getState().setUnreachable(true);
      assert.deepEqual(await link(w).getDevotionalFile("entry-2", PATH(2)), { ok: true, uri: FILE(2) });
      assert.equal(w.fsCalls.downloads.length, 2);
    });

    await test("file: a link that has not come after 15 seconds answers NETWORK, and its late answer is never used", async () => {
      const w = rig();
      let release;
      w.supa.script.signed.push(() => new Promise((resolve) => (release = resolve)));
      let settled = null;
      void link(w).getDevotionalFile(entryId, PATH(1)).then((result) => (settled = result));
      await W.advance(14_900);
      assert.equal(settled, null, "still waiting at 14.9 s");
      await W.advance(200);
      assert.deepEqual(settled, { ok: false, code: "NETWORK" });
      release({ data: { signedUrl: "https://project.example/storage/v1/object/sign/late?token=x" }, error: null });
      await W.advance(1000);
      assert.equal(w.fsCalls.downloads.length, 0, "the late link starts no download");
      assert.ok(!w.fs.has(FILE(1)));
      // Asked again, it asks for a new link and downloads.
      assert.deepEqual(await link(w).getDevotionalFile(entryId, PATH(1)), { ok: true, uri: FILE(1) });
      assert.equal(w.supa.calls.signed.length, 2);
    });

    await test("file: every way the audio cannot be had has a code, and leaves nothing behind", async () => {
      const w = rig();
      const get = () => link(w).getDevotionalFile(entryId, PATH(1));
      const left = () => [...w.fs.files.keys()];
      const { NoSessionError } = w.env.use("@/utils/supabaseErrors");

      // The object is not there.
      w.supa.script.signed.push({ data: null, error: storageApi(400, "404", "Object not found") });
      assert.deepEqual(await get(), { ok: false, code: "NOT_FOUND" });
      assert.equal(w.fsCalls.downloads.length, 0, "no download without a link");

      // Nobody is signed in.
      const client = w.session.client;
      w.session.client = null;
      assert.deepEqual(await get(), { ok: false, code: "UNAUTHORIZED" });
      assert.equal(w.supa.calls.signed.length, 1, "no request was made");
      w.session.client = client;

      // The link cannot be asked for: no connection, or no token.
      w.supa.script.signed.push({ data: null, error: new StorageUnknownError("Network request failed", new TypeError("Network request failed")) });
      assert.deepEqual(await get(), { ok: false, code: "NETWORK" });
      w.supa.script.signed.push(() => {
        throw new NoSessionError();
      });
      assert.deepEqual(await get(), { ok: false, code: "UNAUTHORIZED" });
      w.supa.script.signed.push({ data: null, error: null });
      assert.deepEqual(await get(), { ok: false, code: "UNKNOWN" });

      // The download itself fails: offline, refused, and Android's half-written file.
      w.fsScript.downloads.push({ error: "The Internet connection appears to be offline." });
      assert.deepEqual(await get(), { ok: false, code: "NETWORK" });
      w.fsScript.downloads.push({ error: "Unable to download file: response has status 403" });
      assert.deepEqual(await get(), { ok: false, code: "UNAUTHORIZED" });
      w.fsScript.downloads.push({ partial: 20_000, error: "Download failed" });
      assert.deepEqual(await get(), { ok: false, code: "NETWORK" });
      assert.deepEqual(left(), [], "a half-written file never stays");

      // A download that is not audio.
      w.fsScript.downloads.push({ bytes: 100 });
      assert.deepEqual(await get(), { ok: false, code: "UNKNOWN" });
      assert.deepEqual(left(), []);

      // And the same entry works once the trouble is over.
      assert.deepEqual(await get(), { ok: true, uri: FILE(1) });
    });

    await test("file: only the newest twelve downloads are kept", async () => {
      const w = rig();
      for (let n = 1; n <= 14; n += 1) {
        const result = await link(w).getDevotionalFile(`entry-${n}`, PATH(n));
        assert.equal(result.ok, true);
        await W.advance(1000); // each file gets its own modification time
      }
      const kept = [...w.fs.files.keys()].filter((uri) => uri.endsWith(".wav")).sort();
      assert.deepEqual(kept, Array.from({ length: 12 }, (_, i) => FILE(i + 3)).sort());
    });

    await test("file: an unfinished download left by an earlier run is cleared, a running one is not", async () => {
      const w = rig();
      w.fs.dirs.add("file:///cache/devotionals");
      w.fs.put("file:///cache/devotionals/entry-9.wav.part", 5000);
      w.fs.put("file:///cache/devotionals/entry-2.wav.part", 5000);
      w.fsScript.downloads.push({ ms: 5000 }); // entry-2 is downloading while entry-1 finishes
      const slow = link(w).getDevotionalFile("entry-2", PATH(2));
      await W.advance(10);
      assert.deepEqual(await link(w).getDevotionalFile("entry-1", PATH(1)), { ok: true, uri: FILE(1) });
      assert.ok(!w.fs.has("file:///cache/devotionals/entry-9.wav.part"), "the old part is gone");
      assert.ok(w.fs.has("file:///cache/devotionals/entry-2.wav.part"), "the running download's part stays");
      await W.advance(6000);
      assert.deepEqual(await slow, { ok: true, uri: FILE(2) });
    });

    await test("file: a file the player could not open is forgotten, so the next request downloads it again", async () => {
      const w = rig();
      await link(w).getDevotionalFile(entryId, PATH(1));
      link(w).forgetDevotionalFile(entryId);
      assert.ok(!w.fs.has(FILE(1)));
      link(w).forgetDevotionalFile(entryId); // nothing to forget: no error
      await link(w).getDevotionalFile(entryId, PATH(1));
      assert.equal(w.fsCalls.downloads.length, 2);
    });

    await test("file: signing out deletes every file and stops the downloads that are running", async () => {
      const w = rig();
      await link(w).getDevotionalFile("entry-1", PATH(1));
      await link(w).getDevotionalFile("entry-2", PATH(2));
      w.fsScript.downloads.push({ ms: 5000 });
      const running_ = link(w).getDevotionalFile("entry-3", PATH(3));
      await W.advance(10);
      await link(w).deleteAllDevotionalAudio();
      assert.ok(w.fsCalls.downloads[2].options.signal.aborted, "the running download was told to stop");
      assert.deepEqual(await running_, { ok: false, code: "UNKNOWN" });
      assert.deepEqual([...w.fs.files.keys()], []);
      assert.ok(!w.fs.dirs.has("file:///cache/devotionals"));
      // Everything works again for the next account.
      assert.deepEqual(await link(w).getDevotionalFile("entry-4", PATH(4)), { ok: true, uri: FILE(4) });
    });

    await test("file: a download that finishes after sign-out throws away what it got", async () => {
      const w = rig();
      // An answer that was already on its way when the abort came (the abort cannot always reach the phone in time).
      w.fsScript.downloads.push({ ms: 3000, ignoreAbort: true });
      const late = link(w).getDevotionalFile(entryId, PATH(1));
      await W.advance(100);
      await link(w).deleteAllDevotionalAudio();
      await W.advance(4000);
      assert.deepEqual(await late, { ok: false, code: "UNKNOWN" });
      assert.deepEqual([...w.fs.files.keys()], [], "nothing outlives the session");
    });

    await test("file: nothing is logged", async () => {
      const w = rig();
      w.fsScript.downloads.push({ error: "The Internet connection appears to be offline." });
      await link(w).getDevotionalFile(entryId, PATH(1));
      await link(w).getDevotionalFile(entryId, PATH(1));
      link(w).forgetDevotionalFile(entryId);
      await link(w).deleteAllDevotionalAudio();
      assert.deepEqual(output, []);
    });
  }

  // ============================================================ C. the lock screen
  {
    const lock = (w) => w.env.use("@/services/lockScreen");
    const OPTIONS = { showSeekForward: true, showSeekBackward: true, seekForwardIntervalSeconds: 15, seekBackwardIntervalSeconds: 15 };
    const newPlayer = (w) => w.expoAudio.createAudioPlayer({ uri: "file:///x.wav" }, {});
    const info = { title: "Peace in the midst", subtitle: "Gracehush • Psalm 23:1–3" };

    await test("lock: the controls appear at once with the title and the reference, and the artwork follows", async () => {
      const w = rig();
      const player = newPlayer(w);
      lock(w).activateLockScreen(player, info);
      assert.equal(player.calls.setActive.length, 1);
      assert.deepEqual(player.calls.setActive[0], {
        active: true,
        metadata: { title: "Peace in the midst", artist: "Gracehush • Psalm 23:1–3" },
        options: OPTIONS,
      });
      assert.equal(player.calls.updateMeta.length, 0, "the artwork is not waited for");
      await W.advance(10);
      assert.deepEqual(player.calls.updateMeta, [
        { title: "Peace in the midst", artist: "Gracehush • Psalm 23:1–3", artworkUrl: "file:///assets/player-artwork.png" },
      ]);
      assert.deepEqual(w.asset.calls.fromModule, [7], "the bundled picture of constants/images");
    });

    await test("lock: a second devotional gets the artwork in its first call, with no second lookup", async () => {
      const w = rig();
      const a = newPlayer(w);
      lock(w).activateLockScreen(a, info);
      await W.advance(10);
      const b = newPlayer(w);
      lock(w).activateLockScreen(b, info);
      assert.equal(b.calls.setActive[0].metadata.artworkUrl, "file:///assets/player-artwork.png");
      await W.advance(10);
      assert.equal(b.calls.updateMeta.length, 0);
      assert.equal(w.asset.calls.downloads, 1);
    });

    await test("lock: the lock screen shows the title and the reference and nothing else", async () => {
      const w = rig();
      const player = newPlayer(w);
      lock(w).activateLockScreen(player, { ...info, transcript: "my words", emotion: "Anxious" });
      await W.advance(10);
      for (const metadata of [player.calls.setActive[0].metadata, player.calls.updateMeta[0]]) {
        assert.deepEqual(Object.keys(metadata).sort(), ["artist", "artworkUrl", "title"].filter((key) => key in metadata));
        assert.ok(!JSON.stringify(metadata).includes("my words"));
        assert.ok(!JSON.stringify(metadata).includes("Anxious"));
      }
    });

    await test("lock: a picture that cannot be loaded changes nothing and is tried again with the next devotional", async () => {
      const w = rig();
      w.flags.artworkFails = true;
      const a = newPlayer(w);
      lock(w).activateLockScreen(a, info);
      await W.advance(10);
      assert.equal(a.calls.updateMeta.length, 0);
      assert.equal(a.calls.setActive.length, 1);
      w.flags.artworkFails = false;
      const b = newPlayer(w);
      lock(w).activateLockScreen(b, info);
      await W.advance(10);
      assert.equal(b.calls.updateMeta.length, 1);
      assert.equal(w.asset.calls.downloads, 2);
    });

    await test("lock: a lock screen that cannot be set up never throws, and the artwork is not looked up for it", async () => {
      const w = rig();
      w.flags.setActiveThrows = true;
      const player = newPlayer(w);
      lock(w).activateLockScreen(player, info);
      await W.advance(10);
      assert.equal(w.asset.calls.downloads, 0);
      // A player released while its picture was loading.
      w.flags.setActiveThrows = false;
      w.flags.artworkMs = 50;
      const other = newPlayer(w);
      lock(w).activateLockScreen(other, info);
      other.release();
      await W.advance(100);
      lock(w).clearLockScreen(other); // already released: no error either
    });

    await test("lock: clearing takes the player off the lock screen", async () => {
      const w = rig();
      const player = newPlayer(w);
      lock(w).activateLockScreen(player, info);
      lock(w).clearLockScreen(player);
      assert.equal(player.calls.clear, 1);
    });
  }

  // ============================================================ D. the player store, on both platforms
  for (const platform of ["ios", "android"]) {
    const tag = `store(${platform})`;

    await test(`${tag}: load shows the devotional at once and prepares its audio in the background`, async () => {
      const w = rig({ platform });
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      assert.deepEqual(
        { ...view(store), title: store.getState().title, subtitle: store.getState().subtitle, durationMs: store.getState().durationMs },
        { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null, title: "Peace in the midst 1", subtitle: "Gracehush • Psalm 23:1–3", durationMs: 113_200 },
      );
      assert.equal(w.players.length, 0, "nothing is made until the file is on the phone");
      await W.advance(100);
      assert.equal(w.players.length, 1);
      const [player] = w.players;
      assert.deepEqual(w.created[0].source, { uri: FILE(1) });
      assert.deepEqual(w.created[0].options, { updateInterval: 250, keepAudioSessionActive: true, allowsExternalPlayback: false });
      assert.equal(w.modes().length, 1, "the playback mode, set before the player is made");
      assert.equal(w.modes()[0].allowsRecording, false);
      assert.deepEqual(player.calls.setRate, [[1, "high"]], "the voice keeps its pitch");
      assert.equal(player.calls.setActive.length, 1);
      assert.equal(player.calls.setActive[0].metadata.title, "Peace in the midst 1");
      assert.equal(player.calls.play, 0, "loading never starts the sound");
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
    });

    await test(`${tag}: loading the same devotional again does nothing`, async () => {
      const w = rig({ platform });
      const { store } = await ready(w);
      await playFor(w, store, 1000);
      assert.equal(view(store).positionMs, 1000);
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100);
      assert.equal(w.players.length, 1);
      assert.equal(w.fsCalls.downloads.length, 1);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 1000, isBuffering: false, error: null });
    });

    await test(`${tag}: play starts the sound, the position follows the player, pause holds it`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().play();
      assert.equal(player.calls.play, 1);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: false, error: null });
      await W.advance(1000);
      assert.equal(store.getState().positionMs, 1000);
      await W.advance(2600);
      assert.equal(store.getState().positionMs, 3500, "the last report was 100 ms ago");
      w.flags.reportLagMs = 120; // the report of the pause reaches the app a moment after the pause
      store.getState().pause();
      assert.equal(player.calls.pause, 1);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 3600, isBuffering: false, error: null }, "paused where the player is, not where the last report was");
      await W.advance(3000);
      assert.equal(store.getState().positionMs, 3600, "nothing moves while paused");
      store.getState().toggle();
      assert.equal(view(store).status, "playing");
      store.getState().toggle();
      assert.equal(view(store).status, "paused");
    });

    await test(`${tag}: play before the audio is ready shows playing with a spinner and starts by itself`, async () => {
      const w = rig({ platform });
      const store = w.store();
      w.fsScript.downloads.push({ ms: 2000 });
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: true, error: null });
      await W.advance(1500);
      assert.equal(w.players.length, 0, "still downloading");
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: true, error: null });
      await W.advance(1000);
      const player = w.live();
      assert.equal(player.calls.play, 1);
      assert.deepEqual(view(store).status, "playing");
      assert.equal(view(store).isBuffering, false);
      // The sound began when the player loaded, about 30 ms after the download ended at 2000: 1.5 s of listening so far.
      await W.advance(1000);
      assert.equal(store.getState().positionMs, 1250);
    });

    await test(`${tag}: pausing while the audio is still being made means nothing starts when it is ready`, async () => {
      const w = rig({ platform });
      const store = w.store();
      w.fsScript.downloads.push({ ms: 2000 });
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      store.getState().pause();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      await W.advance(5000);
      assert.equal(w.live().calls.play, 0);
      assert.equal(view(store).status, "paused");
    });

    await test(`${tag}: a wait for data after play shows a spinner until the sound starts`, async () => {
      const w = rig({ platform });
      w.flags.bufferMs = 800;
      const { store, player } = await ready(w);
      store.getState().play();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: true, error: null });
      await W.advance(500);
      assert.equal(view(store).isBuffering, true);
      assert.equal(store.getState().positionMs, 0);
      await W.advance(400);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: false, error: null });
      assert.equal(player.calls.play, 1);
      await W.advance(250);
      assert.equal(store.getState().positionMs, 250);
    });

    await test(`${tag}: another app or the system pausing the sound shows paused, and starting it shows playing`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 2000);
      // A call, Siri, an alarm, a headset unplugged or the lock screen's pause: the player pauses by itself.
      player.systemPause();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 2000, isBuffering: false, error: null });
      await W.advance(3000);
      assert.equal(store.getState().positionMs, 2000);
      // The call ends and the system resumes it, or the lock screen's play: nobody asked the app.
      player.systemPlay();
      assert.equal(view(store).status, "playing");
      await W.advance(1000);
      assert.equal(store.getState().positionMs, 3000);
      // It was started by someone else and is paused by someone else again: the screens follow both.
      player.systemPause();
      assert.equal(view(store).status, "paused");
      player.systemPlay();
      assert.equal(view(store).status, "playing");
      // And it can be paused from the app.
      store.getState().pause();
      assert.equal(player.sound, false);
      assert.equal(view(store).status, "paused");
    });

    await test(`${tag}: skipping from the lock screen moves the position while playing`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 2000);
      player.remoteSkip(15);
      assert.equal(store.getState().positionMs, 17_000);
      await W.advance(500);
      assert.equal(store.getState().positionMs, 17_500);
      player.remoteSkip(-15);
      assert.equal(store.getState().positionMs, 2500);
    });

    await test(`${tag}: seeking moves the player and keeps playing; a late report cannot undo it`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      store.getState().seekTo(60_000);
      assert.equal(store.getState().positionMs, 60_000, "the screen follows at once");
      assert.deepEqual(player.calls.seekTo, [60]);
      // A report sent just before the seek finished still has the old position.
      player.emitRaw({ ...player._status(), currentTime: 1.25, playing: true, timeControlStatus: "playing", playbackState: "ready" });
      assert.equal(store.getState().positionMs, 60_000);
      await W.advance(30);
      assert.equal(view(store).status, "playing");
      assert.ok(store.getState().positionMs >= 60_000 && store.getState().positionMs < 61_000);
      await W.advance(1000);
      assert.ok(store.getState().positionMs > 60_900 && store.getState().positionMs < 62_000, String(store.getState().positionMs));
    });

    await test(`${tag}: seeking while paused stays paused; a position chosen before the audio is ready is applied when it is`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().seekTo(30_000);
      assert.equal(view(store).status, "paused");
      await W.advance(50);
      assert.deepEqual(player.calls.seekTo, [30]);
      assert.equal(player.currentTime, 30);
      assert.equal(store.getState().positionMs, 30_000);

      const w2 = rig({ platform });
      const store2 = w2.store();
      w2.fsScript.downloads.push({ ms: 1000 });
      store2.getState().load(W.track(1), AMBIENT);
      store2.getState().seekTo(45_000);
      assert.equal(store2.getState().positionMs, 45_000);
      await W.advance(1200);
      const player2 = w2.live();
      assert.deepEqual(player2.calls.seekTo, [45]);
      assert.equal(player2.calls.play, 0);
      assert.equal(store2.getState().positionMs, 45_000);
      assert.equal(store2.getState().status, "paused");
    });

    await test(`${tag}: skipping 15 seconds clamps at both ends, and past the end it is finished`, async () => {
      const w = rig({ platform });
      const { store } = await ready(w);
      store.getState().skipBy(-15_000);
      assert.equal(store.getState().positionMs, 0);
      store.getState().skipBy(15_000);
      assert.equal(store.getState().positionMs, 15_000);
      store.getState().seekTo(100_000);
      store.getState().skipBy(15_000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "ended", positionMs: 113_200, isBuffering: false, error: null });
    });

    await test(`${tag}: playing to the end finishes it, rewinds the player behind it, and plays again from the start`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 3000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 3000 }), AMBIENT);
      await W.advance(100);
      const player = w.live();
      store.getState().play();
      await W.advance(3500);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "ended", positionMs: 3000, isBuffering: false, error: null });
      assert.equal(player.sound, false);
      assert.equal(player.currentTime, 0, "rewound, so Play on the lock screen plays it again");
      assert.equal(player.wants, false, "and paused, so it does not start by itself");
      await W.advance(2000);
      assert.equal(store.getState().positionMs, 3000, "the screen keeps the end");
      store.getState().play();
      assert.equal(store.getState().positionMs, 0);
      assert.equal(view(store).status, "playing");
      await W.advance(1100);
      assert.equal(view(store).status, "playing");
      assert.equal(store.getState().positionMs, 1000);
    });

    await test(`${tag}: playing again after the end from the lock screen starts from the beginning`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 3000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 3000 }), AMBIENT);
      await W.advance(100);
      const player = w.live();
      await playFor(w, store, 3500);
      assert.equal(view(store).status, "ended");
      player.systemPlay();
      assert.equal(view(store).status, "playing");
      await W.advance(500);
      assert.equal(store.getState().positionMs, 500);
    });

    await test(`${tag}: seeking to the end finishes it, and seeking back from the end pauses at that place`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      store.getState().seekTo(113_200);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "ended", positionMs: 113_200, isBuffering: false, error: null });
      await W.advance(100);
      assert.equal(player.sound, false);
      assert.equal(player.currentTime, 0);
      store.getState().seekTo(50_000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 50_000, isBuffering: false, error: null });
      await W.advance(50);
      assert.equal(player.currentTime, 50);
      assert.equal(player.sound, false);
      store.getState().play();
      await W.advance(500);
      assert.equal(store.getState().positionMs, 50_500);
    });

    await test(`${tag}: the speed goes to the player now and to every later player`, async () => {
      const w = rig({ platform });
      const store = w.store();
      store.getState().setRate(1.2); // no player yet: nothing to throw
      assert.equal(store.getState().rate, 1.2);
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100);
      const first = w.live();
      assert.deepEqual(first.calls.setRate, [[1.2, "high"]]);
      await playFor(w, store, 1000);
      assert.equal(store.getState().positionMs, 1200, "1.2x: a second of time is 1.2 seconds of devotional");
      store.getState().setRate(0.8);
      assert.deepEqual(first.calls.setRate.at(-1), [0.8, "high"]);
      store.getState().load(W.track(2), AMBIENT);
      await W.advance(100);
      assert.deepEqual(w.live().calls.setRate, [[0.8, "high"]], "the session's speed, not 1");
      assert.equal(store.getState().rate, 0.8);
    });

    await test(`${tag}: a stale "paused" report right after play corrects itself with the next report`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().play();
      // A report built just before play() arrives just after it.
      player.emitRaw({ ...player._status(), playing: false, timeControlStatus: "paused", playbackState: platform === "ios" ? "readyToPlay" : "ready", isBuffering: false, currentTime: 0 });
      assert.equal(view(store).status, "paused");
      await W.advance(250);
      assert.equal(view(store).status, "playing", "the next report from the playing player says so");
      assert.equal(store.getState().positionMs, 250);
    });

    await test(`${tag}: a player that is not playing and is not asked to play changes nothing but the position`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().seekTo(10_000);
      await W.advance(50);
      player.emitRaw({ ...player._status(), isBuffering: true, timeControlStatus: platform === "ios" ? "waitingToPlayAtSpecifiedRate" : "paused", playbackState: platform === "ios" ? "readyToPlay" : "buffering" });
      assert.equal(view(store).status, "paused");
      assert.equal(view(store).isBuffering, false);
    });

    await test(`${tag}: reports before the file is loaded change nothing`, async () => {
      const w = rig({ platform });
      w.flags.loadMs = 500;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100);
      const player = w.live();
      player.emitRaw({ ...player._status(), playing: true, timeControlStatus: "playing", playbackState: "ready", currentTime: 9 });
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
    });

    await test(`${tag}: an error from the player while playing pauses with "unavailable", and play fetches a fresh copy`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      player.failNow("The operation could not be completed");
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 1000, isBuffering: false, error: "unavailable" });
      store.getState().play();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 1000, isBuffering: true, error: null });
      await W.advance(200);
      assert.equal(w.fsCalls.downloads.length, 2, "the copy that failed was thrown away and fetched again");
      assert.equal(player.released, true);
      const fresh = w.live();
      assert.notEqual(fresh, player);
      assert.equal(fresh.calls.play, 1);
      assert.equal(view(store).status, "playing");
      assert.equal(view(store).error, null);
      assert.ok(fresh.calls.seekTo.length >= 1 && fresh.calls.seekTo[0] === 1, "back where it was");
    });

    await test(`${tag}: a file the player cannot open is fetched again once, and then it is unavailable, not endless`, async () => {
      const w = rig({ platform });
      w.flags.failNextLoads = 1;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(300);
      assert.equal(w.fsCalls.downloads.length, 2);
      assert.equal(w.players.length, 2);
      assert.equal(w.players[0].released, true);
      assert.equal(view(store).error, null);
      assert.equal(w.live().calls.setActive.length, 1);
      // A late report of the player that was let go of cannot touch the new one (it would end the new one's wait).
      w.players[0].lastListener({ ...w.players[0]._status(), error: "late" });
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      store.getState().play();
      await W.advance(100);
      assert.equal(w.live().calls.play, 1);

      const w2 = rig({ platform });
      w2.flags.failNextLoads = 5;
      const store2 = w2.store();
      store2.getState().load(W.track(1), AMBIENT);
      await W.advance(600);
      assert.equal(w2.players.length, 2, "one more try, not more");
      assert.equal(w2.live(), null, "no player is kept");
      assert.deepEqual(view(store2), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "unavailable" });
    });

    await test(`${tag}: a player that never says it has loaded is given up on after ten seconds`, async () => {
      const w = rig({ platform });
      w.flags.loadNever = true;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(9000);
      assert.equal(view(store).error, null);
      await W.advance(2000);
      await W.advance(11_000); // the fresh copy's player never loads either
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "unavailable" });
      assert.equal(w.live(), null);
    });

    await test(`${tag}: a player that cannot be made is unavailable`, async () => {
      const w = rig({ platform });
      w.flags.createThrows = true;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(300);
      assert.equal(view(store).error, "unavailable");
      assert.equal(view(store).status, "paused");
    });

    await test(`${tag}: no connection says "offline", and play tries again without a new load`, async () => {
      const w = rig({ platform });
      w.fsScript.downloads.push({ error: "The Internet connection appears to be offline." });
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "offline" });
      assert.equal(w.players.length, 0);
      store.getState().play();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 0, isBuffering: true, error: null });
      await W.advance(200);
      assert.equal(view(store).error, null);
      assert.equal(w.live().calls.play, 1);
      await W.advance(1000);
      assert.equal(store.getState().positionMs, 1000);
    });

    await test(`${tag}: known to be offline, play says "offline" at once and nothing starts when the connection returns`, async () => {
      const w = rig({ platform });
      const net = w.env.use("@/store/offlineStore").useOfflineStore;
      net.getState().setNet(false, false);
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      await W.advance(100);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "offline" });
      assert.equal(w.supa.calls.signed.length, 0);
      net.getState().setNet(true, true);
      await W.advance(60_000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "offline" });
      assert.equal(w.players.length, 0);
      // Pressed again once the connection is back, it plays.
      store.getState().play();
      await W.advance(300);
      assert.equal(view(store).status, "playing");
      assert.equal(view(store).error, null);
    });

    await test(`${tag}: a link that never comes stops the spinner after 15 seconds, and its late answer starts nothing`, async () => {
      const w = rig({ platform });
      let release;
      w.supa.script.signed.push(() => new Promise((resolve) => (release = resolve)));
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      await W.advance(14_000);
      assert.equal(view(store).isBuffering, true);
      assert.equal(view(store).status, "playing");
      await W.advance(1_100);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: "offline" });
      release({ data: { signedUrl: "https://project.example/storage/v1/object/sign/late?token=x" }, error: null });
      await W.advance(60_000);
      assert.equal(view(store).status, "paused");
      assert.equal(w.players.length, 0);
      assert.equal(w.fsCalls.downloads.length, 0);
    });

    await test(`${tag}: a missing file and a refused link are "unavailable"`, async () => {
      const w = rig({ platform });
      w.supa.script.signed.push({ data: null, error: storageApi(400, "404", "Object not found") });
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100);
      assert.equal(view(store).error, "unavailable");
      w.supa.script.signed.push({ data: null, error: storageApi(403, "403") });
      store.getState().play();
      await W.advance(100);
      assert.equal(view(store).error, "unavailable");
      assert.equal(view(store).status, "paused");
      assert.equal(view(store).isBuffering, false);
    });

    await test(`${tag}: loading another devotional stops the old one, clears its lock screen and releases it`, async () => {
      const w = rig({ platform });
      const { store, player: first } = await ready(w, 1);
      await playFor(w, store, 2000);
      store.getState().load(W.track(2), AMBIENT);
      assert.equal(first.released, true);
      assert.equal(first.calls.clear, 1);
      assert.equal(first.sound, false);
      assert.equal(first.listeners.length, 0, "its listener was taken off");
      assert.deepEqual(view(store), { entryId: "entry-2", status: "paused", positionMs: 0, isBuffering: false, error: null });
      await W.advance(100);
      const second = w.live();
      assert.notEqual(second, first);
      assert.equal(w.players.filter((player) => !player.released).length, 1, "one player is alive");
      assert.equal(second.calls.play, 0);
      assert.equal(second.calls.setActive[0].metadata.title, "Peace in the midst 2");
    });

    await test(`${tag}: a late report from the old devotional's player cannot reach the new one`, async () => {
      const w = rig({ platform });
      const { store, player: first } = await ready(w, 1);
      await playFor(w, store, 2000);
      store.getState().load(W.track(2), AMBIENT);
      await W.advance(100);
      const late = { ...first._status(), playing: true, timeControlStatus: "playing", playbackState: "ready", currentTime: 90 };
      first.emitRaw(late); // the listener was taken off
      first.lastListener(late); // and a report that was already on its way is dropped by the store itself
      assert.deepEqual(view(store), { entryId: "entry-2", status: "paused", positionMs: 0, isBuffering: false, error: null });
    });

    await test(`${tag}: a devotional loaded and abandoned while its audio is being made never starts`, async () => {
      const w = rig({ platform });
      const store = w.store();
      w.fsScript.downloads.push({ ms: 2000 });
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      await W.advance(100); // its download is under way
      store.getState().load(W.track(2), AMBIENT);
      await W.advance(3000);
      assert.equal(view(store).entryId, "entry-2");
      assert.equal(view(store).status, "paused");
      assert.deepEqual(w.created.map((made) => made.source.uri), [FILE(2)], "no player for the first one");
      assert.equal(w.live().calls.play, 0);
    });

    await test(`${tag}: stop is a full reset: the sound stops, the lock screen clears, the player is released`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().setRate(1.2);
      await playFor(w, store, 2000);
      store.getState().stop();
      assert.equal(player.released, true);
      assert.equal(player.calls.clear, 1);
      assert.equal(player.sound, false);
      assert.deepEqual(view(store), { entryId: null, status: "idle", positionMs: 0, isBuffering: false, error: null });
      assert.equal(store.getState().rate, 1);
      assert.equal(store.getState().title, "");
      assert.equal(store.getState().durationMs, 0);
      await W.advance(5000);
      assert.equal(store.getState().positionMs, 0);
      store.getState().stop(); // twice is fine
    });

    await test(`${tag}: stop while the audio is being made, then a late file, makes nothing`, async () => {
      const w = rig({ platform });
      const store = w.store();
      w.fsScript.downloads.push({ ms: 2000 });
      store.getState().load(W.track(1), AMBIENT);
      store.getState().play();
      store.getState().stop();
      await W.advance(3000);
      assert.equal(w.players.length, 0);
      assert.deepEqual(view(store), { entryId: null, status: "idle", positionMs: 0, isBuffering: false, error: null });
    });

    await test(`${tag}: coming back to the app reads what the player did while JS was asleep`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 2000);
      // The app is suspended: the lock screen pauses, skips forward and so on, and no report reaches JS.
      player.suspended = true;
      player.systemPause();
      player.remoteSkip(15);
      assert.equal(view(store).status, "playing", "JS knows nothing yet");
      player.suspended = false;
      w.appState.emit("active");
      assert.equal(view(store).status, "paused");
      assert.equal(store.getState().positionMs, 17_000);
    });

    await test(`${tag}: a devotional that played out while JS was asleep is shown as finished`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 3000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 3000 }), AMBIENT);
      await W.advance(100);
      const player = w.live();
      await playFor(w, store, 1000);
      player.suspended = true;
      await W.advance(3000);
      player.suspended = false;
      w.appState.emit("active");
      assert.deepEqual(view(store), { entryId: "entry-1", status: "ended", positionMs: 3000, isBuffering: false, error: null });
    });

    await test(`${tag}: going to the background does not pause the sound, and nothing is logged`, async () => {
      const w = rig({ platform });
      const { store } = await ready(w);
      await playFor(w, store, 1000);
      w.appState.emit("background");
      w.appState.emit("inactive");
      await W.advance(1000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 2000, isBuffering: false, error: null });
      assert.deepEqual(output, []);
    });

    await test(`${tag}: a player that is loaded when it is made does not wait for a report that was sent before the listener`, async () => {
      const w = rig({ platform });
      w.flags.preloaded = true;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(5);
      const player = w.live();
      assert.equal(player.calls.setActive.length, 1, "ready at once: no ten-second wait");
      store.getState().play();
      assert.equal(player.calls.play, 1);
      assert.equal(view(store).status, "playing");
    });

    await test(`${tag}: a seek that lands a little away from where it was asked is shown where it landed`, async () => {
      const w = rig({ platform });
      w.flags.seekOffsetSec = 0.4;
      const { store } = await ready(w);
      store.getState().seekTo(30_000);
      assert.equal(store.getState().positionMs, 30_000);
      await W.advance(50);
      assert.equal(store.getState().positionMs, 30_400);
    });

    await test(`${tag}: asking to play from the end and pausing at once leaves it paused`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 3000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 3000 }), AMBIENT);
      await W.advance(100);
      const player = w.live();
      await playFor(w, store, 3000);
      assert.equal(view(store).status, "ended");
      store.getState().play();
      store.getState().pause(); // before the player has finished rewinding
      await W.advance(500);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      assert.equal(player.sound, false);
      assert.equal(player.calls.play, 1, "only the first play of the test, never the second");
    });

    await test(`${tag}: the system pausing while the sound is on its way is followed`, async () => {
      const w = rig({ platform });
      w.flags.bufferMs = 800;
      const { store, player } = await ready(w);
      store.getState().play();
      await W.advance(300);
      player.systemPause(); // a call comes in while it waits for data
      if (platform === "ios") {
        assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      } else {
        // Android still says "buffering" until the buffering ends: nothing in its reports tells otherwise.
        assert.equal(view(store).status, "playing");
        await W.advance(600);
      }
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      assert.equal(player.sound, false);
    });

    await test(`${tag}: pausing while the sound is on its way stays paused, whatever the late reports say`, async () => {
      const w = rig({ platform });
      w.flags.bufferMs = 800;
      const { store, player } = await ready(w);
      store.getState().play();
      await W.advance(300);
      store.getState().pause();
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      await W.advance(2000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 0, isBuffering: false, error: null });
      assert.equal(player.sound, false);
      assert.equal(player.calls.play, 1);
    });

    await test(`${tag}: a wait for data in the middle of the sound shows the spinner, and a pause during it holds`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      player.rebuffer(2000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "playing", positionMs: 1000, isBuffering: true, error: null });
      await W.advance(2100);
      assert.equal(view(store).status, "playing");
      assert.equal(view(store).isBuffering, false);
      await W.advance(500);
      assert.ok(store.getState().positionMs >= 1250, String(store.getState().positionMs));
      // A second wait, and this time the person pauses in the middle of it.
      const before = player.currentTime;
      player.rebuffer(2000);
      assert.equal(view(store).isBuffering, true);
      store.getState().pause();
      assert.equal(view(store).status, "paused");
      await W.advance(3000);
      assert.equal(view(store).status, "paused");
      assert.equal(view(store).isBuffering, false);
      assert.equal(player.sound, false);
      assert.equal(player.currentTime, before);
    });

    await test(`${tag}: a report that was already on its way when the person paused does not undo the pause`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      player.rebuffer(3000); // Android keeps saying "playing" while it waits for data
      const late = player.currentStatus; // made just before the pause...
      store.getState().pause();
      player.emitRaw(late); // ...and delivered just after it
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 1000, isBuffering: false, error: null });
      await W.advance(4000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 1000, isBuffering: false, error: null });
      assert.equal(player.sound, false);
    });

    await test(`${tag}: after a pause from outside, the player waiting for data does not turn the play button back on`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      player.systemPause(); // a call, the lock screen or a headset
      assert.equal(view(store).status, "paused");
      player.waitForData(1500); // the scrubber is dragged to a place that is not loaded yet
      assert.equal(view(store).status, "paused");
      await W.advance(2000);
      assert.deepEqual(view(store), { entryId: "entry-1", status: "paused", positionMs: 1000, isBuffering: false, error: null });
      assert.equal(player.sound, false);
      store.getState().play();
      assert.equal(view(store).status, "playing", "and the next play still works");
      await W.advance(500);
      assert.equal(player.sound, true);
    });

    await test(`${tag}: switching devotional while the player opens leaves no wait behind and keeps the first file`, async () => {
      const w = rig({ platform });
      w.flags.loadMs = 500;
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      await W.advance(100); // the first player exists and waits for its file to load
      const first = w.live();
      store.getState().load(W.track(2), AMBIENT);
      assert.equal(first.released, true);
      assert.ok(![...W.clock.timers.values()].some((timer) => timer.ms === 10_000), "no ten-second wait is left running");
      await W.advance(1500);
      assert.ok(w.fs.has(FILE(1)), "the first devotional's file is kept");
      assert.deepEqual(w.created.map((made) => made.source.uri), [FILE(1), FILE(2)]);
      assert.equal(w.players.filter((player) => !player.released).length, 1);
      assert.equal(w.fsCalls.downloads.length, 2);
    });

    await test(`${tag}: two devotionals loaded in one breath make one player`, async () => {
      const w = rig({ platform });
      const store = w.store();
      store.getState().load(W.track(1), AMBIENT);
      store.getState().load(W.track(2), AMBIENT);
      await W.advance(300);
      assert.deepEqual(w.created.map((made) => made.source.uri), [FILE(2)]);
      assert.equal(w.fsCalls.downloads.length, 1, "the first was never fetched");
    });

    await test(`${tag}: asking to play twice plays once`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      store.getState().play();
      store.getState().play();
      assert.equal(player.calls.play, 1);
      assert.equal(view(store).isBuffering, false);
    });

    await test(`${tag}: asking to play the moment it ended plays from the start`, async () => {
      const w = rig({ platform });
      w.flags.durationMs = 3000;
      const store = w.store();
      store.getState().load(W.track(1, { durationMs: 3000 }), AMBIENT);
      await W.advance(100);
      const player = w.live();
      await playFor(w, store, 3000);
      assert.equal(view(store).status, "ended");
      store.getState().play(); // before the player has finished rewinding
      await W.advance(500);
      assert.equal(view(store).status, "playing");
      assert.equal(player.sound, true);
      assert.ok(store.getState().positionMs > 0 && store.getState().positionMs <= 500, String(store.getState().positionMs));
    });

    await test(`${tag}: a position past the end is held at the end`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      player.emitRaw({ ...player._status(), currentTime: 200 });
      assert.equal(store.getState().positionMs, 113_200);
    });

    await test(`${tag}: a report that changes nothing notifies nobody`, async () => {
      const w = rig({ platform });
      const { store, player } = await ready(w);
      await playFor(w, store, 1000);
      store.getState().pause();
      let notified = 0;
      const unsubscribe = store.subscribe(() => void (notified += 1));
      player.emitRaw(player._status());
      player.emitRaw(player._status());
      unsubscribe();
      assert.equal(notified, 0);
    });
  }

  await test("store: an error does not follow the person to the next devotional", async () => {
    const w = rig();
    w.fsScript.downloads.push({ error: "The Internet connection appears to be offline." });
    const store = w.store();
    store.getState().load(W.track(1), AMBIENT);
    await W.advance(100);
    assert.equal(view(store).error, "offline");
    store.getState().load(W.track(2), AMBIENT);
    assert.equal(view(store).error, null);
    await W.advance(100);
    assert.deepEqual(view(store), { entryId: "entry-2", status: "paused", positionMs: 0, isBuffering: false, error: null });
    assert.equal(w.players.length, 1);
  });

  // ============================================================ E. the store's shape and the ambient choice
  await test("store: the state and the actions of step 12 are all still there, with isBuffering and error added", async () => {
    const w = rig();
    const state = w.store().getState();
    assert.deepEqual(Object.keys(state).sort(), [
      "ambientSound",
      "ambientVolume",
      "durationMs",
      "entryId",
      "error",
      "isBuffering",
      "load",
      "pause",
      "play",
      "positionMs",
      "rate",
      "reseedAmbient",
      "seekTo",
      "setAmbient",
      "setAmbientVolume",
      "setRate",
      "skipBy",
      "status",
      "stop",
      "subtitle",
      "title",
      "toggle",
    ]);
    assert.deepEqual(view(w.store()), { entryId: null, status: "idle", positionMs: 0, isBuffering: false, error: null });
  });

  await test("store: the first load copies the profile's ambient choice, later ones keep the session's, and reseedAmbient copies it again", async () => {
    const w = rig();
    const store = w.store();
    store.getState().load(W.track(1), { ambientSound: "soft-rain", ambientVolume: 0.3 });
    assert.deepEqual([store.getState().ambientSound, store.getState().ambientVolume], ["soft-rain", 0.3]);
    store.getState().setAmbient("gentle-piano");
    store.getState().setAmbientVolume(1.5);
    assert.equal(store.getState().ambientVolume, 1);
    store.getState().load(W.track(2), { ambientSound: "soft-rain", ambientVolume: 0.3 });
    assert.deepEqual([store.getState().ambientSound, store.getState().ambientVolume], ["gentle-piano", 1]);
    store.getState().reseedAmbient();
    store.getState().load(W.track(3), { ambientSound: "morning-birds", ambientVolume: 0.7 });
    assert.deepEqual([store.getState().ambientSound, store.getState().ambientVolume], ["morning-birds", 0.7]);
    store.getState().stop();
    assert.deepEqual([store.getState().ambientSound, store.getState().ambientVolume], ["off", 0.5]);
    store.getState().load(W.track(4), { ambientSound: "soft-rain", ambientVolume: 0.9 });
    assert.deepEqual([store.getState().ambientSound, store.getState().ambientVolume], ["soft-rain", 0.9], "the next account starts from its own profile");
  });

  // ============================================================ F. a devotional is a track only with a path and a length
  await test("track: getPlaybackTrack carries the audio path, and a crisis entry, an unfinished one or one with no audio is no track", async () => {
    const w = rig();
    const { getPlaybackTrack } = w.env.use("@/data/selectors");
    const entry = (patch = {}, devotional = {}) => ({
      id: "entry-1",
      isCrisis: false,
      status: "ready",
      scripture: { reference: "Psalm 23:1–3" },
      devotional: { title: "Peace", audioPath: PATH(1), durationMs: 113_200, ...devotional },
      ...patch,
    });
    assert.deepEqual(getPlaybackTrack(entry()), {
      entryId: "entry-1",
      title: "Peace",
      subtitle: "Gracehush • Psalm 23:1–3",
      durationMs: 113_200,
      audioPath: PATH(1),
    });
    assert.equal(getPlaybackTrack(entry({ isCrisis: true })), null);
    assert.equal(getPlaybackTrack(entry({ status: "processing" })), null);
    assert.equal(getPlaybackTrack(entry({ devotional: null })), null);
    assert.equal(getPlaybackTrack(entry({}, { audioPath: null })), null);
    assert.equal(getPlaybackTrack(entry({}, { durationMs: null })), null);
    assert.equal(getPlaybackTrack(entry({}, { durationMs: 0 })), null);
    assert.equal(getPlaybackTrack(entry({}, { durationMs: Infinity })), null);
  });

  // ============================================================ G. the recorder shares the audio session
  {
    const recorder = (w) => w.env.use("@/services/recorder");
    const onStatus = () => undefined;

    await test("recorder: a take stops a devotional that is playing, and puts the playback mode back afterwards", async () => {
      const w = rig();
      const { store, player } = await ready(w);
      await playFor(w, store, 2000);
      const before = w.modes().length;
      await recorder(w).startRecording(onStatus);
      assert.equal(player.sound, false, "the devotional stopped");
      assert.equal(view(store).status, "paused");
      assert.equal(store.getState().positionMs, 2000);
      const modes = w.modes().slice(before);
      assert.equal(modes.length, 1);
      assert.equal(modes[0].allowsRecording, true);
      assert.equal(modes[0].shouldPlayInBackground, false);
      await W.advance(4000);
      const raw = await recorder(w).stopRecording();
      assert.ok(raw.uri);
      assert.equal(w.modes().at(-1).allowsRecording, false);
      assert.equal(w.modes().at(-1).playsInSilentMode, true);
      assert.equal(w.modes().at(-1).shouldPlayInBackground, true);
      assert.equal(w.modes().at(-1).interruptionMode, "doNotMix");
      // Playing again afterwards works and is still on the speaker, with the silent switch honored.
      store.getState().play();
      await W.advance(500);
      assert.equal(view(store).status, "playing");
    });

    await test("recorder: every mode the recorder sets carries all six fields, on start, resume, stop, cancel and a failed start", async () => {
      const w = rig();
      await recorder(w).startRecording(onStatus);
      recorder(w).pauseRecording();
      await recorder(w).resumeRecording();
      await recorder(w).cancelRecording();
      w.audio.flags.throwOnRecord = true;
      await assert.rejects(recorder(w).startRecording(onStatus));
      for (const mode of w.modes()) assert.deepEqual(Object.keys(mode).sort(), MODE_FIELDS);
      assert.equal(w.modes().at(-1).allowsRecording, false, "a failed start leaves the playback mode");
      assert.equal(w.modes().at(-1).shouldPlayInBackground, true);
    });

    await test("recorder: a resumed take sets its mode again, whatever was set in between", async () => {
      const w = rig();
      await recorder(w).startRecording(onStatus);
      recorder(w).pauseRecording();
      await w.env.use("@/services/audioSession").setSessionMode("playback");
      await recorder(w).resumeRecording();
      assert.equal(w.modes().at(-1).allowsRecording, true);
      await recorder(w).cancelRecording();
      assert.equal(w.modes().at(-1).allowsRecording, false);
      assert.equal(w.modes().at(-1).shouldPlayInBackground, true, "the playback mode is back when the take ends");
    });

    await test("recorder: with nothing playing a take still starts, and the store is left alone", async () => {
      const w = rig();
      const store = w.store();
      await recorder(w).startRecording(onStatus);
      assert.deepEqual(view(store), { entryId: null, status: "idle", positionMs: 0, isBuffering: false, error: null });
      await recorder(w).cancelRecording();
    });
  }

  // ============================================================ H. the architecture rules, read from the source
  {
    const REPO = process.env.GRACEHUSH_REPO;
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

    await test("contract: only the audio session file calls setAudioModeAsync", () => {
      assert.deepEqual(mentioning(/setAudioModeAsync\(/), ["src/services/audioSession.ts"]);
    });

    await test("contract: only the player store makes a player, and no screen or component imports expo-audio", () => {
      assert.deepEqual(mentioning(/createAudioPlayer\(/), ["src/store/playerStore.ts"]);
      const importers = mentioning(/from "expo-audio/);
      for (const file of importers) assert.ok(!file.startsWith("src/screens/") && !file.startsWith("src/components/"), `${file} imports expo-audio`);
    });

    await test("contract: the player files never log a link, a path, a title or an id", () => {
      for (const file of ["src/store/playerStore.ts", "src/services/devotionalAudio.ts", "src/services/lockScreen.ts", "src/services/audioSession.ts"]) {
        const text = fs.readFileSync(path.join(REPO, file), "utf8");
        const logs = text.match(/console\.[a-z]+\([^;]*;/g) ?? [];
        for (const call of logs) assert.ok(!/(url|uri|path|title|entryId|subtitle|link)/i.test(call.replace(/the \$\{mode\} session mode/, "")), `${file}: ${call}`);
      }
    });

    await test("contract: the old mock is gone from the store, and no track-player is used", () => {
      const store = fs.readFileSync(path.join(REPO, "src/store/playerStore.ts"), "utf8");
      assert.ok(!/TEMP\(26\)/.test(store), "TEMP(26) is gone");
      assert.ok(!/setInterval/.test(store), "no clock of its own");
      assert.ok(!/AppState\.addEventListener\("change", \(status\) => \{\s*if \(status !== "active"\) usePlayerStore/.test(store), "no pause on background");
      assert.deepEqual(mentioning(/react-native-track-player/), []);
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
