// Recording checks (step 23). They run the app's real recorder service, recording files, upload service and
// useRecorder hook in Node, on fakes of the microphone, the file system, Storage and React (world.cjs), with a
// virtual clock, so a pause, a call, the five-minute limit or a retry takes no real time.
//
//   node supabase/tests/recording/run.cjs        (from the repo root; about 5 seconds)
//
// It needs no device, no emulator and no Supabase project. Exit code 0 only when every check passes. To run it against
// a copy of the repo instead, set GRACEHUSH_REPO to that folder.
const assert = require("node:assert/strict");
const W = require("./world.cjs");
const { StorageApiError, StorageUnknownError } = W.storageJs;

let passed = 0;
const failures = [];
const output = []; // everything the app wrote to the console during the current test
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => void output.push(args.map(String).join(" "));
}
let running = null;
let finished = false;
// If the process ends while a test is still waiting (a promise that never settles), say which one.
process.on("exit", () => {
  if (finished) return;
  require("node:fs").writeSync(1, passed + " passed, stopped while running: " + running + String.fromCharCode(10));
  process.exitCode = 1;
});
async function test(name, fn) {
  output.length = 0;
  running = name;
  try {
    await fn();
    passed++;
  } catch (error) {
    failures.push(`${name}\n      ${String(error.stack ?? error.message).split("\n").slice(0, 5).join("\n      ")}`);
  } finally {
    W.uninstallClock();
  }
}

