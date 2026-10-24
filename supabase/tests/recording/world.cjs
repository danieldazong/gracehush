// Fakes for the step 23 checks: a virtual clock, an in-memory file system shaped like expo-file-system 58, a recorder
// shaped like expo-audio 58's AudioRecorder, a Storage client, and a tiny React hooks runtime. The app's real
// recorder, recordingFiles, mediaUpload and useRecorder files run on top of them.
const path = require("node:path");
const { createRequire } = require("node:module");

// The loader reads GRACEHUSH_REPO when it is first required: default to this repo, or run against a copy of it.
const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const { makeEnv } = require("../profile-sync/loader.cjs");
const storageJs = createRequire(path.join(REPO, "harness.js"))("@supabase/storage-js");

// ------------------------------------------------------------------ virtual clock
const real = { setTimeout, clearTimeout, setInterval, clearInterval, now: Date.now };
const clock = { now: 1_700_000_000_000, timers: new Map(), seq: 0 };
function installClock() {
  clock.timers.clear();
  globalThis.setInterval = (fn, ms) => {
    const id = ++clock.seq;
    clock.timers.set(id, { fn, ms, at: clock.now + ms, repeat: true });
    return id;
  };
  globalThis.setTimeout = (fn, ms = 0) => {
    const id = ++clock.seq;
    clock.timers.set(id, { fn, ms, at: clock.now + ms, repeat: false });
    return id;
  };
  globalThis.clearInterval = globalThis.clearTimeout = (id) => void clock.timers.delete(id);
  Date.now = () => clock.now;
}
function uninstallClock() {
  globalThis.setInterval = real.setInterval;
  globalThis.setTimeout = real.setTimeout;
  globalThis.clearInterval = real.clearInterval;
  globalThis.clearTimeout = real.clearTimeout;
  Date.now = real.now;
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
// Runs every timer that falls due in the next `ms` milliseconds, in order, letting promises settle after each one.
async function advance(ms) {
  await flush(); // timers that a pending promise is about to set must exist before they are looked for
  const end = clock.now + ms;
  for (;;) {
    let next = null;
    for (const [id, timer] of clock.timers) {
      if (timer.at <= end && (next === null || timer.at < next.timer.at)) next = { id, timer };
    }
    if (next === null) break;
    clock.now = Math.max(clock.now, next.timer.at);
    if (next.timer.repeat) next.timer.at += next.timer.ms;
    else clock.timers.delete(next.id);
    next.timer.fn();
    await flush();
  }
  clock.now = end;
  await flush();
}

// ------------------------------------------------------------------ in-memory file system (expo-file-system 58 shape)
function makeFs() {
  const files = new Map(); // uri -> { bytes: Buffer, mtime: number }
  const dirs = new Set(["file:///docs"]);
  const strip = (uri) => uri.replace(/\/+$/, "");
  const join = (...parts) => {
    let out = "";
    for (const part of parts) {
      const uri = strip(typeof part === "string" ? part : part.uri);
      out = uri.startsWith("file://") || out === "" ? uri : `${out}/${uri}`;
    }
    return out;
  };
  const stats = { reads: 0, failReads: false, failDelete: false };
  class File {
    constructor(...parts) {
      this._uri = join(...parts);
    }
    get uri() {
      return this._uri;
    }
    get exists() {
      return files.has(this._uri);
    }
    get size() {
      return files.get(this._uri)?.bytes.length ?? 0;
    }
    get name() {
      return this._uri.split("/").pop();
    }
    get lastModified() {
      return files.get(this._uri)?.mtime ?? null;
    }
    delete() {
      if (stats.failDelete) throw new Error("cannot delete");
      if (!files.has(this._uri)) throw new Error("no such file");
      files.delete(this._uri);
    }
    async move(destination, options) {
      const target = destination.uri;
      if (!files.has(this._uri)) throw new Error("no such file");
      if (target === this._uri) throw new Error("source and destination are the same file");
      if (files.has(target) && !options?.overwrite) throw new Error("destination exists");
      files.set(target, files.get(this._uri));
      if (target !== this._uri) files.delete(this._uri);
      this._uri = target;
    }
    async arrayBuffer() {
      stats.reads++;
      if (stats.failReads) throw new Error("cannot read");
      const entry = files.get(this._uri);
      if (!entry) throw new Error("no such file");
      return entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.length);
    }
  }
  class Directory {
    constructor(...parts) {
      this._uri = join(...parts);
    }
    get uri() {
      return this._uri;
    }
    get exists() {
      return dirs.has(this._uri);
    }
    create(options) {
      if (dirs.has(this._uri) && !options?.idempotent) throw new Error("exists");
      dirs.add(this._uri);
    }
    delete() {
      if (stats.failDelete) throw new Error("cannot delete");
      if (!dirs.has(this._uri)) throw new Error("no such directory");
      for (const uri of [...files.keys()]) if (uri.startsWith(`${this._uri}/`)) files.delete(uri);
      for (const uri of [...dirs]) if (uri === this._uri || uri.startsWith(`${this._uri}/`)) dirs.delete(uri);
    }
    list() {
      const out = [];
      for (const uri of files.keys()) {
        if (uri.startsWith(`${this._uri}/`) && !uri.slice(this._uri.length + 1).includes("/")) out.push(new File(uri));
      }
      return out;
    }
  }
  const Paths = { document: new Directory("file:///docs/") };
  return {
    File,
    Directory,
    Paths,
    files,
    dirs,
    stats,
    put(uri, size, mtime = clock.now) {
      files.set(uri, { bytes: Buffer.alloc(size, 7), mtime });
    },
    has: (uri) => files.has(uri),
  };
}

