// Fakes for the step 26 checks: expo-audio's AudioPlayer shaped like 58.0.x on iOS and on Android (the two platforms say
// "waiting for data" differently), expo-file-system's download, Storage's createSignedUrl, expo-asset and the lock screen.
// The app's real player store, audio session, devotional files and lock screen run on top of them, on the recording checks'
// virtual clock, so a download, a buffering pause or the end of a devotional takes no real time.
const path = require("node:path");

// The loader reads GRACEHUSH_REPO when it is first required: default to this repo, or run against a copy of it.
const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const recording = require("../recording/world.cjs");
const { makeEnv, storageJs, clock, installClock, uninstallClock, makeFs, makeAudio, makeKeepAwake, makeAppState } = recording;

// ------------------------------------------------------------------ settling
// A chain of awaits (the session, the link, the download, the player) needs more turns than the recording checks' 20.
async function flush() {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}
// Runs every virtual timer that falls due in the next `ms` milliseconds, in order, letting promises settle after each one.
async function advance(ms) {
  await flush();
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

// ------------------------------------------------------------------ the file system, with expo-file-system 58's download
// `script.downloads` is a queue of outcomes for the next downloads: { ms } (how long it takes), { error } (the message it
// fails with), { partial } (bytes an Android download leaves behind when it fails), { bytes } (the size it saves).
function makePlaybackFs() {
  const fs = makeFs();
  fs.Paths.cache = new fs.Directory("file:///cache/");
  const script = { downloads: [] };
  const calls = { downloads: [] };
  const aborted = () => Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  fs.File.downloadFileAsync = async (url, destination, options) => {
    calls.downloads.push({ url, to: destination.uri, options });
    const parent = destination.uri.slice(0, destination.uri.lastIndexOf("/"));
    if (!fs.dirs.has(parent)) throw new Error("The destination folder does not exist");
    const step = script.downloads.shift() ?? {};
    const signal = options?.signal;
    if (signal?.aborted) throw aborted();
    if ((step.ms ?? 0) > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, step.ms);
        // ignoreAbort: an answer that was already on its way when the abort came, so the call does not stop.
        if (!step.ignoreAbort) {
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(aborted());
            },
            { once: true },
          );
        }
      });
    } else {
      await Promise.resolve();
    }
    if (step.partial) fs.put(destination.uri, step.partial);
    if (step.error) throw new Error(step.error);
    fs.put(destination.uri, step.bytes ?? 50_000);
    return new fs.File(destination.uri);
  };
  return { fs, script, calls };
}

// ------------------------------------------------------------------ Storage: only createSignedUrl
// `script.signed` is a queue of outcomes: a value to return as { data, error }, or a function to run (it may throw).
function makeSupabase() {
  const calls = { signed: [] };
  const script = { signed: [] };
  const client = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (objectPath, seconds) => {
          calls.signed.push({ bucket, path: objectPath, seconds });
          const next = script.signed.shift();
          if (typeof next === "function") return next();
          if (next) return next;
          return {
            data: { signedUrl: `https://project.example/storage/v1/object/sign/${bucket}/${objectPath}?token=t${calls.signed.length}` },
            error: null,
          };
        },
      }),
    },
  };
  return { client, calls, script };
}

// ------------------------------------------------------------------ expo-asset: the bundled artwork becomes a local file
function makeAsset(flags) {
  const calls = { fromModule: [], downloads: 0 };
  class Asset {
    constructor(module_) {
      this.module = module_;
      this.localUri = null;
      this.uri = "http://dev-server.example/assets/player-artwork.png";
    }
    static fromModule(module_) {
      calls.fromModule.push(module_);
      return new Asset(module_);
    }
    async downloadAsync() {
      calls.downloads += 1;
      if ((flags.artworkMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, flags.artworkMs));
      if (flags.artworkFails) throw new Error("the asset could not be loaded");
      this.localUri = "file:///assets/player-artwork.png";
      return this;
    }
  }
  return { Asset, calls };
}