function world() {
  W.installClock();
  const fs = W.makeFs();
  const audio = W.makeAudio(fs);
  const keep = W.makeKeepAwake();
  const appState = W.makeAppState();
  const storage = W.makeStorage();
  const { react, renderHook } = W.makeReact();
  const session = { client: storage.client, userId: "user_a" };
  const fakes = {
    "expo-audio": audio.module,
    "expo-audio/build/utils/options": audio.options,
    "expo-file-system": { File: fs.File, Directory: fs.Directory, Paths: fs.Paths },
    "expo-keep-awake": keep.module,
    "react-native": appState.module,
    react,
    expo: { PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" } },
    "@supabase/supabase-js": { StorageApiError },
    "@/services/supabaseClient": { getSupabase: () => session.client, getSupabaseUserId: () => session.userId },
  };
  const env = W.makeEnv({ fakes });
  return { env, fs, audio, keep, appState, storage, renderHook, session };
}
const ID = "11111111-2222-4333-8444-555555555555";
const FINAL = `file:///docs/recordings/${ID}.m4a`;

(async () => {
  // ============================================================ A. pure helpers
  {
    const w = world();
    const { meterToLevel, smoothLevel } = w.env.use("@/utils/audioLevels");
    await test("levels: dBFS maps to 0..1 with -60 as silence and 0 as full scale", () => {
      assert.equal(meterToLevel(-160), 0);
      assert.equal(meterToLevel(-60), 0);
      assert.equal(meterToLevel(-30), 0.5);
      assert.equal(meterToLevel(0), 1);
      assert.equal(meterToLevel(6), 1);
    });
    await test("levels: a missing or broken reading is silence", () => {
      for (const bad of [undefined, NaN, Infinity, -Infinity]) assert.equal(meterToLevel(bad), 0);
    });
    await test("levels: smoothing is 0.6 old plus 0.4 new", () => {
      assert.equal(smoothLevel(0, 1), 0.4);
      assert.equal(smoothLevel(1, 1), 1);
      assert.ok(Math.abs(smoothLevel(1, 0) - 0.6) < 1e-12);
    });

    const upload = w.env.use("@/services/mediaUpload");
    await test("upload: the object path is {user}/raw/{entry}.m4a", () => {
      assert.equal(upload.rawRecordingPath("user_a", ID), `user_a/raw/${ID}.m4a`);
    });
    await test("upload: error mapping", () => {
      const api = (status, statusCode, message = "m", code) => new StorageApiError(message, status, statusCode, "storage", code);
      assert.equal(upload.toUploadFailure(api(413, "413")), "TOO_LARGE");
      assert.equal(upload.toUploadFailure(api(400, "413")), "TOO_LARGE");
      assert.equal(upload.toUploadFailure(api(401, "401")), "UNAUTHORIZED");
      assert.equal(upload.toUploadFailure(api(403, "403")), "UNAUTHORIZED");
      assert.equal(upload.toUploadFailure(api(500, "500")), "UNKNOWN");
      assert.equal(upload.toUploadFailure(api(400, "400")), "UNKNOWN");
      assert.equal(upload.toUploadFailure(new StorageUnknownError("Network request failed", new TypeError("Network request failed"))), "NETWORK");
      assert.equal(upload.toUploadFailure(new TypeError("Network request failed")), "NETWORK");
      assert.equal(upload.toUploadFailure("weird"), "NETWORK");
      const { NoSessionError } = w.env.use("@/utils/supabaseErrors");
      assert.equal(upload.toUploadFailure(new StorageUnknownError("x", new NoSessionError())), "UNAUTHORIZED");
      assert.equal(upload.toUploadFailure(new NoSessionError()), "UNAUTHORIZED");
    });
  }

  // ============================================================ B. recordingFiles
  {
    const files = (w) => w.env.use("@/services/recordingFiles");
    await test("files: recordingUri is recordings/{id}.m4a in the document folder", () => {
      assert.equal(files(world()).recordingUri(ID), FINAL);
    });
    await test("files: finalize moves the take, makes the folder and measures the size", async () => {
      const w = world();
      w.fs.put(W.IN_PROGRESS_URI, 5000);
      const result = await files(w).finalizeRecording(W.IN_PROGRESS_URI, ID);
      assert.deepEqual(result, { uri: FINAL, sizeBytes: 5000 });
      assert.ok(w.fs.has(FINAL));
      assert.ok(!w.fs.has(W.IN_PROGRESS_URI));
      assert.ok(w.fs.dirs.has("file:///docs/recordings"));
    });
    await test("files: finalize again with the final address changes nothing", async () => {
      const w = world();
      w.fs.put(W.IN_PROGRESS_URI, 5000);
      await files(w).finalizeRecording(W.IN_PROGRESS_URI, ID);
      const again = await files(w).finalizeRecording(FINAL, ID);
      assert.deepEqual(again, { uri: FINAL, sizeBytes: 5000 });
      assert.ok(w.fs.has(FINAL));
    });
    await test("files: a second take for the same entry replaces the first", async () => {
      const w = world();
      w.fs.put(W.IN_PROGRESS_URI, 5000);
      await files(w).finalizeRecording(W.IN_PROGRESS_URI, ID);
      w.fs.put(W.IN_PROGRESS_URI, 7000);
      const result = await files(w).finalizeRecording(W.IN_PROGRESS_URI, ID);
      assert.equal(result.sizeBytes, 7000);
      assert.equal(w.fs.files.size, 1);
    });
    await test("files: a missing take throws and creates nothing", async () => {
      const w = world();
      await assert.rejects(files(w).finalizeRecording(W.IN_PROGRESS_URI, ID));
      assert.ok(!w.fs.has(FINAL));
    });
    await test("files: a take under 1 KB is a failed recording: it throws and leaves no file", async () => {
      const w = world();
      w.fs.put(W.IN_PROGRESS_URI, 1023);
      await assert.rejects(files(w).finalizeRecording(W.IN_PROGRESS_URI, ID));
      assert.ok(!w.fs.has(FINAL));
      w.fs.put(W.IN_PROGRESS_URI, 1024);
      await files(w).finalizeRecording(W.IN_PROGRESS_URI, ID);
      assert.ok(w.fs.has(FINAL));
    });
    await test("files: deleteRecording removes the file and never throws", async () => {
      const w = world();
      w.fs.put(FINAL, 3000);
      w.fs.dirs.add("file:///docs/recordings");
      await files(w).deleteRecording(ID);
      assert.ok(!w.fs.has(FINAL));
      await files(w).deleteRecording(ID);
      w.fs.put(FINAL, 3000);
      w.fs.stats.failDelete = true;
      await files(w).deleteRecording(ID);
    });
    await test("files: deleteAllRecordings removes the folder and never throws", async () => {
      const w = world();
      await files(w).deleteAllRecordings();
      w.fs.dirs.add("file:///docs/recordings");
      w.fs.put(FINAL, 3000);
      w.fs.put("file:///docs/recordings/other.m4a", 3000);
      w.fs.put("file:///docs/keep.txt", 10);
      await files(w).deleteAllRecordings();
      assert.ok(!w.fs.dirs.has("file:///docs/recordings"));
      assert.equal(w.fs.files.size, 1);
      assert.ok(w.fs.has("file:///docs/keep.txt"));
      w.fs.dirs.add("file:///docs/recordings");
      w.fs.stats.failDelete = true;
      await files(w).deleteAllRecordings();
    });
    await test("files: listRecordings lists only .m4a files, with id, size and time", () => {
      const w = world();
      assert.deepEqual(files(w).listRecordings(), []);
      w.fs.dirs.add("file:///docs/recordings");
      w.fs.put(FINAL, 3000, 123);
      w.fs.put("file:///docs/recordings/notes.txt", 5);
      const list = files(w).listRecordings();
      assert.deepEqual(list, [{ clientEntryId: ID, uri: FINAL, sizeBytes: 3000, modifiedAt: 123 }]);
    });
  }

  // ============================================================ C. recorder service
  const TAG = "gracehush-recording";
  const svc = (w) => w.env.use("@/services/recorder");
  const collect = () => {
    const list = [];
    return { list, on: (status) => list.push(status), last: () => list[list.length - 1] };
  };
  {
    await test("recorder: start allows recording, prepares, records and keeps the screen awake", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      const rec = w.audio.log.instances[0];
      assert.equal(w.audio.log.instances.length, 1);
      assert.equal(rec.options.fileName, "recording-in-progress");
      assert.equal(rec.options.extension, ".m4a");
      assert.equal(rec.options.directory, "document");
      assert.equal(rec.options.isMeteringEnabled, true);
      assert.equal(rec.options.numberOfChannels, 1);
      assert.equal(rec.options.bitRate, 64000);
      assert.equal(rec.options.sampleRate, 44100);
      assert.equal(rec.recording, true);
      assert.deepEqual(w.audio.log.modes[0], { allowsRecording: true, playsInSilentMode: true });
      assert.deepEqual(w.keep.calls, [["on", TAG]]);
      await svc(w).cancelRecording();
    });
    await test("recorder: a status every 100 ms, with the length from the recorder", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      await W.advance(1000);
      assert.deepEqual(seen.list.map((s) => s.durationMs), [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
      assert.ok(seen.list.every((s) => s.isRecording));
      await svc(w).cancelRecording();
    });
    await test("recorder: levels are smoothed toward the microphone and fall back to silence", async () => {
      const w = world();
      const seen = collect();
      w.audio.flags.db = -30; // a level of 0.5
      await svc(w).startRecording(seen.on);
      await W.advance(500);
      const rising = seen.list.map((s) => s.metering);
      assert.ok(Math.abs(rising[0] - 0.2) < 1e-9 && Math.abs(rising[1] - 0.32) < 1e-9);
      assert.ok(rising.every((v, i) => i === 0 || v > rising[i - 1]));
      assert.ok(rising.every((v) => v < 0.5));
      w.audio.flags.db = -160;
      await W.advance(2000);
      assert.ok(seen.last().metering < 0.01);
      await svc(w).cancelRecording();
    });
    await test("recorder: a recorder the system paused reads as paused after two quiet reads", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      await W.advance(500);
      w.audio.log.instances[0].systemPause();
      await W.advance(100);
      assert.equal(seen.last().isRecording, true);
      await W.advance(100);
      assert.equal(seen.last().isRecording, false);
      assert.equal(seen.last().durationMs, 500);
      await svc(w).cancelRecording();
    });
    await test("recorder: a clock that stands still for 4 s reads as stopped, not recording", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      await W.advance(300);
      svc(w).pauseRecording();
      w.audio.flags.stallOnRecord = true;
      await svc(w).resumeRecording();
      await W.advance(3900);
      assert.equal(seen.last().isRecording, true);
      await W.advance(400);
      assert.equal(seen.last().isRecording, false);
      await svc(w).cancelRecording();
    });
    await test("recorder: pause freezes the clock and the screen may sleep; resume continues from the same length", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      const rec = w.audio.log.instances[0];
      await W.advance(1000);
      svc(w).pauseRecording();
      assert.equal(rec.recording, false);
      assert.equal(rec.pauses, 1);
      assert.deepEqual(w.keep.calls.at(-1), ["off", TAG]);
      await W.advance(500);
      assert.equal(seen.last().durationMs, 1000);
      await svc(w).resumeRecording();
      assert.equal(rec.recording, true);
      assert.equal(rec.records, 2);
      assert.deepEqual(w.audio.log.modes.at(-1), { allowsRecording: true, playsInSilentMode: true });
      assert.deepEqual(w.keep.calls.at(-1), ["on", TAG]);
      await W.advance(500);
      assert.equal(seen.last().durationMs, 1500);
      await svc(w).cancelRecording();
    });
    await test("recorder: resume rejects when the system refuses, and when nothing is recording", async () => {
      const w = world();
      await assert.rejects(svc(w).resumeRecording());
      await svc(w).startRecording(() => undefined);
      svc(w).pauseRecording();
      w.audio.flags.throwOnRecord = true;
      await assert.rejects(svc(w).resumeRecording());
      await svc(w).cancelRecording();
    });
    await test("recorder: holdPaused pauses a recorder the library resumed, and leaves a paused one alone", async () => {
      const w = world();
      svc(w).holdPaused(); // no session: nothing to do
      w.audio.flags.autoResumeAppPaused = true; // the older library behaviour
      await svc(w).startRecording(() => undefined);
      const rec = w.audio.log.instances[0];
      svc(w).pauseRecording();
      rec.systemResume();
      assert.equal(rec.recording, true);
      svc(w).holdPaused();
      assert.equal(rec.recording, false);
      assert.equal(rec.pauses, 2);
      svc(w).holdPaused();
      assert.equal(rec.pauses, 2);
      await svc(w).cancelRecording();
    });
    await test("recorder: with the 58.0.6 behaviour an app pause is never resumed by the library", async () => {
      const w = world();
      await svc(w).startRecording(() => undefined);
      const rec = w.audio.log.instances[0];
      svc(w).pauseRecording();
      rec.systemResume();
      assert.equal(rec.recording, false);
      await svc(w).cancelRecording();
    });
    await test("recorder: stop returns the length read before stop, the file and the type, and cleans up", async () => {
      const w = world();
      const seen = collect();
      await svc(w).startRecording(seen.on);
      const rec = w.audio.log.instances[0];
      await W.advance(2500);
      const raw = await svc(w).stopRecording();
      assert.deepEqual(raw, { uri: W.IN_PROGRESS_URI, durationMs: 2500, mimeType: "audio/mp4" });
      assert.equal(rec.released, true);
      assert.deepEqual(w.audio.log.modes.at(-1), { allowsRecording: false });
      assert.deepEqual(w.keep.calls.at(-1), ["off", TAG]);
      const count = seen.list.length;
      await W.advance(1000);
      assert.equal(seen.list.length, count);
      assert.equal(W.clock.timers.size, 0);
      await assert.rejects(svc(w).stopRecording());
    });
    await test("recorder: stop without a file, or with a failing recorder, still ends the session", async () => {
      for (const flag of ["noUri", "stopThrows"]) {
        const w = world();
        await svc(w).startRecording(() => undefined);
        w.audio.flags[flag] = true;
        await assert.rejects(svc(w).stopRecording());
        assert.equal(w.audio.log.instances[0].released, true, flag);
        assert.deepEqual(w.audio.log.modes.at(-1), { allowsRecording: false }, flag);
        assert.equal(W.clock.timers.size, 0, flag);
      }
    });
    await test("recorder: cancel stops the recorder, releases it and deletes the unfinished file", async () => {
      const w = world();
      await svc(w).cancelRecording(); // nothing running: fine
      await svc(w).startRecording(() => undefined);
      const rec = w.audio.log.instances[0];
      await W.advance(300);
      await svc(w).cancelRecording();
      assert.equal(rec.stops, 1);
      assert.equal(rec.released, true);
      assert.ok(!w.fs.has(W.IN_PROGRESS_URI));
      assert.deepEqual(w.keep.calls.at(-1), ["off", TAG]);
      assert.equal(W.clock.timers.size, 0);
    });
    await test("recorder: cancel still cleans up when stop fails", async () => {
      const w = world();
      await svc(w).startRecording(() => undefined);
      w.audio.flags.stopThrows = true;
      w.fs.put(W.IN_PROGRESS_URI, 100);
      await svc(w).cancelRecording();
      assert.equal(w.audio.log.instances[0].released, true);
      assert.ok(!w.fs.has(W.IN_PROGRESS_URI));
    });
    await test("recorder: a start that fails releases the recorder, resets the audio mode and leaves nothing running", async () => {
      for (const flag of ["rejectPrepare", "throwOnRecord"]) {
        const w = world();
        w.audio.flags[flag] = true;
        await assert.rejects(svc(w).startRecording(() => undefined));
        assert.equal(w.audio.log.instances[0].released, true, flag);
        assert.deepEqual(w.audio.log.modes.at(-1), { allowsRecording: false }, flag);
        assert.ok(!w.keep.calls.some((c) => c[0] === "on"), flag);
        assert.equal(W.clock.timers.size, 0, flag);
        w.audio.flags[flag] = false;
        await svc(w).startRecording(() => undefined);
        assert.equal(w.audio.log.instances.length, 2, flag);
        await svc(w).cancelRecording();
      }
    });
    await test("recorder: a second start ends the first session first", async () => {
      const w = world();
      await svc(w).startRecording(() => undefined);
      await svc(w).startRecording(() => undefined);
      assert.equal(w.audio.log.instances.length, 2);
      assert.equal(w.audio.log.instances[0].released, true);
      assert.equal(W.clock.timers.size, 1);
      await svc(w).cancelRecording();
    });
    await test("recorder: a failing audio mode does not stop a recording from starting", async () => {
      const w = world();
      w.audio.flags.failMode = true;
      await svc(w).startRecording(() => undefined);
      await W.advance(200);
      const raw = await svc(w).stopRecording();
      assert.equal(raw.durationMs, 200);
    });
    await test("recorder: permissions map like step 7 and never throw", async () => {
      const w = world();
      const s = svc(w);
      assert.equal(await s.getMicPermission(), "granted");
      w.audio.flags.permission = { granted: false, status: "denied", canAskAgain: false };
      assert.equal(await s.getMicPermission(), "denied");
      w.audio.flags.permission = { granted: false, status: "denied", canAskAgain: true };
      assert.equal(await s.getMicPermission(), "undetermined");
      w.audio.flags.askResult = { granted: true, status: "granted", canAskAgain: true };
      assert.equal(await s.requestMicPermission(), "granted");
      w.audio.flags.permissionThrows = true;
      assert.equal(await s.getMicPermission(), "undetermined");
      assert.equal(await s.requestMicPermission(), "undetermined");
    });
    await test("recorder: a whole take writes nothing to the console", async () => {
      const w = world();
      await svc(w).startRecording(() => undefined);
      await W.advance(400);
      svc(w).pauseRecording();
      await svc(w).resumeRecording();
      svc(w).holdPaused();
      await W.advance(400);
      await svc(w).stopRecording();
      await svc(w).startRecording(() => undefined);
      await svc(w).cancelRecording();
      assert.deepEqual(output, []);
    });
  }

  // ============================================================ D. mediaUpload
  {
    const up = (w) => w.env.use("@/services/mediaUpload");
    const take = { clientEntryId: ID, uri: FINAL };
    const PATH = `user_a/raw/${ID}.m4a`;
    const withFile = (w, size = 4096) => w.fs.put(FINAL, size);
    const apiError = (status, statusCode, message = "m", code) => ({
      data: null,
      error: new StorageApiError(message, status, statusCode, "storage", code),
    });
    const netError = () => ({
      data: null,
      error: new StorageUnknownError("Network request failed", new TypeError("Network request failed")),
    });
    await test("upload: a good take goes to journal_media at {user}/raw/{entry}.m4a, without overwrite", async () => {
      const w = world();
      withFile(w, 3000);
      assert.deepEqual(await up(w).uploadRawRecording(take, "user_a"), { ok: true, path: PATH });
      const call = w.storage.calls.upload[0];
      assert.equal(w.storage.calls.upload.length, 1);
      assert.equal(call.bucket, "journal_media");
      assert.equal(call.path, PATH);
      assert.ok(call.body instanceof ArrayBuffer);
      assert.equal(call.body.byteLength, 3000);
      assert.deepEqual(call.options, { contentType: "audio/mp4", upsert: false });
    });
    await test("upload: already there counts as success, whichever way Storage says it", async () => {
      for (const answer of [
        apiError(400, "409", "The resource already exists"),
        apiError(409, "409"),
        apiError(400, "400", "Duplicate"),
        apiError(400, "400", "x", "ResourceAlreadyExists"),
      ]) {
        const w = world();
        withFile(w);
        w.storage.script.upload.push(answer);
        assert.deepEqual(await up(w).uploadRawRecording(take, "user_a"), { ok: true, path: PATH });
        assert.equal(w.storage.calls.upload.length, 1);
      }
    });
    await test("upload: a network failure is tried once more after 1.5 s", async () => {
      const w = world();
      withFile(w);
      w.storage.script.upload.push(netError());
      const pending = up(w).uploadRawRecording(take, "user_a");
      await W.flush();
      assert.equal(w.storage.calls.upload.length, 1);
      await W.advance(1499);
      assert.equal(w.storage.calls.upload.length, 1);
      await W.advance(1);
      assert.deepEqual(await pending, { ok: true, path: PATH });
      assert.equal(w.storage.calls.upload.length, 2);
    });
    await test("upload: two network failures in a row answer NETWORK, after exactly two tries", async () => {
      const w = world();
      withFile(w);
      w.storage.script.upload.push(netError(), netError());
      const pending = up(w).uploadRawRecording(take, "user_a");
      await W.advance(1500);
      assert.deepEqual(await pending, { ok: false, code: "NETWORK" });
      assert.equal(w.storage.calls.upload.length, 2);
    });
    await test("upload: a rejected request is NETWORK too", async () => {
      const w = world();
      withFile(w);
      const boom = () => {
        throw new TypeError("Network request failed");
      };
      w.storage.script.upload.push(boom, boom);
      const pending = up(w).uploadRawRecording(take, "user_a");
      await W.advance(1500);
      assert.deepEqual(await pending, { ok: false, code: "NETWORK" });
    });
    await test("upload: a refused token or policy is UNAUTHORIZED and is not retried", async () => {
      const { NoSessionError } = world().env.use("@/utils/supabaseErrors");
      const answers = [
        apiError(403, "403"),
        apiError(401, "401"),
        { data: null, error: new StorageUnknownError("x", new NoSessionError()) },
        () => {
          throw new NoSessionError();
        },
      ];
      for (const answer of answers) {
        const w = world();
        withFile(w);
        w.storage.script.upload.push(answer);
        const pending = up(w).uploadRawRecording(take, "user_a");
        await W.advance(2000); // longer than the retry wait: a retry would have happened by now
        assert.deepEqual(await pending, { ok: false, code: "UNAUTHORIZED" });
        assert.equal(w.storage.calls.upload.length, 1);
        assert.equal(W.clock.timers.size, 0);
      }
    });
    await test("upload: 413 is TOO_LARGE and any other answer is UNKNOWN, neither retried", async () => {
      const a = world();
      withFile(a);
      a.storage.script.upload.push(apiError(413, "413"));
      const first = up(a).uploadRawRecording(take, "user_a");
      await W.advance(2000);
      assert.deepEqual(await first, { ok: false, code: "TOO_LARGE" });
      const b = world();
      withFile(b);
      b.storage.script.upload.push(apiError(500, "500"));
      const second = up(b).uploadRawRecording(take, "user_a");
      await W.advance(2000);
      assert.deepEqual(await second, { ok: false, code: "UNKNOWN" });
      assert.equal(a.storage.calls.upload.length + b.storage.calls.upload.length, 2);
    });
    await test("upload: a file over 12 MiB is never read or sent; exactly 12 MiB is sent", async () => {
      const w = world();
      withFile(w, 12 * 1024 * 1024 + 1);
      assert.deepEqual(await up(w).uploadRawRecording(take, "user_a"), { ok: false, code: "TOO_LARGE" });
      assert.equal(w.fs.stats.reads, 0);
      assert.equal(w.storage.calls.upload.length, 0);
      const edge = world();
      withFile(edge, 12 * 1024 * 1024);
      assert.deepEqual(await up(edge).uploadRawRecording(take, "user_a"), { ok: true, path: PATH });
    });
    await test("upload: a missing or unreadable file is NOT_FOUND and nothing is sent", async () => {
      const w = world();
      assert.deepEqual(await up(w).uploadRawRecording(take, "user_a"), { ok: false, code: "NOT_FOUND" });
      const unreadable = world();
      withFile(unreadable);
      unreadable.fs.stats.failReads = true;
      assert.deepEqual(await up(unreadable).uploadRawRecording(take, "user_a"), { ok: false, code: "NOT_FOUND" });
      assert.equal(w.storage.calls.upload.length + unreadable.storage.calls.upload.length, 0);
    });
    await test("upload: signed out is UNAUTHORIZED with no file read and no request", async () => {
      const w = world();
      withFile(w);
      w.session.client = null;
      assert.deepEqual(await up(w).uploadRawRecording(take, "user_a"), { ok: false, code: "UNAUTHORIZED" });
      assert.equal(w.fs.stats.reads, 0);
      assert.equal(w.storage.calls.upload.length, 0);
    });
    await test("upload: counting lists {user}/raw and returns only a number", async () => {
      const w = world();
      w.storage.script.list.push({ data: [{ name: "a" }, { name: "b" }], error: null });
      assert.deepEqual(await up(w).countRawUploads("user_a"), { ok: true, count: 2 });
      assert.equal(w.storage.calls.list[0].path, "user_a/raw");
      assert.equal(w.storage.calls.list[0].bucket, "journal_media");
      assert.equal(w.storage.calls.list[0].options.limit, 1000);
      w.storage.script.list.push(apiError(403, "403"));
      assert.deepEqual(await up(w).countRawUploads("user_a"), { ok: false, code: "UNAUTHORIZED" });
      w.storage.script.list.push(() => {
        throw new TypeError("Network request failed");
      });
      assert.deepEqual(await up(w).countRawUploads("user_a"), { ok: false, code: "NETWORK" });
      w.session.client = null;
      const before = w.storage.calls.list.length;
      assert.deepEqual(await up(w).countRawUploads("user_a"), { ok: false, code: "UNAUTHORIZED" });
      assert.equal(w.storage.calls.list.length, before);
    });
    await test("upload: nothing is written to the console, whatever happens", async () => {
      const w = world();
      withFile(w);
      w.storage.script.upload.push(netError(), apiError(403, "403"));
      const pending = up(w).uploadRawRecording(take, "user_a");
      await W.advance(1500);
      await pending;
      assert.deepEqual(output, []);
    });
  }

  // ============================================================ E. useRecorder, the real hook on the real service and files
  {
    const GRANTED = { granted: true, status: "granted", canAskAgain: true };
    const DENIED = { granted: false, status: "denied", canAskAgain: false };
    const UNASKED = { granted: false, status: "undetermined", canAskAgain: true };
    const ZEROS = new Array(9).fill(0);
    function mount(w) {
      const hook = w.renderHook(w.env.use("@/hooks/useRecorder").useRecorder, ID);
      return { hook, r: () => hook.result.current, rec: () => w.audio.log.instances[0] };
    }
    async function recordFor(w, h, ms) {
      await h.r().start();
      await W.flush();
      await W.advance(ms);
    }
    await test("hook: starts idle with nine silent bars, and nothing has touched the microphone", () => {
      const w = world();
      const h = mount(w);
      const r = h.r();
      assert.equal(r.state, "idle");
      assert.equal(r.error, null);
      assert.equal(r.durationMs, 0);
      assert.deepEqual(r.levels, ZEROS);
      assert.equal(r.recording, null);
      assert.equal(w.audio.log.instances.length, 0);
      assert.equal(w.appState.count(), 1);
    });
    await test("hook: a tap with the microphone granted records, and the length and bars follow the recorder", async () => {
      const w = world();
      const h = mount(w);
      w.audio.flags.db = -20;
      await recordFor(w, h, 1000);
      assert.equal(h.r().state, "recording");
      assert.equal(h.r().durationMs, 1000);
      assert.ok(h.r().levels.at(-1) > 0.1);
      assert.equal(h.r().levels.length, 9);
    });
    await test("hook: the first tap asks for the microphone once, then records", async () => {
      const w = world();
      w.audio.flags.permission = UNASKED;
      w.audio.flags.askResult = GRANTED;
      const h = mount(w);
      await recordFor(w, h, 200);
      assert.equal(h.r().state, "recording");
      assert.equal(w.audio.log.permissionAsks, 1);
    });
    await test("hook: a refusal, or a microphone that is already off, shows denied and records nothing", async () => {
      const refused = world();
      refused.audio.flags.permission = UNASKED;
      refused.audio.flags.askResult = DENIED;
      const a = mount(refused);
      await recordFor(refused, a, 100);
      assert.equal(a.r().state, "denied");
      assert.equal(refused.audio.log.instances.length, 0);
      const off = world();
      off.audio.flags.permission = DENIED;
      const b = mount(off);
      await recordFor(off, b, 100);
      assert.equal(b.r().state, "denied");
      assert.equal(off.audio.log.permissionAsks, 0);
    });
    await test("hook: turning the microphone on in Settings clears the denied card when the app returns", async () => {
      const w = world();
      w.audio.flags.permission = DENIED;
      const h = mount(w);
      await recordFor(w, h, 100);
      w.appState.emit("active");
      await W.flush();
      assert.equal(h.r().state, "denied");
      w.audio.flags.permission = GRANTED;
      w.appState.emit("active");
      await W.flush();
      assert.equal(h.r().state, "idle");
    });
    await test("hook: stop keeps the take in recordings/ and says everything the next step needs", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 2000);
      const kept = await h.r().stop();
      assert.deepEqual(Object.keys(kept).sort(), ["clientEntryId", "durationMs", "mimeType", "sizeBytes", "uri"]);
      assert.equal(kept.clientEntryId, ID);
      assert.equal(kept.uri, FINAL);
      assert.equal(kept.durationMs, 2000);
      assert.equal(kept.mimeType, "audio/mp4");
      assert.equal(kept.sizeBytes, 4096);
      await W.flush();
      assert.equal(h.r().state, "recorded");
      assert.deepEqual(h.r().recording, kept);
      assert.equal(h.r().durationMs, 2000);
      assert.deepEqual(h.r().levels, ZEROS);
      assert.ok(w.fs.has(FINAL));
      assert.ok(!w.fs.has(W.IN_PROGRESS_URI));
    });
    await test("hook: a take that is only a header is a failed recording: save error, nothing kept, next start clears it", async () => {
      const w = world();
      const h = mount(w);
      w.audio.flags.fileBytes = 100;
      await recordFor(w, h, 1500);
      assert.equal(await h.r().stop(), null);
      await W.flush();
      assert.equal(h.r().state, "idle");
      assert.equal(h.r().error, "save");
      assert.equal(h.r().durationMs, 0);
      assert.equal(h.r().recording, null);
      assert.ok(!w.fs.has(FINAL));
      w.audio.flags.fileBytes = 4096;
      await h.r().start();
      await W.flush();
      assert.equal(h.r().error, null);
      assert.equal(h.r().state, "recording");
    });
    await test("hook: the five-minute limit stops by itself and keeps exactly five minutes", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 300000);
      await W.flush();
      assert.equal(h.r().state, "recorded");
      assert.equal(h.r().durationMs, 300000);
      assert.equal(h.r().recording.durationMs, 300000);
      assert.equal(w.audio.log.instances[0].stops, 1);
      assert.ok(w.fs.has(FINAL));
    });
    await test("hook: leaving the app pauses and keeps the take, the screen may sleep, the clock holds", async () => {
      const w = world();
      const h = mount(w);
      w.audio.flags.db = -10;
      await recordFor(w, h, 1000);
      assert.ok(h.r().levels.at(-1) > 0.3);
      w.appState.emit("background");
      await W.flush();
      assert.equal(h.r().state, "paused");
      assert.deepEqual(h.r().levels, ZEROS); // the bars go flat at once, not over a second
      assert.equal(h.rec().recording, false);
      assert.ok(h.rec().pauses >= 1);
      assert.deepEqual(w.keep.calls.at(-1), ["off", TAG]);
      await W.advance(2000);
      assert.equal(h.r().durationMs, 1000);
      assert.ok(h.r().levels.every((v) => v < 0.01));
      assert.equal(h.r().error, null);
    });
    await test("hook: back in the foreground a paused take stays paused, even if an older library resumed it", async () => {
      const w = world();
      w.audio.flags.autoResumeAppPaused = true;
      const h = mount(w);
      await recordFor(w, h, 1000);
      w.appState.emit("background");
      await W.flush();
      h.rec().systemResume();
      assert.equal(h.rec().recording, true);
      w.appState.emit("active");
      await W.flush();
      assert.equal(h.r().state, "paused");
      assert.equal(h.rec().recording, false);
    });
    await test("hook: the inactive state alone (a banner, the app switcher) does not pause by itself", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 500);
      w.appState.emit("inactive");
      await W.advance(500);
      assert.equal(h.r().state, "recording");
    });
    await test("hook: resume continues from the same length; Finish after a pause keeps both parts", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1000);
      w.appState.emit("background");
      await W.flush();
      await h.r().resume();
      await W.flush();
      assert.equal(h.r().state, "recording");
      assert.equal(h.r().error, null);
      await W.advance(1500);
      assert.equal(h.r().durationMs, 2500);
      const kept = await h.r().stop();
      assert.equal(kept.durationMs, 2500);
      assert.equal(h.r().state, "recorded");
    });
    await test("hook: Finish while paused keeps what was recorded", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1000);
      w.appState.emit("background");
      await W.flush();
      const kept = await h.r().stop();
      assert.equal(kept.durationMs, 1000);
      assert.ok(w.fs.has(FINAL));
      assert.equal(h.r().state, "recorded");
    });
    await test("hook: a call takes the microphone: after two quiet reads the take is paused and stays paused", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1000);
      h.rec().systemPause();
      await W.advance(300);
      assert.equal(h.r().state, "paused");
      assert.equal(h.rec().pauses, 1);
      h.rec().systemResume(); // the call ended: the library does not resume what the app paused
      await W.advance(500);
      assert.equal(h.r().state, "paused");
      assert.equal(h.r().durationMs, 1000);
      await h.r().resume();
      await W.flush();
      assert.equal(h.r().state, "recording");
    });
    await test("hook: a resume the system refuses stays paused with a message, Finish still works, a later resume clears it", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1000);
      w.appState.emit("background");
      await W.flush();
      w.audio.flags.throwOnRecord = true;
      await h.r().resume();
      await W.flush();
      assert.equal(h.r().state, "paused");
      assert.equal(h.r().error, "resume");
      w.audio.flags.throwOnRecord = false;
      await h.r().resume();
      await W.flush();
      assert.equal(h.r().state, "recording");
      assert.equal(h.r().error, null);
      w.appState.emit("background");
      await W.flush();
      w.audio.flags.throwOnRecord = true;
      await h.r().resume();
      await W.flush();
      const kept = await h.r().stop();
      assert.equal(kept.durationMs, 1000);
    });
    await test("hook: a resume that only looks like it worked goes back to paused, without an error", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 500);
      w.appState.emit("background");
      await W.advance(10000); // a long pause first: the stall clock must start again at the resume
      w.audio.flags.stallOnRecord = true;
      await h.r().resume();
      await W.flush();
      assert.equal(h.r().state, "recording");
      await W.advance(3900);
      assert.equal(h.r().state, "recording");
      await W.advance(400);
      assert.equal(h.r().state, "paused");
      assert.equal(h.r().error, null);
    });
    await test("hook: resume does nothing unless the take is paused", async () => {
      const w = world();
      const h = mount(w);
      await h.r().resume();
      await recordFor(w, h, 300);
      await h.r().resume();
      assert.equal(h.rec().records, 1);
      assert.equal(h.r().state, "recording");
    });
    await test("hook: discard throws the take away wherever it is, clears the message and lets the next take start", async () => {
      for (const where of ["recording", "paused", "recorded"]) {
        const w = world();
        const h = mount(w);
        await recordFor(w, h, 2000);
        if (where === "paused") {
          w.appState.emit("background");
          await W.flush();
        }
        if (where === "recorded") await h.r().stop();
        await h.r().discard();
        await W.flush();
        assert.equal(h.r().state, "idle", where);
        assert.equal(h.r().error, null, where);
        assert.equal(h.r().durationMs, 0, where);
        assert.equal(h.r().recording, null, where);
        assert.deepEqual(h.r().levels, ZEROS, where);
        assert.equal(w.fs.files.size, 0, where);
        assert.equal(w.audio.log.instances[0].released, true, where);
        await recordFor(w, h, 1500);
        assert.equal(h.r().state, "recording", where);
      }
    });
    await test("hook: leaving the screen cancels a take that is recording or paused and keeps a finished one", async () => {
      for (const where of ["recording", "paused", "recorded"]) {
        const w = world();
        const h = mount(w);
        await recordFor(w, h, 2000);
        if (where === "paused") {
          w.appState.emit("background");
          await W.flush();
        }
        if (where === "recorded") await h.r().stop();
        h.hook.unmount();
        await W.flush();
        assert.equal(w.audio.log.instances[0].released, true, where);
        assert.ok(!w.fs.has(W.IN_PROGRESS_URI), where);
        assert.equal(w.fs.has(FINAL), where === "recorded", where);
        assert.equal(w.appState.count(), 0, where);
        assert.equal(W.clock.timers.size, 0, where);
      }
    });
    await test("hook: a double tap makes one recorder, and a start is ignored while a take exists", async () => {
      const w = world();
      const h = mount(w);
      await Promise.all([h.r().start(), h.r().start()]);
      await W.flush();
      assert.equal(w.audio.log.instances.length, 1);
      await h.r().start();
      assert.equal(w.audio.log.instances.length, 1);
      await W.advance(1500);
      await h.r().stop();
      await h.r().start();
      assert.equal(w.audio.log.instances.length, 1);
      assert.equal(h.r().state, "recorded");
    });
    await test("hook: a start that fails shows the start message, and trying again works", async () => {
      const w = world();
      const h = mount(w);
      w.audio.flags.rejectPrepare = true;
      await recordFor(w, h, 100);
      assert.equal(h.r().state, "idle");
      assert.equal(h.r().error, "start");
      assert.equal(w.audio.log.instances[0].released, true);
      w.audio.flags.rejectPrepare = false;
      await recordFor(w, h, 100);
      assert.equal(h.r().state, "recording");
      assert.equal(h.r().error, null);
    });
    await test("hook: stop does nothing when there is no take, and a double stop makes one file", async () => {
      const w = world();
      const h = mount(w);
      assert.equal(await h.r().stop(), null);
      await recordFor(w, h, 1500);
      const [a, b] = await Promise.all([h.r().stop(), h.r().stop()]);
      assert.ok((a === null) !== (b === null));
      assert.equal(w.audio.log.instances[0].stops, 1);
      assert.equal(await h.r().stop(), null);
    });
    await test("hook: the same entry can be recorded again after a discard and replaces the file", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1500);
      await h.r().stop();
      await h.r().discard();
      await recordFor(w, h, 2500);
      const kept = await h.r().stop();
      assert.equal(kept.durationMs, 2500);
      assert.equal(kept.uri, FINAL);
      assert.equal(w.fs.files.size, 1);
    });
    await test("hook: a whole session writes nothing to the console", async () => {
      const w = world();
      const h = mount(w);
      await recordFor(w, h, 1000);
      w.appState.emit("background");
      await W.flush();
      await h.r().resume();
      await W.advance(500);
      await h.r().stop();
      await h.r().discard();
      assert.deepEqual(output, []);
    });
  }

  finished = true;
  const out = (text) => require("node:fs").writeSync(1, text + String.fromCharCode(10));
  out(`${passed} passed, ${failures.length} failed`);
  for (const failure of failures) out(`FAIL ${failure}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
})();