// ------------------------------------------------------------------ expo-audio (the recorder part), shaped like 58.0.x
const IN_PROGRESS_URI = "file:///docs/ExpoAudio/recording-in-progress.m4a";
function makeAudio(fs) {
  const log = { modes: [], permissionAsks: 0, instances: [] };
  const flags = {
    rejectPrepare: false,
    throwOnRecord: false,
    stallOnRecord: false, // iOS answers "recording" but the clock never moves (a call still has the microphone)
    stopThrows: false,
    zeroAfterStop: true, // iOS reports 0 once the recorder has stopped
    fileBytes: 4096,
    noUri: false,
    failMode: false,
    autoResumeAppPaused: false, // an older expo-audio resumes even a recorder the app paused
    permission: { granted: true, status: "granted", canAskAgain: true },
    askResult: { granted: true, status: "granted", canAskAgain: true },
    permissionThrows: false,
    db: -160,
  };
  class AudioRecorder {
    constructor(options) {
      this.options = options;
      this.recording = false;
      this.accum = 0;
      this.startedAt = 0;
      this.stopped = false;
      this.released = false;
      this.systemPaused = false;
      this.stalled = false;
      this.pauses = 0;
      this.records = 0;
      this.stops = 0;
      log.instances.push(this);
    }
    get uri() {
      return flags.noUri ? null : IN_PROGRESS_URI;
    }
    async prepareToRecordAsync() {
      if (flags.rejectPrepare) throw new Error("prepare failed");
    }
    record() {
      this.records++;
      if (flags.throwOnRecord) throw new Error("record failed");
      this.recording = true;
      this.systemPaused = false;
      this.stalled = flags.stallOnRecord;
      this.startedAt = clock.now;
    }
    pause() {
      this.pauses++;
      if (this.recording && !this.stalled) this.accum += clock.now - this.startedAt;
      this.recording = false;
      this.systemPaused = false; // an explicit pause clears the library's own "paused by the system" mark
    }
    systemPause() {
      if (this.recording && !this.stalled) this.accum += clock.now - this.startedAt;
      this.recording = false;
      this.systemPaused = true;
    }
    // What the library does when an interruption ends or the app returns: it resumes only what it paused itself
    // (since 58.0.6), or anything at all in the older behaviour the flag models.
    systemResume() {
      if (this.stopped || this.released) return;
      if (this.systemPaused || flags.autoResumeAppPaused) {
        this.recording = true;
        this.systemPaused = false;
        this.startedAt = clock.now;
      }
    }
    getStatus() {
      const live = this.recording && !this.stalled ? clock.now - this.startedAt : 0;
      const duration = this.stopped && flags.zeroAfterStop ? 0 : this.accum + live;
      return {
        canRecord: true,
        isRecording: this.recording,
        durationMillis: duration,
        mediaServicesDidReset: false,
        url: this.uri,
        metering: this.recording && !this.stalled ? flags.db : -160,
      };
    }
    async stop() {
      this.stops++;
      if (flags.stopThrows) throw new Error("stop failed");
      if (this.recording && !this.stalled) this.accum += clock.now - this.startedAt;
      this.recording = false;
      this.stopped = true;
      fs.put(IN_PROGRESS_URI, flags.fileBytes);
    }
    release() {
      this.released = true;
    }
  }
  const module_ = {
    AudioModule: { AudioRecorder },
    AudioQuality: { HIGH: 96 },
    IOSOutputFormat: { MPEG4AAC: "aac " },
    setAudioModeAsync: async (mode) => {
      if (flags.failMode) throw new Error("audio mode failed");
      log.modes.push(mode);
    },
    getRecordingPermissionsAsync: async () => {
      if (flags.permissionThrows) throw new Error("permission read failed");
      return flags.permission;
    },
    requestRecordingPermissionsAsync: async () => {
      log.permissionAsks++;
      if (flags.permissionThrows) throw new Error("permission request failed");
      flags.permission = flags.askResult;
      return flags.askResult;
    },
  };
  // expo-audio's own helper, as the real file builds it for the platform.
  const options = {
    createRecordingOptions: (o) => ({
      extension: o.extension,
      sampleRate: o.sampleRate,
      numberOfChannels: o.numberOfChannels,
      bitRate: o.bitRate,
      isMeteringEnabled: o.isMeteringEnabled ?? false,
      directory: o.directory,
      fileName: o.fileName,
      ...o.ios,
    }),
  };
  return { module: module_, options, log, flags, AudioRecorder };
}