// ------------------------------------------------------------------ expo-audio's AudioPlayer
// What each platform reports (read in expo-audio 58.0.10's iOS and Android sources):
//  - iOS: `playing` is true only when sound is coming out. While a play that was asked for waits for data,
//    timeControlStatus is "waitingToPlayAtSpecifiedRate". `isBuffering` is also true for a PAUSED player whose buffer is
//    empty (flags.emptyBufferWhenPaused models that). A pause and a start are reported by the periodic time observer.
//  - Android: ExoPlayer is "buffering" from prepare() until it is ready, and while it buffers `playing` keeps the value the
//    person asked for (intendedPlayingState). timeControlStatus is only "playing" or "paused".
// The `flags` object is shared with the test, which can change it at any time.
function makePlayers(flags) {
  const players = [];
  const created = [];

  class FakePlayer {
    constructor(source, options) {
      this.id = `player-${players.length + 1}`;
      this.source = source;
      this.options = options;
      this.released = false;
      this.suspended = false; // JS asleep: events are sent and lost
      this.listeners = [];
      this.duration = flags.durationMs / 1000;
      this.pos = 0; // seconds at `rebased`
      this.rebased = clock.now;
      this.rate = 1;
      this.wants = false; // play() was called and pause() was not (ExoPlayer's playWhenReady)
      // Android's report keeps the last wish that onIsPlayingChanged saw while ExoPlayer buffers (intendedPlayingState): it
      // is set when sound starts and cleared when sound stops or the end comes, and a pause during buffering does not clear it.
      this.intended = false;
      this.sound = false; // sound is coming out
      this.loaded = false;
      this.failed = false;
      this.ended = false;
      this.buffering = false;
      this.bufferedOnce = false;
      this.timer = null;
      this.willFail = false;
      this.calls = { play: 0, pause: 0, seekTo: [], setRate: [], setActive: [], updateMeta: [], clear: 0, release: 0 };
      players.push(this);
      created.push({ source, options });
      if (flags.failNextLoads > 0) {
        flags.failNextLoads -= 1;
        this.willFail = true;
      }
      if (flags.preloaded) this.loaded = true;
      else if (!flags.loadNever) {
        setTimeout(() => {
          if (this.released) return;
          if (this.willFail) {
            this.failed = true;
            this._emit({ error: "The operation could not be completed" });
          } else {
            this.loaded = true;
            this._emit();
          }
        }, flags.loadMs);
      }
    }

    _alive() {
      if (this.released) throw new Error("This player was released");
    }
    _now() {
      return this.sound ? this.pos + ((clock.now - this.rebased) / 1000) * this.rate : this.pos;
    }
    _rebase() {
      this.pos = Math.min(this._now(), this.duration);
      this.rebased = clock.now;
    }
    get currentTime() {
      this._alive();
      return Math.min(this._now(), this.duration);
    }
    get isLoaded() {
      this._alive();
      return this.loaded;
    }
    get playing() {
      this._alive();
      return this.sound;
    }
    get currentStatus() {
      this._alive();
      return this._status();
    }

    _waiting() {
      return this.wants && !this.ended && !this.failed && !this.sound;
    }

    _status() {
      const time = Math.min(this._now(), this.duration);
      const waiting = this._waiting();
      const base = {
        id: this.id,
        currentTime: time,
        mute: false,
        loop: false,
        didJustFinish: false,
        playbackRate: this.rate,
        shouldCorrectPitch: true,
        isLive: false,
        currentOffsetFromLive: null,
        error: null,
      };
      if (flags.platform === "ios") {
        return {
          ...base,
          playbackState: this.failed ? "failed" : this.loaded ? "readyToPlay" : "unknown",
          timeControlStatus: this.sound ? "playing" : waiting ? "waitingToPlayAtSpecifiedRate" : "paused",
          reasonForWaitingToPlay: waiting ? "evaluatingBufferingRate" : "unknown",
          duration: this.loaded ? this.duration : 0,
          playing: this.sound,
          isBuffering: this.sound ? false : waiting ? true : flags.emptyBufferWhenPaused === true,
          isLoaded: this.loaded,
        };
      }
      const state = this.ended ? "ended" : !this.loaded || this.buffering ? "buffering" : "ready";
      const isBuffering = state === "buffering";
      const playing = isBuffering ? this.intended : this.sound;
      return {
        ...base,
        playbackState: state,
        timeControlStatus: playing ? "playing" : "paused",
        reasonForWaitingToPlay: null,
        duration: this.loaded ? this.duration : 0,
        playing,
        isBuffering,
        isLoaded: this.loaded || this.ended,
      };
    }

    // A report has the content of the moment it was made. With flags.reportLagMs it reaches the app that much later, as a
    // native event does (the periodic observer on iOS, the bridge on both); a report that is on its way is lost with the player.
    _emit(extra = {}) {
      if (this.released || this.suspended) return;
      const status = { ...this._status(), ...extra };
      const deliver = () => {
        for (const listener of [...this.listeners]) listener(status);
      };
      if (!(flags.reportLagMs > 0)) {
        deliver();
        return;
      }
      setTimeout(() => {
        if (!this.released && !this.suspended) deliver();
      }, flags.reportLagMs);
    }

    _update() {
      if (this.released) return;
      const wantsSound = this.wants && !this.ended && !this.failed;
      if (!wantsSound) {
        if (this.sound) this._stopSound();
        return;
      }
      if (this.sound || !this.loaded || this.buffering) return;
      if (flags.bufferMs > 0 && !this.bufferedOnce) {
        this.buffering = true;
        this.bufferedOnce = true;
        setTimeout(() => {
          this.buffering = false;
          this._update();
          if (!this.sound) this._emit();
        }, flags.bufferMs);
        return;
      }
      this._startSound();
    }
    _startSound() {
      this.sound = true;
      this.intended = true;
      this.rebased = clock.now;
      this.timer = setInterval(() => this._tick(), this.options?.updateInterval ?? 500);
      this._emit();
    }
    _stopSound() {
      this._rebase();
      this.sound = false;
      this.intended = false;
      clearInterval(this.timer);
      this.timer = null;
      this._emit();
    }
    _tick() {
      if (this._now() >= this.duration) this._end();
      else this._emit();
    }
    _end() {
      this.pos = this.duration;
      this.rebased = clock.now;
      this.sound = false;
      this.intended = false;
      this.ended = true;
      // iOS drops its rate to 0 at the end; ExoPlayer keeps playWhenReady, so a seek after the end starts playing again.
      this.wants = flags.platform === "android";
      clearInterval(this.timer);
      this.timer = null;
      this._emit({ didJustFinish: true, playing: false, currentTime: this.duration });
    }

    // ---- what the app calls
    addListener(name, listener) {
      this._alive();
      if (name !== "playbackStatusUpdate") throw new Error(`no such event: ${name}`);
      this.listeners.push(listener);
      this.lastListener = listener;
      return { remove: () => void (this.listeners = this.listeners.filter((fn) => fn !== listener)) };
    }
    play() {
      this._alive();
      this.calls.play += 1;
      this.wants = true;
      // A player left at its end plays nothing and finishes again at once (AVPlayer).
      if (this.ended) {
        this._end();
        return;
      }
      this._update();
      if (!this.sound) this._emit();
    }
    pause() {
      this._alive();
      this.calls.pause += 1;
      this.wants = false;
      if (this.sound) this._stopSound();
      else this._emit();
    }
    seekTo(seconds) {
      this._alive();
      this.calls.seekTo.push(seconds);
      return new Promise((resolve) => {
        setTimeout(() => {
          if (!this.released) {
            this._rebase();
            // A seek can land a little away from where it was asked to (a tolerance, a keyframe).
            this.pos = Math.min(Math.max(seconds + (flags.seekOffsetSec ?? 0), 0), this.duration);
            this.rebased = clock.now;
            this.ended = this.pos >= this.duration;
            this._update();
            this._emit();
          }
          resolve();
        }, flags.seekMs);
      });
    }
    setPlaybackRate(rate, quality) {
      this._alive();
      this.calls.setRate.push([rate, quality]);
      this._rebase();
      this.rate = rate;
    }
    setActiveForLockScreen(active, metadata, options) {
      this._alive();
      if (flags.setActiveThrows) throw new Error("the lock screen could not be set up");
      this.calls.setActive.push({ active, metadata, options });
    }
    updateLockScreenMetadata(metadata) {
      this._alive();
      this.calls.updateMeta.push(metadata);
    }
    clearLockScreenControls() {
      this._alive();
      this.calls.clear += 1;
    }
    release() {
      if (this.released) return;
      this.calls.release += 1;
      this.released = true;
      clearInterval(this.timer);
      this.timer = null;
    }

    // ---- what the system does without the app asking
    systemPause() {
      this.wants = false;
      if (this.sound) this._stopSound();
      else this._emit();
    }
    systemPlay() {
      this.wants = true;
      this._update();
      if (!this.sound) this._emit();
    }
    // Playing stops for a while because the player waits for data again (a seek on a slow disk, a lost network).
    rebuffer(ms) {
      if (!this.sound) return;
      this._rebase();
      this.sound = false;
      clearInterval(this.timer);
      this.timer = null;
      this.buffering = true;
      this.bufferedOnce = true;
      this._emit();
      setTimeout(() => {
        this.buffering = false;
        this._update();
        if (!this.sound) this._emit();
      }, ms);
    }
    // The player waits for data with no sound coming out: ExoPlayer is "buffering" after a seek even while it is paused.
    // (iOS reports a wait only for a play that was asked for, so there it changes nothing.)
    waitForData(ms) {
      this.buffering = true;
      this._emit();
      setTimeout(() => {
        this.buffering = false;
        this._update();
        if (!this.sound) this._emit();
      }, ms);
    }
    remoteSkip(seconds) {
      this._rebase();
      this.pos = Math.min(Math.max(this.pos + seconds, 0), this.duration);
      this.rebased = clock.now;
      this._emit();
    }
    failNow(message) {
      if (this.sound) this._stopSound();
      this.failed = true;
      this.wants = false;
      this._emit({ error: message });
    }
    emitRaw(status) {
      for (const listener of [...this.listeners]) listener(status);
    }
  }

  return { FakePlayer, players, created };
}

