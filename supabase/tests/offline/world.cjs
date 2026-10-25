// Fakes for the step 24 checks: expo-sqlite shaped like 58's (backed by Node's own SQLite, so every statement the app writes
// runs for real), expo-crypto's AES shaped like 58's (backed by node:crypto), SecureStore, NetInfo, AppState, a recordings
// folder, and a scripted processor. The app's real db, outbox, cache, sync engine, policy and stores run on top of them.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodeCrypto = require("node:crypto");

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const { makeEnv } = require("../profile-sync/loader.cjs");
const { clock, installClock, uninstallClock, flush, advance, makeAppState } = require("../recording/world.cjs");

// ------------------------------------------------------------------ expo-sqlite 58, over node:sqlite
function makeSqlite() {
  const { DatabaseSync } = require("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gracehush-offline-"));
  const fileOf = (name) => path.join(dir, name);
  const stats = { opens: [], closes: 0, deletes: [], failOpen: false };
  const open = new Set();
  const spread = (params) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
  class Db {
    constructor(name) {
      this.name = name;
      this.sync = new DatabaseSync(fileOf(name));
      this.closed = false;
    }
    check() {
      if (this.closed) throw new Error("the database is closed");
    }
    async execAsync(sql) {
      this.check();
      this.sync.exec(sql);
    }
    async runAsync(sql, ...params) {
      this.check();
      const result = this.sync.prepare(sql).run(...spread(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    }
    async getFirstAsync(sql, ...params) {
      this.check();
      const row = this.sync.prepare(sql).get(...spread(params));
      return row === undefined ? null : { ...row };
    }
    async getAllAsync(sql, ...params) {
      this.check();
      return this.sync
        .prepare(sql)
        .all(...spread(params))
        .map((row) => ({ ...row }));
    }
    async withTransactionAsync(task) {
      this.check();
      this.sync.exec("BEGIN");
      try {
        await task();
        this.sync.exec("COMMIT");
      } catch (error) {
        try {
          this.sync.exec("ROLLBACK");
        } catch {
          // Already rolled back.
        }
        throw error;
      }
    }
    async closeAsync() {
      if (this.closed) return;
      this.closed = true;
      this.sync.close();
      open.delete(this);
      stats.closes += 1;
    }
  }
  const module = {
    __esModule: true,
    openDatabaseAsync: async (name) => {
      if (stats.failOpen) throw new Error("cannot open");
      stats.opens.push(name);
      const db = new Db(name);
      open.add(db);
      return db;
    },
    deleteDatabaseAsync: async (name) => {
      const file = fileOf(name);
      if (!fs.existsSync(file)) throw new Error("the database does not exist");
      stats.deletes.push(name);
      for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(file + suffix, { force: true });
    },
  };
  return {
    module,
    stats,
    dir,
    files: () => fs.readdirSync(dir),
    exists: (name) => fs.existsSync(fileOf(name)),
    // A second, plain connection to the file: what someone with the phone's files would see.
    raw: (name) => new DatabaseSync(fileOf(name), { readOnly: true }),
    openCount: () => open.size,
    cleanup() {
      for (const db of [...open]) db.sync.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ------------------------------------------------------------------ expo-crypto 58 (digest, random, native AES)
function makeCrypto() {
  class AESEncryptionKey {
    constructor(raw) {
      this.raw = raw;
    }
    static async generate(size) {
      return new AESEncryptionKey(nodeCrypto.randomBytes(size / 8));
    }
    static async import(text, encoding) {
      if (encoding !== "base64") throw new Error("the fake imports base64 only");
      return new AESEncryptionKey(Buffer.from(text, "base64"));
    }
    async encoded() {
      return this.raw.toString("base64");
    }
  }
  class AESSealedData {
    constructor(buffer) {
      this.buffer = buffer;
    }
    static fromCombined(text) {
      return new AESSealedData(Buffer.from(text, "base64"));
    }
    async combined() {
      return this.buffer.toString("base64");
    }
  }
  return {
    __esModule: true,
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (algorithm, text) => nodeCrypto.createHash("sha256").update(text).digest("hex"),
    randomUUID: () => nodeCrypto.randomUUID(),
    AESEncryptionKey,
    AESKeySize: { AES128: 128, AES192: 192, AES256: 256 },
    AESSealedData,
    aesEncryptAsync: async (bytes, key) => {
      const nonce = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key.raw, nonce);
      const body = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
      return new AESSealedData(Buffer.concat([nonce, body, cipher.getAuthTag()]));
    },
    aesDecryptAsync: async (sealed, key) => {
      const all = sealed.buffer;
      if (all.length < 28) throw new Error("too short");
      const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key.raw, all.subarray(0, 12));
      decipher.setAuthTag(all.subarray(all.length - 16));
      return new Uint8Array(Buffer.concat([decipher.update(all.subarray(12, all.length - 16)), decipher.final()]));
    },
  };
}

// ------------------------------------------------------------------ expo-secure-store
function makeSecureStore() {
  const items = new Map();
  const options = new Map();
  const state = { failRead: false };
  return {
    items,
    options,
    state,
    module: {
      __esModule: true,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
      getItemAsync: async (key) => {
        if (state.failRead) throw new Error("the keychain is locked");
        return items.has(key) ? items.get(key) : null;
      },
      setItemAsync: async (key, value, opts) => {
        items.set(key, value);
        options.set(key, opts);
      },
      deleteItemAsync: async (key) => void items.delete(key),
    },
  };
}

// ------------------------------------------------------------------ @react-native-community/netinfo
function makeNetInfo() {
  let state = { isConnected: null, isInternetReachable: null };
  const listeners = new Set();
  return {
    module: {
      __esModule: true,
      default: {
        addEventListener: (listener) => {
          listeners.add(listener);
          listener({ ...state });
          return () => listeners.delete(listener);
        },
      },
    },
    emit(next) {
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener({ ...state });
    },
    count: () => listeners.size,
  };
}

// ------------------------------------------------------------------ recordings/ (services/recordingFiles)
function makeRecordings() {
  const files = new Map(); // client entry id -> modifiedAt (0 when unknown)
  const log = [];
  return {
    files,
    log,
    module: {
      __esModule: true,
      deleteRecording: async (id) => {
        log.push(`delete ${id}`);
        files.delete(id);
      },
      listRecordings: () =>
        [...files].map(([clientEntryId, modifiedAt]) => ({
          clientEntryId,
          uri: `file:///recordings/${clientEntryId}.m4a`,
          sizeBytes: 1,
          modifiedAt,
        })),
      deleteAllRecordings: async () => {
        log.push("delete all");
        files.clear();
      },
    },
  };
}

// ------------------------------------------------------------------ the processor (services/entryProcessor)
function entryFor(item, extra = {}) {
  const iso = new Date(clock.now).toISOString();
  return {
    id: `entry-${item.clientEntryId}`,
    clientEntryId: item.clientEntryId,
    createdAt: iso,
    updatedAt: iso,
    inputType: item.inputType,
    transcript: null,
    dominantEmotion: "anxious",
    status: "ready",
    isCrisis: false,
    scripture: null,
    devotional: null,
    prayer: null,
    failureCode: null,
    isLocalOnly: false,
    ...extra,
  };
}

function affirmationsFor(entryId) {
  return ["morning", "afternoon", "evening"].map((slot) => ({
    id: `affirmation-${entryId}-${slot}`,
    entryId,
    slot,
    headline: `Headline ${slot}`,
    text: `Text ${slot}`,
    isFavorite: false,
  }));
}

// `script` is a queue of outcomes (or functions that return a promise of one). An empty queue answers success.
function makeProcessor() {
  const processor = {
    isMock: false,
    script: [],
    calls: [],
    concurrent: 0,
    maxConcurrent: 0,
    stages: [],
    ok(item, extra) {
      const entry = entryFor(item, extra);
      return { ok: true, entry, affirmations: affirmationsFor(entry.id) };
    },
  };
  processor.module = {
    __esModule: true,
    get processorIsMock() {
      return processor.isMock;
    },
    processItem: async (item, onStage) => {
      processor.calls.push({ id: item.clientEntryId, attempts: item.attempts, status: item.status, at: Date.now() });
      processor.concurrent += 1;
      processor.maxConcurrent = Math.max(processor.maxConcurrent, processor.concurrent);
      try {
        onStage("receiving");
        const next = processor.script.shift();
        if (next === undefined) return processor.ok(item);
        const outcome = typeof next === "function" ? await next(item, onStage) : next;
        return outcome;
      } finally {
        processor.concurrent -= 1;
      }
    },
  };
  return processor;
}

// ------------------------------------------------------------------ one world per test
// The fakes, the app's real modules on top of them, and a captured log.
function makeWorld({ tier = "free" } = {}) {
  const sqlite = makeSqlite();
  const secure = makeSecureStore();
  const net = makeNetInfo();
  const appState = makeAppState();
  const recordings = makeRecordings();
  const processor = makeProcessor();
  const world = { tier };
  const logs = [];
  const fakes = {
    "expo-sqlite": sqlite.module,
    "expo-crypto": makeCrypto(),
    "expo-secure-store": secure.module,
    "@react-native-community/netinfo": net.module,
    "react-native": appState.module,
    "@/services/recordingFiles": recordings.module,
    "@/services/entryProcessor": processor.module,
    "@/data/journalRepository": { __esModule: true, getKnownTier: () => world.tier },
  };
  const env = makeEnv({ fakes });
  const capture = (...args) => void logs.push(args.map(String).join(" "));
  const real = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = capture;
  return {
    env,
    sqlite,
    secure,
    net,
    appState,
    recordings,
    processor,
    world,
    logs,
    use: (spec) => env.use(spec),
    close() {
      console.log = real.log;
      console.info = real.info;
      console.warn = real.warn;
      sqlite.cleanup();
    },
  };
}

// Lets promises settle: the engine awaits a database call, a decrypt and an event several times in a row.
async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i += 1) await flush();
}

module.exports = {
  makeWorld,
  makeSqlite,
  makeCrypto,
  entryFor,
  affirmationsFor,
  clock,
  installClock,
  uninstallClock,
  advance,
  flush,
  settle,
};