function makeKeepAwake() {
  const calls = [];
  return {
    calls,
    module: {
      activateKeepAwakeAsync: async (tag) => void calls.push(["on", tag]),
      deactivateKeepAwake: async (tag) => void calls.push(["off", tag]),
    },
  };
}

function makeAppState() {
  const listeners = new Set();
  return {
    module: {
      AppState: {
        currentState: "active",
        addEventListener: (type, fn) => {
          listeners.add(fn);
          return { remove: () => listeners.delete(fn) };
        },
      },
    },
    emit: (status) => [...listeners].forEach((fn) => fn(status)),
    count: () => listeners.size,
  };
}

// ------------------------------------------------------------------ a Supabase client with only the Storage calls
// `script.upload` and `script.list` are queues of outcomes: a value to return as { data, error }, or a function to run
// (it may throw or reject). An empty queue answers success.
function makeStorage() {
  const calls = { upload: [], list: [] };
  const script = { upload: [], list: [] };
  const client = {
    storage: {
      from: (bucket) => ({
        upload: async (path, body, options) => {
          calls.upload.push({ bucket, path, body, options });
          const next = script.upload.shift();
          if (typeof next === "function") return next();
          if (next) return next;
          return { data: { path, id: "x", fullPath: `${bucket}/${path}` }, error: null };
        },
        list: async (path, options) => {
          calls.list.push({ bucket, path, options });
          const next = script.list.shift();
          if (typeof next === "function") return next();
          if (next) return next;
          return { data: [], error: null };
        },
      }),
    },
  };
  return { client, calls, script };
}

// ------------------------------------------------------------------ a tiny React: useState, useRef, useCallback, useEffect
function makeReact() {
  let current = null;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(init) {
      const c = current;
      const i = c.cursor++;
      if (!c.hooks[i]) {
        const hook = { value: typeof init === "function" ? init() : init };
        hook.set = (next) => {
          const value = typeof next === "function" ? next(hook.value) : next;
          if (!Object.is(value, hook.value)) {
            hook.value = value;
            c.schedule();
          }
        };
        c.hooks[i] = hook;
      }
      return [c.hooks[i].value, c.hooks[i].set];
    },
    useRef(init) {
      const c = current;
      const i = c.cursor++;
      if (!c.hooks[i]) c.hooks[i] = { current: init };
      return c.hooks[i];
    },
    useCallback(fn, deps) {
      const c = current;
      const i = c.cursor++;
      const hook = c.hooks[i];
      if (hook && sameDeps(hook.deps, deps)) return hook.fn;
      c.hooks[i] = { fn, deps };
      return fn;
    },
    useEffect(fn, deps) {
      const c = current;
      const i = c.cursor++;
      c.pending.push({ i, fn, deps });
    },
  };
  function renderHook(hookFn, ...args) {
    const c = {
      hooks: [],
      cursor: 0,
      pending: [],
      effects: [],
      dirty: false,
      unmounted: false,
      renders: 0,
      result: { current: null },
    };
    c.schedule = () => {
      if (c.dirty || c.unmounted) return;
      c.dirty = true;
      queueMicrotask(() => {
        c.dirty = false;
        if (!c.unmounted) render();
      });
    };
    function render() {
      current = c;
      c.cursor = 0;
      c.pending = [];
      c.renders++;
      try {
        c.result.current = hookFn(...args);
      } finally {
        current = null;
      }
      for (const { i, fn, deps } of c.pending) {
        const previous = c.effects[i];
        if (previous && sameDeps(previous.deps, deps)) continue;
        previous?.cleanup?.();
        c.effects[i] = { deps, cleanup: fn() };
      }
    }
    render();
    return {
      result: c.result,
      renders: () => c.renders,
      unmount() {
        c.unmounted = true;
        for (const effect of c.effects) effect?.cleanup?.();
      },
    };
  }
  return { react, renderHook };
}
module.exports = {
  makeEnv, storageJs, clock, installClock, uninstallClock, flush, advance, makeFs,
  makeAudio, makeKeepAwake, makeAppState, makeStorage, makeReact, IN_PROGRESS_URI,
};
