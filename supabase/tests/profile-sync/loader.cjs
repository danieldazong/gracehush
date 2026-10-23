// A tiny TypeScript loader for the profile sync checks (run.cjs): it transpiles the app's TypeScript to CommonJS as it is
// required, maps the "@/..." alias to src/, lets a test replace a module with a fake, and gives each test environment
// its own module cache and its own in-memory AsyncStorage. No Metro, no emulator and no extra package: it uses the
// repo's own `typescript`.
//
// It runs against this repo. To run it against a copy of the repo instead, set GRACEHUSH_REPO to that folder.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const repo = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
const ts = require(path.join(repo, "node_modules", "typescript"));
const nodeRequire = createRequire(path.join(repo, "harness.js"));

globalThis.__DEV__ = true;

function resolveFile(base) {
  for (const candidate of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function makeEnv({ stored = {}, fakes = {} } = {}) {
  const storage = new Map(Object.entries(stored));
  const asyncStorage = {
    getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: async (key, value) => void storage.set(key, value),
    removeItem: async (key) => void storage.delete(key),
  };
  const cache = new Map();
  const overrides = new Map(Object.entries(fakes));
  overrides.set("@react-native-async-storage/async-storage", { __esModule: true, default: asyncStorage });

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const source = fs.readFileSync(file, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    const module = { exports: {} };
    cache.set(file, module);
    const dir = path.dirname(file);
    const localRequire = (spec) => {
      if (overrides.has(spec)) return overrides.get(spec);
      if (spec.startsWith("@/")) {
        const found = resolveFile(path.join(repo, "src", spec.slice(2)));
        if (!found) throw new Error(`cannot resolve ${spec}`);
        return load(found);
      }
      if (spec.startsWith(".")) {
        const found = resolveFile(path.resolve(dir, spec));
        if (!found) throw new Error(`cannot resolve ${spec} from ${file}`);
        return load(found);
      }
      return nodeRequire(spec);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", outputText)(
      module.exports,
      localRequire,
      module,
      file,
      dir,
    );
    return module.exports;
  }

  return {
    storage,
    use: (spec) => {
      if (overrides.has(spec)) return overrides.get(spec);
      const found = resolveFile(path.join(repo, "src", spec.replace(/^@\//, "")));
      if (!found) throw new Error(`cannot resolve ${spec}`);
      return load(found);
    },
  };
}

module.exports = { makeEnv };