function newFlags(platform) {
  return {
    platform,
    durationMs: 113_200,
    loadMs: 30,
    seekMs: 20,
    bufferMs: 0,
    reportLagMs: 0,
    failNextLoads: 0,
    loadNever: false,
    seekOffsetSec: 0,
    preloaded: false,
    createThrows: false,
    setActiveThrows: false,
    failMode: false,
    emptyBufferWhenPaused: false,
    artworkFails: false,
    artworkMs: 0,
  };
}

// ------------------------------------------------------------------ the whole world
function world({ platform = "ios", extraFakes = {} } = {}) {
  installClock();
  const flags = newFlags(platform);
  const { fs, script: fsScript, calls: fsCalls } = makePlaybackFs();
  const recorderAudio = makeAudio(fs);
  const keep = makeKeepAwake();
  const appState = makeAppState();
  const supa = makeSupabase();
  const asset = makeAsset(flags);
  const { FakePlayer, players, created } = makePlayers(flags);
  const session = { client: supa.client, userId: "user_a" };

  const audioModule = {
    ...recorderAudio.module,
    createAudioPlayer: (source, options) => {
      if (flags.createThrows) throw new Error("the player could not be made");
      return new FakePlayer(source, options);
    },
    setAudioModeAsync: async (mode) => {
      if (flags.failMode) throw new Error("audio mode failed");
      recorderAudio.log.modes.push(mode);
    },
  };

  const fakes = {
    "expo-audio": audioModule,
    "expo-audio/build/utils/options": recorderAudio.options,
    "expo-file-system": { File: fs.File, Directory: fs.Directory, Paths: fs.Paths },
    "expo-asset": { Asset: asset.Asset },
    "expo-keep-awake": keep.module,
    "react-native": { AppState: appState.module.AppState, Platform: { OS: platform } },
    "@supabase/supabase-js": { StorageApiError: storageJs.StorageApiError },
    "@/services/supabaseClient": { getSupabase: () => session.client, getSupabaseUserId: () => session.userId },
    "@/constants/images": { images: { playerArtwork: 7 } },
    expo: { PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" } },
    ...extraFakes,
  };
  const env = makeEnv({ fakes });
  return {
    env,
    flags,
    fs,
    fsScript,
    fsCalls,
    audio: recorderAudio,
    expoAudio: audioModule,
    keep,
    appState,
    supa,
    asset,
    players,
    created,
    session,
    store: () => env.use("@/store/playerStore").usePlayerStore,
    modes: () => recorderAudio.log.modes,
    // The newest player that has not been released, or null.
    live: () => players.filter((player) => !player.released).at(-1) ?? null,
  };
}

// A devotional as the app's getPlaybackTrack makes it.
function track(n = 1, extra = {}) {
  return {
    entryId: `entry-${n}`,
    title: `Peace in the midst ${n}`,
    subtitle: "Gracehush • Psalm 23:1–3",
    durationMs: 113_200,
    audioPath: `user_a/devotionals/entry-${n}.wav`,
    ...extra,
  };
}

module.exports = {
  makeEnv,
  storageJs,
  clock,
  installClock,
  uninstallClock,
  flush,
  advance,
  world,
  track,
};
