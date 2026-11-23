// The 2026-11-20 checks: the Today tab's word card shared as a picture. Share on "Your word for today" sends the card itself (the
// painted scene with the person on it, the headline, the verse and its reference), where it sent the verse as text.
// They run the app's real layout numbers (utils/wordCardLayout.ts), the real renderer (services/wordCardImage.ts) on React Native
// Skia's own web implementation over CanvasKit, with the app's real fonts, scenes and mark read from disk, the real file service
// (services/wordCardShare.ts) on a fake of expo-file-system 58, and the real hook (hooks/useWordShare.ts) with the real share link,
// and they read the shipped card, screen and sign-out for the wiring.
//
//   node --no-warnings supabase/tests/share-card/run.cjs          (from the repo root; a few seconds)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/share-card/run.cjs
//       (the copy needs node_modules and assets, for example as junctions)
//
// What it cannot show is the phone: Skia's native drawing, the file on the phone, the share menu and what an app receives. Those
// are the phone checks of the log entry. Exit code 0 only when every check passes.
//   ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either);
//   FAILFAST=1 stops at the first failure; TIMINGS=1 prints how long each check took.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeEnv, makeReact, flush } = require("../recording/world.cjs");

const REPO = process.env.GRACEHUSH_REPO;
const NL = String.fromCharCode(10);
const nm = (relative) => path.join(REPO, "node_modules", relative);
const asset = (relative) => path.join(REPO, "assets", relative);
const read = (relative) => fs.readFileSync(path.join(REPO, relative), "utf8").replace(/\r\n/g, NL);

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
const realNow = Date.now;
const CHECK_LIMIT_MS = 20_000;
process.on("exit", () => {
  if (finished) return;
  fs.writeSync(1, `${passed} passed, stopped while running: ${running}${NL}`);
  process.exitCode = 1;
});

// What must never reach the development log: a word of the card, the verse's reference, the file's name or its address.
const FORBIDDEN_IN_LOGS = ["Safety surrounds", "lie down", "Psalm", "Lamentations", "GraceHush-", "file:///"];

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
    failures.push(`${name}${NL}    ${String(error && error.stack ? error.stack : error).split(NL).slice(0, 7).join(`${NL}    `)}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    Date.now = realNow;
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${NL}`);
  }
}

function near(actual, expected, tolerance, label) {
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, expected ${expected} (within ${tolerance})`,
  );
}
function nearList(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label}: ${JSON.stringify(Array.from(actual))}`);
  expected.forEach((value, i) => near(actual[i], value, tolerance, `${label}[${i}]`));
}

// ------------------------------------------------------------------ the example every check shares
// The card of the owner's screenshot: the bedside scene at night, on a 390-wide phone (the card is 350 wide) at the default text size.
const PICTURE = {
  headline: "Safety surrounds your night",
  detail: "“I will lie down and sleep in peace, for You alone, O LORD, make me dwell in safety.”",
  reference: "Psalm 4:8 · BSB",
  scene: 0,
  width: 350,
  fontScale: 1,
};
// The longest a card gets: a long headline, a verse of two sentences, a long reference, at the largest standard text size.
const LONG = {
  headline: "His mercies meet you again this morning",
  detail:
    "“Because of the loving devotion of the LORD we are not consumed, for His mercies never fail. They are new every morning; great is Your faithfulness!”",
  reference: "Lamentations 3:22–23 · BSB",
  scene: 2,
  width: 350,
  fontScale: 1.35,
};
const SCENE_FILES = Array.from({ length: 20 }, (_, i) => asset(`images/player-scene-${i + 1}.jpg`));
const MARK_FILE = asset("images/logo-mark-light.png");
// Apple's "Download on the App Store" badge (2026-11-23), drawn from Apple's own SVG at 359 by 120 pixels.
const BADGE_FILE = asset("images/app-store-badge.png");
// The four font files App.tsx loads, by the module the app imports them from and the family name the theme gives each.
const FONT_FILES = [
  ["@expo-google-fonts/fraunces/500Medium", "Fraunces_500Medium"],
  ["@expo-google-fonts/fraunces/400Regular_Italic", "Fraunces_400Regular_Italic"],
  ["@expo-google-fonts/fraunces/600SemiBold", "Fraunces_600SemiBold"],
  ["@expo-google-fonts/dm-sans/600SemiBold", "DMSans_600SemiBold"],
].map(([specifier, name]) => ({ specifier, name, file: nm(`${specifier}/${name}.ttf`) }));
const fontFile = (name) => FONT_FILES.find((font) => font.name === name).file;
const PLUM_DEEP = [62, 39, 65]; // #3E2741
const ROSE = [212, 165, 165]; // #D4A5A5

// ------------------------------------------------------------------ Skia on this PC
// React Native Skia's web implementation over CanvasKit (the package Skia itself brings): the same Skia, built for the web.
let canvasKit = null;
function loadCanvasKit() {
  canvasKit ??= (async () => {
    const init = require(nm("canvaskit-wasm/bin/full/canvaskit.js"));
    const CanvasKit = await init({ locateFile: (file) => nm(`canvaskit-wasm/bin/full/${file}`) });
    globalThis.CanvasKit = CanvasKit;
    const { JsiSkApi } = require(nm("@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js"));
    const types = require(nm("@shopify/react-native-skia/lib/commonjs/skia/types/index.js"));
    return { CanvasKit, api: JsiSkApi(CanvasKit), types };
  })();
  return canvasKit;
}

// The app's real renderer, on the real Skia, with every file read from disk. What the renderer asks Skia for is written down
// on the way through (`state`), so a check can say where each thing was drawn as well as look at the pixels.
async function renderWorld() {
  const { CanvasKit, api, types } = await loadCanvasKit();
  const state = {
    unreadable: new Set(), // files that have no copy on the phone: Asset.localUri stays null
    offline: new Set(), // files whose download fails
    swapped: new Map(), // a file whose bytes are another file's
    noSurface: false, // Skia cannot make a surface to draw on (it answers null)
    emptyEncode: false, // the finished picture comes out as nothing
    downloads: [],
    reads: [],
    fonts: [],
    paragraphs: [],
    gradients: [],
    surfaces: [],
    encodes: [],
    ops: [],
  };
  const dataFile = new WeakMap();
  const typefaceFile = new WeakMap();
  const imageFile = new WeakMap();
  const box = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });

  const Skia = {
    ...api,
    Data: {
      // The phone reads a file address; here the "address" is a path on this PC.
      fromURI: async (uri) => {
        state.reads.push(uri);
        const data = api.Data.fromBytes(new Uint8Array(fs.readFileSync(state.swapped.get(uri) ?? uri)));
        dataFile.set(data, uri);
        return data;
      },
    },
    Typeface: {
      MakeFreeTypeFaceFromData: (data) => {
        const typeface = api.Typeface.MakeFreeTypeFaceFromData(data);
        if (typeface !== null) typefaceFile.set(typeface, dataFile.get(data));
        return typeface;
      },
    },
    TypefaceFontProvider: {
      Make: () => {
        const provider = api.TypefaceFontProvider.Make();
        const register = provider.registerFont.bind(provider);
        provider.registerFont = (typeface, family) => {
          state.fonts.push({ family, file: typefaceFile.get(typeface) });
          register(typeface, family);
        };
        return provider;
      },
    },
    Image: {
      MakeImageFromEncoded: (data) => {
        const image = api.Image.MakeImageFromEncoded(data);
        if (image !== null) imageFile.set(image, dataFile.get(data));
        return image;
      },
    },
    Shader: {
      MakeLinearGradient: (start, end, colors, positions, mode) => {
        state.gradients.push({
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          colors: colors.map((stop) => Array.from(stop)),
          positions: [...positions],
          mode,
        });
        return api.Shader.MakeLinearGradient(start, end, colors, positions, mode);
      },
    },
    ParagraphBuilder: {
      Make: (style, provider) => {
        const builder = api.ParagraphBuilder.Make(style, provider);
        const record = { style, runs: [], width: null, at: null, height: null, longestLine: null };
        state.paragraphs.push(record);
        const wrapped = {
          pushStyle(textStyle) {
            record.runs.push({ ...textStyle, color: Array.from(textStyle.color), text: "" });
            builder.pushStyle(textStyle);
            return wrapped;
          },
          addText(text) {
            record.runs[record.runs.length - 1].text += text;
            builder.addText(text);
            return wrapped;
          },
          pop() {
            builder.pop();
            return wrapped;
          },
          build() {
            const built = builder.build();
            return {
              layout(width) {
                record.width = width;
                built.layout(width);
                record.height = built.getHeight();
                record.longestLine = built.getLongestLine();
              },
              getHeight: () => built.getHeight(),
              getLongestLine: () => built.getLongestLine(),
              paint(canvas, x, y) {
                record.at = { x, y };
                state.ops.push({ op: "text", paragraph: record });
                built.paint(canvas, x, y);
              },
            };
          },
        };
        return wrapped;
      },
    },
    Surface: {
      Make: (width, height) => {
        if (state.noSurface) return null;
        state.surfaces.push({ width, height });
        const surface = api.Surface.Make(width, height);
        const canvas = surface.getCanvas();
        const recorders = {
          scale: (sx, sy) => {
            state.ops.push({ op: "scale", sx, sy });
            canvas.scale(sx, sy);
          },
          drawColor: (color) => {
            state.ops.push({ op: "color", color: Array.from(color) });
            canvas.drawColor(color);
          },
          drawRect: (rect, paint) => {
            state.ops.push({ op: "rect", rect: box(rect), gradient: state.gradients.length - 1 });
            canvas.drawRect(rect, paint);
          },
          drawImageRectOptions: (image, src, dst, filter, mipmap, paint) => {
            state.ops.push({ op: "image", file: imageFile.get(image), size: { width: image.width(), height: image.height() }, src: box(src), dst: box(dst), filter, mipmap });
            canvas.drawImageRectOptions(image, src, dst, filter, mipmap, paint);
          },
        };
        const spy = new Proxy(canvas, {
          get(target, key) {
            if (Object.prototype.hasOwnProperty.call(recorders, key)) return recorders[key];
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return {
          getCanvas: () => spy,
          makeImageSnapshot: () => {
            const snapshot = surface.makeImageSnapshot();
            return {
              encodeToBase64: (format, quality) => {
                state.encodes.push({ format, quality });
                return state.emptyEncode ? "" : snapshot.encodeToBase64(format, quality);
              },
            };
          },
        };
      },
    },
  };

  const fakes = {
    "@shopify/react-native-skia": {
      __esModule: true,
      Skia,
      FilterMode: types.FilterMode,
      ImageFormat: types.ImageFormat,
      MipmapMode: types.MipmapMode,
      TileMode: types.TileMode,
    },
    // expo-asset 58 as the renderer uses it: a bundled file has no local address until it has been downloaded (in development
    // Metro serves it; in a build the download finds it in the app). A "module" here is the file's path.
    "expo-asset": {
      __esModule: true,
      Asset: {
        fromModule: (module) => {
          const file = { localUri: null };
          file.downloadAsync = async () => {
            state.downloads.push(module);
            if (state.offline.has(module)) throw new Error("the file could not be downloaded");
            file.localUri = state.unreadable.has(module) ? null : module;
          };
          return file;
        },
      },
    },
    "react-native": { StyleSheet: { create: (styles) => styles } },
    "@/constants/images": { __esModule: true, images: { logoMarkLight: MARK_FILE, appStoreBadge: BADGE_FILE }, playerScenes: SCENE_FILES },
  };
  for (const font of FONT_FILES) fakes[font.specifier] = { __esModule: true, [font.name]: font.file };
  const env = makeEnv({ fakes });
  return {
    state,
    types,
    render: env.use("@/services/wordCardImage").renderWordPicture,
    layout: env.use("@/utils/wordCardLayout"),
    theme: env.use("@/constants/theme"),
    // The JPEG, decoded: its size (from the file's own header and from the pixels) and its pixels.
    open(base64) {
      const bytes = Buffer.from(base64, "base64");
      let header = null;
      for (let i = 2; i < bytes.length - 9; i += 1) {
        if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2)) {
          header = { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
          break;
        }
      }
      const image = CanvasKit.MakeImageFromEncoded(new Uint8Array(bytes));
      assert.ok(image !== null, "the picture can be opened again");
      const width = image.width();
      const height = image.height();
      const pixels = image.readPixels(0, 0, {
        width,
        height,
        colorType: CanvasKit.ColorType.RGBA_8888,
        alphaType: CanvasKit.AlphaType.Unpremul,
        colorSpace: CanvasKit.ColorSpace.SRGB,
      });
      image.delete();
      return { bytes, header, width, height, pixels };
    },
  };
}

// How many pixels of a part of the picture are of a kind, and that part's mean colour. Coordinates are pixels.
function count(shot, [x0, y0, x1, y1], kind) {
  let found = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(shot.height, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(shot.width, Math.ceil(x1)); x += 1) {
      const i = (y * shot.width + x) * 4;
      if (kind(shot.pixels[i], shot.pixels[i + 1], shot.pixels[i + 2])) found += 1;
    }
  }
  return found;
}
function mean(shot, area) {
  const sum = [0, 0, 0];
  const pixelCount = count(shot, area, (r, g, b) => {
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    return true;
  });
  return sum.map((value) => value / pixelCount);
}
const isWhite = (r, g, b) => r > 235 && g > 235 && b > 235; // the headline, and "Grace"
const isLight = (r, g, b) => r > 170 && g > 170 && b > 170; // any text: under the fade the scene itself is never this light
const isRose = (r, g, b) => Math.abs(r - ROSE[0]) < 16 && Math.abs(g - ROSE[1]) < 16 && Math.abs(b - ROSE[2]) < 16; // "Hush"

// The four pieces of text the renderer builds, by what they are.
function pieces(state) {
  const by = (family, lines) => state.paragraphs.find((p) => p.runs[0].fontFamilies[0] === family && (lines === undefined || p.style.maxLines === lines));
  return {
    headline: by("Fraunces_500Medium"),
    detail: by("Fraunces_400Regular_Italic"),
    reference: by("DMSans_600SemiBold"),
    name: by("Fraunces_600SemiBold", 1),
  };
}

// ------------------------------------------------------------------ the numbers (pure)
async function layoutChecks() {
  const layout = () => makeEnv().use("@/utils/wordCardLayout");

  await test("layout: the card's measures and the picture's are the ones this feature was built with", async () => {
    const { WORD_CARD, WORD_PICTURE } = layout();
    assert.deepEqual(WORD_CARD, {
      minHeight: 280,
      sceneRoom: 112,
      sidePadding: 20,
      detailGap: 8,
      footHeight: 44,
      footPadding: 8,
      headline: { size: 24, line: 30 },
      detail: { size: 15, line: 22 },
      reference: { size: 13, line: 18 },
    });
    assert.equal(WORD_PICTURE.scale, 3, "three pixels to a point");
    assert.equal(WORD_PICTURE.quality, 92, "the JPEG's quality");
    assert.deepEqual([WORD_PICTURE.minWidth, WORD_PICTURE.maxWidth, WORD_PICTURE.defaultWidth], [280, 440, 350]);
    assert.deepEqual([WORD_PICTURE.minFontScale, WORD_PICTURE.maxFontScale], [0.82, 1.36]);
    assert.deepEqual(WORD_PICTURE.brand, { mark: 26, gap: 4, size: 14, line: 18, tracking: -0.35, clearance: 12 });
    assert.deepEqual(WORD_PICTURE.storeBadge, { height: 14, top: 12 }, "the App Store badge: 14 tall, 12 from the top");
  });

  await test("layout: the picture is as wide as the card and follows the phone's text size, each within what an iPhone shows", async () => {
    const { wordPictureSize } = layout();
    assert.deepEqual(wordPictureSize({ width: 350, fontScale: 1 }), { width: 350, fontScale: 1, textWidth: 310 });
    assert.deepEqual(wordPictureSize({ width: 373.6, fontScale: 0.88 }), { width: 374, fontScale: 0.88, textWidth: 334 });
    assert.equal(wordPictureSize({ width: 100, fontScale: 1 }).width, 280, "never narrower than the narrowest card");
    assert.equal(wordPictureSize({ width: 1000, fontScale: 1 }).width, 440, "never wider than the widest");
    assert.equal(wordPictureSize({ width: 350, fontScale: 0.4 }).fontScale, 0.82, "never smaller than iOS's smallest text");
    assert.equal(wordPictureSize({ width: 350, fontScale: 3.1 }).fontScale, 1.36, "an accessibility size is drawn at the largest standard one");
    for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      assert.deepEqual(wordPictureSize({ width: nonsense, fontScale: nonsense }), { width: 350, fontScale: 1, textWidth: 310 });
    }
  });

  await test("layout: a card is at least 280 tall and as tall as its text needs, with the text at its foot", async () => {
    const { wordPictureFrame } = layout();
    // A short verse: the least height, everything pushed to the bottom.
    assert.deepEqual(wordPictureFrame(350, { headline: 30, detail: 44, reference: 18 }), {
      width: 350,
      height: 280,
      pixelWidth: 1050,
      pixelHeight: 840,
      textLeft: 20,
      textWidth: 310,
      headlineTop: 146,
      detailTop: 184,
      footTop: 228,
      footHeight: 44,
    });
    // A long one: the scene keeps its 112 at the top and the card grows (112 + 90 + 8 + 110 + 44 + 8).
    const long = wordPictureFrame(350, { headline: 90, detail: 110, reference: 18 });
    assert.deepEqual([long.height, long.pixelHeight, long.headlineTop, long.detailTop, long.footTop], [372, 1116, 112, 210, 320]);
    // A reference that wraps makes the foot row as tall as itself.
    const wrapped = wordPictureFrame(350, { headline: 90, detail: 110, reference: 48 });
    assert.deepEqual([wrapped.height, wrapped.footHeight, wrapped.footTop, wrapped.headlineTop], [376, 48, 320, 112]);
    // Part of a pixel is never cut off: the picture is rounded up to whole pixels and the text keeps its place from the foot.
    // (112 + 90.1 + 8 + 110.3 + 44 + 8 is 372.4 points, 1117.2 pixels: 1118, never 1117.)
    const odd = wordPictureFrame(350.2, { headline: 90.1, detail: 110.3, reference: 18 });
    assert.deepEqual([odd.pixelWidth, odd.pixelHeight], [1051, 1118]);
    near(odd.width, 1051 / 3, 1e-9, "the width in points");
    near(odd.height, 1118 / 3, 1e-9, "the height in points");
    near(odd.footTop + odd.footHeight + 8, odd.height, 1e-9, "the foot row ends 8 above the bottom");
    near(odd.detailTop + 110.3, odd.footTop, 1e-9, "the verse ends where the foot row begins");
    near(odd.headlineTop + 90.1 + 8, odd.detailTop, 1e-9, "the headline ends 8 above the verse");
    assert.ok(odd.headlineTop >= 112, "and the scene never has less than its room");
  });

  await test("layout: the scene covers the picture from its top edge and is never stretched, as the card's is", async () => {
    const { coverFromTop } = layout();
    const scene = { width: 1290, height: 968 };
    // A card narrower than the scene's shape: the whole height, the sides cut evenly.
    const narrow = coverFromTop(scene, { width: 350, height: 280 });
    near(narrow.height, 968, 1e-9, "the whole height");
    near(narrow.width, 1210, 1e-9, "the width that keeps the card's shape");
    near(narrow.x, 40, 1e-9, "centred sideways");
    assert.equal(narrow.y, 0, "from the top");
    // A card wider than the scene's shape: the whole width, the overflow cut from the bottom only.
    const wide = coverFromTop(scene, { width: 420, height: 280 });
    near(wide.width, 1290, 1e-9, "the whole width");
    near(wide.height, 860, 1e-9, "the height that keeps the card's shape");
    assert.deepEqual([wide.x, wide.y], [0, 0], "anchored at the top edge, where the face is");
    for (const cut of [narrow, wide]) near(cut.width / cut.height, cut === narrow ? 350 / 280 : 420 / 280, 1e-9, "never stretched");
  });

  await test("layout: the fade's inner stops keep their place in points on a taller card, and the theme's own on a card of least height", async () => {
    const { wordFadeLocations } = layout();
    const theme = [0, 0.26, 0.4, 0.54, 1];
    const frozen = Object.freeze([...theme]);
    assert.deepEqual(wordFadeLocations(280, frozen), theme, "a card of least height: the theme's stops");
    for (const small of [200, 279.9, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(wordFadeLocations(small, frozen), theme, `${small}: the theme's stops`);
    }
    for (const tall of [281, 360, 420, 560, 1000]) {
      const stops = wordFadeLocations(tall, frozen);
      assert.equal(stops.length, 5);
      assert.deepEqual([stops[0], stops[4]], [0, 1], `${tall}: the two ends stay at the card's top and foot`);
      nearList(stops.slice(1, 4).map((stop) => stop * tall), [72.8, 112, 151.2], 1e-9, `${tall}: the inner stops at their points`);
      for (let i = 1; i < stops.length; i += 1) assert.ok(stops[i] > stops[i - 1], `${tall}: the stops still rise`);
    }
    nearList(wordFadeLocations(560, frozen), [0, 0.13, 0.2, 0.27, 1], 1e-12, "twice the least height: half the fractions");
    assert.deepEqual(frozen, theme, "the theme's own list is never changed");
  });

  await test("layout: a colour of the theme becomes the four numbers Skia takes, and the file is named after the verse", async () => {
    const { hexToRgba, wordPictureFileName } = layout();
    nearList(hexToRgba("#3E2741"), [62 / 255, 39 / 255, 65 / 255, 1], 1e-12, "plum-deep");
    nearList(hexToRgba("#3e2741b8"), [62 / 255, 39 / 255, 65 / 255, 184 / 255], 1e-12, "a colour with its own alpha, in small letters");
    nearList(hexToRgba("#FFFFFF", 0.9), [1, 1, 1, 0.9], 1e-12, "white at 90%");
    nearList(hexToRgba("#3E2741B8", 0.5), [62 / 255, 39 / 255, 65 / 255, 92 / 255], 1e-12, "the two alphas multiply");
    for (const nonsense of ["plum", "#FFF", "", "#3E27411"]) assert.deepEqual(hexToRgba(nonsense), [0, 0, 0, 1], nonsense);

    assert.equal(wordPictureFileName("Psalm 4:8 · BSB"), "GraceHush-Psalm-4-8-BSB.jpg");
    assert.equal(wordPictureFileName("Lamentations 3:22–23 · BSB"), "GraceHush-Lamentations-3-22-23-BSB.jpg");
    assert.equal(wordPictureFileName("1 Peter 5:7 · BSB"), "GraceHush-1-Peter-5-7-BSB.jpg");
    assert.equal(wordPictureFileName(""), "GraceHush-verse.jpg");
    assert.equal(wordPictureFileName(" · "), "GraceHush-verse.jpg");
    // Whatever the reference holds, the name is one plain file name: nothing that could climb out of its folder.
    // (The last one is cut at 60 characters right after a separator, which must not be left hanging at the end.)
    for (const odd of ["../../etc/passwd", "a/b\\c:d", "x".repeat(300), "Psalm 4:8\n\u0000", "…", "ab ".repeat(40)]) {
      const name = wordPictureFileName(odd);
      assert.match(name, /^GraceHush-[A-Za-z0-9]+(-[A-Za-z0-9]+)*\.jpg$/, name);
      assert.ok(name.length <= "GraceHush-".length + 60 + ".jpg".length, `${name.length} characters`);
    }
  });
}

// ------------------------------------------------------------------ the picture (the real renderer on CanvasKit)
async function pictureChecks() {
  await test("picture: Share's picture is a JPEG of the card, three pixels to a point, with the scene under the card's own fade", async () => {
    const world = await renderWorld();
    const base64 = await world.render(PICTURE);
    assert.equal(typeof base64, "string");
    const shot = world.open(base64);
    assert.deepEqual([shot.bytes[0], shot.bytes[1], shot.bytes[2]], [0xff, 0xd8, 0xff], "a JPEG");
    assert.deepEqual(shot.header, { width: 1050, height: 840 }, "a 350 by 280 card at three pixels to a point");
    assert.deepEqual([shot.width, shot.height], [1050, 840]);
    assert.deepEqual(world.state.surfaces, [{ width: 1050, height: 840 }], "drawn once, off the screen");
    assert.deepEqual(world.state.encodes, [{ format: world.types.ImageFormat.JPEG, quality: 92 }], "saved once, as a JPEG at quality 92");

    const { ops, gradients } = world.state;
    assert.deepEqual(
      ops.map((step) => step.op),
      ["scale", "color", "image", "rect", "text", "text", "text", "image", "text", "image"],
      "plum-deep, the scene, the fade, then the headline, the verse, the reference, the lockup and the App Store badge",
    );
    assert.deepEqual([ops[0].sx, ops[0].sy], [3, 3]);
    nearList(ops[1].color, [62 / 255, 39 / 255, 65 / 255, 1], 1e-6, "plum-deep behind everything, as the card's background");

    // The scene: the card's own file, covering the card from its top edge, never stretched.
    const scene = ops[2];
    assert.equal(scene.file, SCENE_FILES[0], "the scene the card shows");
    assert.deepEqual(scene.dst, { x: 0, y: 0, width: 350, height: 280 }, "over the whole card");
    const cut = world.layout.coverFromTop(scene.size, { width: 350, height: 280 });
    nearList([scene.src.x, scene.src.y, scene.src.width, scene.src.height], [cut.x, cut.y, cut.width, cut.height], 0.01, "the part of the scene");
    assert.equal(scene.src.y, 0, "from the scene's top edge, where the face is");
    near(scene.src.width / scene.src.height, 350 / 280, 1e-4, "in the card's own shape");
    assert.equal(scene.filter, world.types.FilterMode.Linear);

    // The fade: the theme's own stops, from the top of the card to its foot.
    assert.deepEqual(ops[3].rect, { x: 0, y: 0, width: 350, height: 280 });
    assert.equal(gradients.length, 1);
    const fade = gradients[ops[3].gradient];
    assert.deepEqual([fade.start, fade.end], [{ x: 0, y: 0 }, { x: 0, y: 280 }], "top to bottom");
    assert.deepEqual(fade.positions, [...world.theme.gradients.wordFade.locations]);
    assert.deepEqual(fade.positions, [0, 0.26, 0.4, 0.54, 1]);
    assert.equal(fade.colors.length, 5);
    [0, 0, 184 / 255, 235 / 255, 245 / 255].forEach((alpha, i) => {
      nearList(fade.colors[i], [62 / 255, 39 / 255, 65 / 255, alpha], 1e-6, `fade stop ${i}`);
    });
    assert.equal(fade.mode, world.types.TileMode.Clamp);
  });

  await test("picture: the words are set in the card's fonts, sizes, colours and width", async () => {
    const world = await renderWorld();
    await world.render(PICTURE);
    // The app's own four files, each under the family name the app's own text uses for it.
    assert.deepEqual(
      world.state.fonts,
      [
        { family: "Fraunces_500Medium", file: fontFile("Fraunces_500Medium") },
        { family: "Fraunces_400Regular_Italic", file: fontFile("Fraunces_400Regular_Italic") },
        { family: "Fraunces_600SemiBold", file: fontFile("Fraunces_600SemiBold") },
        { family: "DMSans_600SemiBold", file: fontFile("DMSans_600SemiBold") },
      ],
    );
    assert.equal(world.state.paragraphs.length, 4, "the headline, the verse, the name and the reference");
    const { headline, detail, reference, name } = pieces(world.state);

    assert.deepEqual(headline.runs.map((run) => run.text), [PICTURE.headline]);
    assert.deepEqual([headline.runs[0].fontSize, headline.runs[0].heightMultiplier, headline.runs[0].halfLeading], [24, 30 / 24, true]);
    nearList(headline.runs[0].color, [1, 1, 1, 1], 1e-6, "the headline is white");
    assert.equal(headline.width, 310, "wrapped at the card's width less its 20 of padding each side");
    assert.equal(headline.height, 60, "two lines of 30: this headline is wider than a 310 column, as on the card");
    assert.ok(headline.longestLine <= 310, "and no line is wider than the column");

    assert.deepEqual(detail.runs.map((run) => run.text), [PICTURE.detail]);
    assert.deepEqual([detail.runs[0].fontSize, detail.runs[0].heightMultiplier, detail.runs[0].halfLeading], [15, 22 / 15, true]);
    nearList(detail.runs[0].color, [1, 1, 1, 0.9], 1e-6, "the verse is white at 90%");
    assert.equal(detail.width, 310);
    assert.equal(detail.height % 22, 0, `whole lines of 22: ${detail.height}`);

    assert.deepEqual(reference.runs.map((run) => run.text), [PICTURE.reference]);
    assert.deepEqual([reference.runs[0].fontSize, reference.runs[0].heightMultiplier, reference.runs[0].halfLeading], [13, 18 / 13, true]);
    nearList(reference.runs[0].color, [1, 1, 1, 0.85], 1e-6, "the reference is white at 85%");
    assert.equal(reference.height, 18, "one line of 18");

    // "GraceHush" in the header wordmark's face and two tones, on one line.
    assert.equal(name.style.maxLines, 1);
    assert.deepEqual(name.runs.map((run) => run.text), ["Grace", "Hush"]);
    for (const run of name.runs) {
      assert.deepEqual([run.fontFamilies, run.fontSize, run.heightMultiplier, run.letterSpacing], [["Fraunces_600SemiBold"], 14, 18 / 14, -0.35]);
    }
    nearList(name.runs[0].color, [1, 1, 1, 1], 1e-6, "Grace in white");
    nearList(name.runs[1].color, [212 / 255, 165 / 255, 165 / 255, 1], 1e-6, "Hush in rose");
    // The reference keeps 12 clear of the lockup (the mark's 26, a gap of 4 and the name).
    assert.equal(reference.width, 310 - (26 + 4 + Math.ceil(name.longestLine)) - 12);
  });

  await test("picture: the words sit where the card puts them, and the GraceHush lockup stands where the card has its two buttons", async () => {
    const world = await renderWorld();
    const shot = world.open(await world.render(PICTURE));
    const { headline, detail, reference, name } = pieces(world.state);
    const mark = world.state.ops.filter((step) => step.op === "image")[1];

    // The card's layout, from the foot: 8 of air, the 44 foot row, the verse, 8, the headline.
    const footTop = 280 - 8 - 44;
    assert.deepEqual([headline.at.x, detail.at.x, reference.at.x], [20, 20, 20], "the card's 20 of side padding");
    near(detail.at.y + detail.height, footTop, 1e-6, "the verse ends where the foot row begins");
    near(headline.at.y + headline.height + 8, detail.at.y, 1e-6, "the headline ends 8 above the verse");
    assert.ok(headline.at.y >= 112, "under the room the scene keeps");
    near(reference.at.y + reference.height / 2, footTop + 22, 1e-6, "the reference in the middle of the foot row");

    // The lockup: the light mark in a 26 box, 4, then the name, ending at the text's right edge, on the foot row's middle.
    assert.equal(mark.file, MARK_FILE, "the light mark, as on the launch screen");
    assert.deepEqual([mark.dst.width, mark.dst.height], [26, 26]);
    assert.deepEqual([mark.src.x, mark.src.y, mark.src.width, mark.src.height], [0, 0, mark.size.width, mark.size.height], "the whole mark");
    assert.equal(mark.mipmap, world.types.MipmapMode.Linear, "drawn small, so sampled through its smaller copies");
    near(mark.dst.y + 13, footTop + 22, 1e-6, "the mark in the middle of the foot row");
    near(name.at.y + name.height / 2, footTop + 22, 1e-6, "the name too");
    near(mark.dst.x + 26 + 4, name.at.x, 1e-6, "the name 4 after the mark");
    near(name.at.x + Math.ceil(name.longestLine), 350 - 20, 1e-6, "ending at the text's right edge");
    assert.ok(reference.at.x + reference.longestLine + 12 <= mark.dst.x + 1e-6, "the reference stays clear of it");

    // And in the pixels: the name's white and rose are at the right of the foot row, the reference at its left.
    const footRow = [footTop * 3, (footTop + 44) * 3];
    const right = [mark.dst.x * 3, footRow[0], 330 * 3, footRow[1]];
    const left = [60, footRow[0], 1050 / 2, footRow[1]];
    assert.ok(count(shot, right, isWhite) > 1200, `the mark and "Grace" in white: ${count(shot, right, isWhite)}`);
    assert.ok(count(shot, right, isRose) > 800, `"Hush" and the mark's flame in rose: ${count(shot, right, isRose)}`);
    assert.ok(count(shot, left, isLight) > 300, `the reference at the left: ${count(shot, left, isLight)}`);
    assert.equal(count(shot, left, isRose), 0, "no rose at the left");
    assert.equal(count(shot, [0, (footTop + 44) * 3, 1050, 840], isLight), 0, "and 8 of plain plum-deep under the foot row");
  });

  await test("picture: Apple's App Store badge stands at the top left, whole, in its own shape, at least 40 pixels tall and clear of the words", async () => {
    const world = await renderWorld();
    const shot = world.open(await world.render({ ...PICTURE, scene: 1 }));
    const drawn = world.state.ops.filter((step) => step.op === "image");
    assert.equal(drawn.length, 3, "the scene, the mark and the badge");
    const badge = drawn[2];
    assert.equal(badge.file, BADGE_FILE, "Apple's own badge");
    assert.deepEqual(badge.size, { width: 359, height: 120 }, "drawn from Apple's SVG at 359 by 120");
    assert.deepEqual([badge.src.x, badge.src.y, badge.src.width, badge.src.height], [0, 0, 359, 120], "the whole badge, never cut");
    assert.deepEqual([badge.dst.x, badge.dst.y, badge.dst.height], [20, 12, 14], "the text's 20 of padding, 12 from the top, 14 tall");
    near(badge.dst.width, (14 * 359) / 120, 1e-3, "in its own proportions, never stretched");
    assert.ok(badge.dst.height * 3 >= 40, "at least 40 pixels tall, as Apple asks on a screen");
    assert.equal(badge.filter, world.types.FilterMode.Linear);
    assert.equal(badge.mipmap, world.types.MipmapMode.Linear, "drawn small, so sampled through its smaller copies");
    // Apple's clear space, a quarter of its height, on every side: inside the picture, and far above the words.
    const clear = 14 / 4;
    const { headline } = pieces(world.state);
    assert.ok(badge.dst.x >= clear && badge.dst.y >= clear, "clear of the picture's left and top edges");
    assert.ok(badge.dst.x + badge.dst.width + clear <= 350, "and of its right edge");
    assert.ok(badge.dst.y + badge.dst.height + clear <= headline.at.y, "clear of the headline");
    // In the pixels, on the light dawn scene: the badge's black body and light words where it stands, the scene beside it.
    const isBlack = (r, g, b) => r < 40 && g < 40 && b < 40;
    const area = [badge.dst.x * 3, badge.dst.y * 3, (badge.dst.x + badge.dst.width) * 3, (badge.dst.y + badge.dst.height) * 3];
    const pixels = (area[2] - area[0]) * (area[3] - area[1]);
    const black = count(shot, area, isBlack);
    const light = count(shot, area, isLight);
    assert.ok(black > pixels * 0.5, `mostly black: ${black} of ${Math.round(pixels)}`);
    assert.ok(light > pixels * 0.05, `with its light words and apple: ${light} of ${Math.round(pixels)}`);
    const beside = [area[2] + clear * 3, area[1], area[2] + clear * 3 + (area[2] - area[0]), area[3]];
    const sceneBlack = count(shot, beside, isBlack);
    assert.ok(sceneBlack < pixels * 0.1, `the scene beside it, not more badge: ${sceneBlack}`);
  });

  await test("picture: the badge keeps its place and size whatever the card's width, the text size or the verse", async () => {
    const world = await renderWorld();
    const cases = [
      { ...PICTURE, width: 374, fontScale: 0.88 },
      { ...PICTURE, width: 280 },
      { ...PICTURE, width: 440, fontScale: 1.35 },
      LONG,
    ];
    for (const picture of cases) {
      world.state.ops.length = 0;
      assert.notEqual(await world.render(picture), null);
      const badge = world.state.ops.filter((step) => step.op === "image")[2];
      const label = `width ${picture.width}, text size ${picture.fontScale}`;
      assert.deepEqual([badge.dst.x, badge.dst.y, badge.dst.height], [20, 12, 14], label);
      near(badge.dst.width, (14 * 359) / 120, 1e-3, label);
    }
  });

  await test("picture: the pixels show the painted scene at the top and the words on plum-deep below, inside the card's padding", async () => {
    const world = await renderWorld();
    const dawn = world.open(await world.render({ ...PICTURE, scene: 1 }));
    const night = world.open(await world.render(PICTURE));
    const top = [0, 0, 1050, 840 * 0.2];
    const [r, g, b] = mean(dawn, top);
    assert.ok(r > 150 && g > 150 && b > 150, `the dawn scene is light at the top: ${[r, g, b].map(Math.round)}`);
    assert.ok(mean(dawn, top)[0] - mean(night, top)[0] > 60, "and the night scene is not: each picture shows its own scene");
    for (const shot of [dawn, night]) {
      mean(shot, [0, 840 - 12, 1050, 840]).forEach((value, i) => near(value, PLUM_DEEP[i], 6, "the foot of the card is plum-deep"));
      assert.ok(count(shot, [60, 336, 990, 684], isWhite) > 5000, "the headline is drawn in white");
      // Under 40% of the height the fade is 72% or more, so anything light there is text: none of it leaves the 20 of padding.
      assert.equal(count(shot, [0, 840 * 0.45, 48, 840], isLight), 0, "nothing in the left padding");
      assert.equal(count(shot, [1050 - 48, 840 * 0.45, 1050, 840], isLight), 0, "nothing in the right padding");
    }
  });

  await test("picture: it shows the scene it is asked for, and the first one for a number that is no scene", async () => {
    const world = await renderWorld();
    const sceneOf = async (scene) => {
      world.state.ops.length = 0;
      assert.notEqual(await world.render({ ...PICTURE, scene }), null);
      return world.state.ops.find((step) => step.op === "image").file;
    };
    assert.equal(await sceneOf(1), SCENE_FILES[1]);
    assert.equal(await sceneOf(2), SCENE_FILES[2]);
    assert.equal(await sceneOf(3), SCENE_FILES[3]);
    assert.equal(await sceneOf(12), SCENE_FILES[12], "one of the sixteen of 2026-11-20");
    assert.equal(await sceneOf(19), SCENE_FILES[19], "the last of the twenty");
    for (const none of [20, -1, 1.5, Number.NaN]) assert.equal(await sceneOf(none), SCENE_FILES[0], String(none));
  });

  await test("picture: it follows the phone: the card's width, and the phone's text size for the words but not for the lockup", async () => {
    const world = await renderWorld();
    // The owner's iPhone XR: a 374-wide card at a text size of 0.88.
    const shot = world.open(await world.render({ ...PICTURE, width: 374, fontScale: 0.88 }));
    assert.deepEqual([shot.width, shot.height], [1122, 840]);
    const { headline, detail, reference, name } = pieces(world.state);
    near(headline.runs[0].fontSize, 24 * 0.88, 1e-9, "the headline's size");
    near(headline.runs[0].heightMultiplier, 30 / 24, 1e-9, "its line keeps its proportion");
    near(detail.runs[0].fontSize, 15 * 0.88, 1e-9, "the verse's size");
    near(reference.runs[0].fontSize, 13 * 0.88, 1e-9, "the reference's size");
    assert.equal(name.runs[0].fontSize, 14, "the lockup does not follow the text size");
    assert.equal(headline.width, 334);

    // A narrow phone: a 288-wide card, whose verse takes more lines, so the card is taller than its least height.
    world.state.paragraphs.length = 0;
    const narrow = world.open(await world.render({ ...PICTURE, width: 288 }));
    assert.equal(narrow.width, 864);
    assert.equal(pieces(world.state).headline.width, 248);
    // Past the limits the picture stays a card.
    assert.equal(world.open(await world.render({ ...PICTURE, width: 1000 })).width, 1320);
    assert.equal(world.open(await world.render({ ...PICTURE, width: 100 })).width, 840);
    world.state.paragraphs.length = 0;
    await world.render({ ...PICTURE, fontScale: 3 });
    near(pieces(world.state).headline.runs[0].fontSize, 24 * 1.36, 1e-9, "an accessibility size is drawn at the largest standard one");
  });

  await test("picture: a long verse at a large text size makes a taller picture, never a cut one", async () => {
    const world = await renderWorld();
    const shot = world.open(await world.render(LONG));
    const { headline, detail, reference, name } = pieces(world.state);
    const height = shot.height / 3;
    assert.equal(shot.width, 1050);
    assert.ok(shot.height > 840, `taller than the least height: ${shot.height}`);
    assert.ok(headline.height > 30 * 1.35 && detail.height > 3 * 22, "several lines each");
    // The scene keeps its room at the top (the height is rounded up to whole pixels, so by under a third of a point more).
    assert.ok(headline.at.y >= 112 && headline.at.y < 112 + 1 / 3 + 1e-6, `the headline starts under the scene's room: ${headline.at.y}`);
    near(headline.at.y + headline.height + 8, detail.at.y, 1e-6, "the headline, 8, the verse");
    const footHeight = Math.max(44, reference.height);
    near(detail.at.y + detail.height + footHeight + 8, height, 1e-6, "the verse, the foot row and 8 of air reach the bottom exactly");
    near(reference.at.y + reference.height / 2, detail.at.y + detail.height + footHeight / 2, 1e-6, "the reference in the middle of the foot row");
    near(name.at.y + name.height / 2, detail.at.y + detail.height + footHeight / 2, 1e-6, "the lockup too");
    // The scene and the fade cover the whole of the taller card, not only its least height (Skia keeps a rectangle in
    // single precision, so a height that is not a whole number is compared to a thousandth of a point).
    const scene = world.state.ops.find((step) => step.op === "image");
    nearList([scene.dst.x, scene.dst.y, scene.dst.width, scene.dst.height], [0, 0, 350, height], 1e-3, "the scene over the whole card");
    const cut = world.layout.coverFromTop(scene.size, { width: 350, height });
    nearList([scene.src.x, scene.src.y, scene.src.width, scene.src.height], [cut.x, cut.y, cut.width, cut.height], 0.01, "in the taller card's own shape");
    near(scene.src.width / scene.src.height, 350 / height, 1e-4, "never stretched");
    const fade = world.state.ops.find((step) => step.op === "rect");
    nearList([fade.rect.x, fade.rect.y, fade.rect.width, fade.rect.height], [0, 0, 350, height], 1e-3, "the fade over the whole card");
    const stops = world.state.gradients[fade.gradient];
    nearList([stops.start.x, stops.start.y, stops.end.x, stops.end.y], [0, 0, 0, height], 1e-3, "from its top to its foot");
    // Its inner stops keep their points (2026-11-21), so the headline sits on the dense fade, not on the clear scene.
    assert.equal(stops.positions.length, 5);
    assert.deepEqual([stops.positions[0], stops.positions[4]], [0, 1]);
    nearList(stops.positions.slice(1, 4).map((stop) => stop * height), [72.8, 112, 151.2], 1e-3, "the fade's inner stops at their points");
    assert.ok(headline.at.y >= stops.positions[2] * height, "the headline starts at or under the fade's 72% stop");
    const topBand = mean(shot, [0, 0, 1050, 150]);
    assert.ok(topBand[0] + topBand[1] + topBand[2] > PLUM_DEEP[0] + PLUM_DEEP[1] + PLUM_DEEP[2] + 60, `the scene shows at the top: ${topBand.map(Math.round)}`);
    // Every word is inside the picture: nothing light in the padding at either side or under the foot row.
    const below = (112 + 1) * 3;
    assert.ok(count(shot, [60, below, 990, shot.height], isWhite) > 10000, "the words are there");
    assert.equal(count(shot, [0, shot.height * 0.45, 48, shot.height], isLight), 0, "nothing in the left padding");
    assert.equal(count(shot, [1050 - 48, shot.height * 0.45, 1050, shot.height], isLight), 0, "nothing in the right padding");
    assert.equal(count(shot, [0, shot.height - 24, 1050, shot.height], isLight), 0, "nothing in the 8 under the foot row");
  });

  await test("picture: when a font, the mark, the badge or the scene cannot be read there is no picture, and nothing is drawn", async () => {
    const notAnImage = fontFile("DMSans_600SemiBold");
    const notAFont = SCENE_FILES[0];
    const cases = [
      ["a font with no copy on the phone", (state) => state.unreadable.add(fontFile("Fraunces_400Regular_Italic"))],
      ["a font file that is no font", (state) => state.swapped.set(fontFile("Fraunces_500Medium"), notAFont)],
      ["a font that cannot be downloaded", (state) => state.offline.add(fontFile("DMSans_600SemiBold"))],
      ["a mark with no copy on the phone", (state) => state.unreadable.add(MARK_FILE)],
      ["a mark that is no image", (state) => state.swapped.set(MARK_FILE, notAnImage)],
      ["a badge with no copy on the phone", (state) => state.unreadable.add(BADGE_FILE)],
      ["a badge that is no image", (state) => state.swapped.set(BADGE_FILE, notAnImage)],
      ["a badge that cannot be downloaded", (state) => state.offline.add(BADGE_FILE)],
      ["a scene with no copy on the phone", (state) => state.unreadable.add(SCENE_FILES[0])],
      ["a scene that is no image", (state) => state.swapped.set(SCENE_FILES[0], notAnImage)],
    ];
    for (const [label, breakIt] of cases) {
      const world = await renderWorld();
      breakIt(world.state);
      assert.equal(await world.render(PICTURE), null, label);
      assert.deepEqual(world.state.surfaces, [], `${label}: nothing is drawn`);
    }
    // A scene whose download fails is an error the caller turns into "no picture" (the service's own check).
    const world = await renderWorld();
    world.state.offline.add(SCENE_FILES[0]);
    await assert.rejects(world.render(PICTURE));
    assert.deepEqual(world.state.surfaces, []);
  });

  await test("picture: a surface that cannot be made, or a picture that comes out empty, is no picture", async () => {
    const world = await renderWorld();
    world.state.noSurface = true;
    assert.equal(await world.render(PICTURE), null, "nothing to draw on");
    assert.deepEqual(world.state.ops, [], "nothing is drawn");
    world.state.noSurface = false;
    world.state.emptyEncode = true;
    assert.equal(await world.render(PICTURE), null, "an empty picture is none: no empty file is ever shared");
    world.state.emptyEncode = false;
    assert.equal(typeof (await world.render(PICTURE)), "string", "and the next share draws");
  });

  await test("picture: the fonts, the mark and the badge are read once and kept, and a read that failed is tried again at the next share", async () => {
    const world = await renderWorld();
    const { state } = world;
    const kitFiles = [...FONT_FILES.map((font) => font.file), MARK_FILE, BADGE_FILE];
    const readsOf = (files) => state.reads.filter((file) => files.includes(file)).length;

    state.unreadable.add(MARK_FILE);
    assert.equal(await world.render(PICTURE), null, "no mark, no picture");
    assert.equal(readsOf([BADGE_FILE]), 0, "and the badge is not read for a kit that has already failed");
    state.unreadable.clear();
    assert.notEqual(await world.render(PICTURE), null, "the next share reads everything again and draws");
    const afterFirstPicture = readsOf(kitFiles);
    assert.equal(afterFirstPicture, 4 + 6, "the four fonts twice (once for the failed try), the mark and the badge once");

    assert.notEqual(await world.render({ ...PICTURE, scene: 1 }), null);
    assert.notEqual(await world.render(PICTURE), null);
    assert.equal(readsOf(kitFiles), afterFirstPicture, "later pictures read no font, no mark and no badge again");
    assert.equal(readsOf([SCENE_FILES[0]]), 2, "the scene is read for each picture");
    assert.equal(readsOf([SCENE_FILES[1]]), 1);
    assert.equal(state.fonts.length, 8, "and the fonts are registered once for each kit that was made");

    // Two shares at the same moment load the fonts once between them.
    const fresh = await renderWorld();
    const both = await Promise.all([fresh.render(PICTURE), fresh.render({ ...PICTURE, scene: 3 })]);
    assert.ok(both.every((picture) => typeof picture === "string"));
    assert.equal(fresh.state.reads.filter((file) => kitFiles.includes(file)).length, 6);
  });
}

// ------------------------------------------------------------------ the file (the real service on a fake file system)
// expo-file-system 58's File, Directory and Paths, as the service uses them. Stricter than the phone in one way that matters:
// a folder is made only inside one that exists unless `intermediates` is asked for, and a file is written only into a folder.
function makeFiles() {
  const files = new Map(); // address -> Buffer
  const folders = new Set(["file:///cache"]);
  const flags = { failWrite: false, failCreate: false, failDelete: false };
  const strip = (uri) => uri.replace(/\/+$/, "");
  const join = (...parts) => {
    let out = "";
    for (const part of parts) {
      const uri = strip(typeof part === "string" ? part : part.uri);
      out = uri.startsWith("file://") || out === "" ? uri : `${out}/${uri}`;
    }
    return out;
  };
  const parent = (uri) => uri.slice(0, uri.lastIndexOf("/"));
  class Directory {
    constructor(...parts) {
      this.uri = join(...parts);
    }
    get exists() {
      return folders.has(this.uri);
    }
    create(options = {}) {
      if (flags.failCreate) throw new Error("the folder could not be made");
      if (folders.has(this.uri)) {
        if (!options.idempotent) throw new Error("the folder exists");
        return;
      }
      if (!folders.has(parent(this.uri))) {
        if (!options.intermediates) throw new Error("the folder above it does not exist");
        new Directory(parent(this.uri)).create(options);
      }
      folders.add(this.uri);
    }
    delete() {
      if (flags.failDelete) throw new Error("the folder could not be deleted");
      if (!folders.has(this.uri)) throw new Error("no such folder");
      for (const uri of [...files.keys()]) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      for (const uri of [...folders]) if (uri === this.uri || uri.startsWith(`${this.uri}/`)) folders.delete(uri);
    }
  }
  class File {
    constructor(...parts) {
      this.uri = join(...parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    async write(content, options) {
      if (flags.failWrite) throw new Error("the file could not be written");
      if (!folders.has(parent(this.uri))) throw new Error("no such folder");
      files.set(this.uri, Buffer.from(content, options && options.encoding === "base64" ? "base64" : "utf8"));
    }
  }
  return { module: { __esModule: true, File, Directory, Paths: { cache: new Directory("file:///cache/") } }, files, folders, flags };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const WARNING = "[share] the picture could not be made";

// The real service, with the phone (its platform and whether the build has Skia), the file system and the renderer faked.
function serviceWorld({ os = "ios", skia = true, registryThrows = false } = {}) {
  const disk = makeFiles();
  const phone = { os, skia, registryThrows, asked: [] };
  const renderer = { reached: 0, pictures: [], answer: async () => JPEG.toString("base64") };
  // The renderer's module is loaded lazily, by a require the service makes itself: reading its one export is "reaching" it.
  const imageModule = new Proxy(
    {},
    {
      get(_, key) {
        if (key !== "renderWordPicture") return undefined;
        renderer.reached += 1;
        return (picture) => {
          renderer.pictures.push(picture);
          return renderer.answer(picture);
        };
      },
    },
  );
  const env = makeEnv({
    fakes: {
      "expo-file-system": disk.module,
      "react-native": {
        Platform: {
          get OS() {
            return phone.os;
          },
        },
        TurboModuleRegistry: {
          get: (name) => {
            phone.asked.push(name);
            if (phone.registryThrows) throw new Error("no registry");
            return phone.skia ? {} : null;
          },
        },
      },
      "./wordCardImage": imageModule,
    },
  });
  return { disk, phone, renderer, service: env.use("@/services/wordCardShare") };
}

async function serviceChecks() {
  await test("service: a picture is made only on an iPhone whose build has Skia; everywhere else Skia is never loaded", async () => {
    const able = serviceWorld();
    assert.equal(able.service.canShareWordPicture(), true);
    assert.deepEqual(able.phone.asked, ["RNSkiaModule"], "the same question the voice orb asks");

    const elsewhere = [
      ["Android", { os: "android" }],
      ["a build without Skia (Expo Go)", { skia: false }],
      ["a phone that cannot be asked", { registryThrows: true }],
    ];
    for (const [label, options] of elsewhere) {
      const world = serviceWorld(options);
      assert.equal(world.service.canShareWordPicture(), false, label);
      assert.equal(await world.service.makeWordPicture(PICTURE), null, label);
      assert.equal(world.renderer.reached, 0, `${label}: the renderer, and Skia with it, is never loaded`);
      assert.equal(world.disk.files.size, 0);
    }
    assert.deepEqual(output, [], "and that is no failure: nothing is said");
  });

  await test("service: the picture is saved as one file in the cache folder, named after the verse", async () => {
    const world = serviceWorld();
    Date.now = () => 1_795_000_000_000;
    const uri = await world.service.makeWordPicture(PICTURE);
    assert.equal(uri, "file:///cache/share/1795000000000/GraceHush-Psalm-4-8-BSB.jpg");
    assert.deepEqual([...world.disk.files.keys()], [uri]);
    assert.ok(world.disk.files.get(uri).equals(JPEG), "the renderer's picture, byte for byte");
    assert.deepEqual(world.renderer.pictures, [PICTURE], "drawn from exactly what the card shows");
    assert.equal(world.renderer.reached, 1);
    output.length = 0; // (the address above is the test's own)
  });

  await test("service: one picture is kept: the next one replaces it, in a folder of its own", async () => {
    const world = serviceWorld();
    world.disk.folders.add("file:///cache/devotionals");
    world.disk.files.set("file:///cache/devotionals/a.wav", Buffer.from("audio"));
    Date.now = () => 1000;
    const first = await world.service.makeWordPicture(PICTURE);
    Date.now = () => 2000;
    const second = await world.service.makeWordPicture({ ...PICTURE, reference: "Psalm 23:1 · BSB" });
    assert.equal(first, "file:///cache/share/1000/GraceHush-Psalm-4-8-BSB.jpg");
    assert.equal(second, "file:///cache/share/2000/GraceHush-Psalm-23-1-BSB.jpg");
    assert.deepEqual([...world.disk.files.keys()].sort(), ["file:///cache/devotionals/a.wav", second], "the first picture is gone, and nothing else is");
    assert.ok(!world.disk.folders.has("file:///cache/share/1000"), "with its folder");
    // The same verse again a moment later still gets an address of its own, so the share menu never shows the old picture.
    Date.now = () => 3000;
    const third = await world.service.makeWordPicture({ ...PICTURE, reference: "Psalm 23:1 · BSB" });
    assert.notEqual(third, second);
    assert.equal([...world.disk.files.keys()].filter((uri) => uri.startsWith("file:///cache/share/")).length, 1);
  });

  await test("service: a picture that cannot be drawn or saved is no picture: said once in development, and never thrown", async () => {
    const failures = [
      ["the renderer has no picture", (world) => void (world.renderer.answer = async () => null)],
      ["the renderer fails", (world) => void (world.renderer.answer = async () => Promise.reject(new Error("no surface")))],
      ["the renderer throws at once", (world) => void (world.renderer.answer = () => { throw new Error("no Skia"); })],
      ["the file cannot be written", (world) => void (world.disk.flags.failWrite = true)],
      ["the folder cannot be made", (world) => void (world.disk.flags.failCreate = true)],
    ];
    for (const [label, breakIt] of failures) {
      const world = serviceWorld();
      breakIt(world);
      output.length = 0;
      assert.equal(await world.service.makeWordPicture(PICTURE), null, label);
      assert.deepEqual(output, [WARNING], `${label}: one line, with nothing of the card in it`);
      assert.equal([...world.disk.files.keys()].length, 0, `${label}: no file is left`);
    }
    // In a release build the line is not written either.
    const world = serviceWorld();
    world.renderer.answer = async () => null;
    output.length = 0;
    globalThis.__DEV__ = false;
    try {
      assert.equal(await world.service.makeWordPicture(PICTURE), null);
    } finally {
      globalThis.__DEV__ = true;
    }
    assert.deepEqual(output, []);
  });

  await test("service: a picture that fails leaves the one before it alone, and removing the picture never throws", async () => {
    const world = serviceWorld();
    Date.now = () => 1000;
    const kept = await world.service.makeWordPicture(PICTURE);
    world.renderer.answer = async () => null;
    Date.now = () => 2000;
    assert.equal(await world.service.makeWordPicture(PICTURE), null);
    assert.deepEqual([...world.disk.files.keys()], [kept], "nothing was drawn, so nothing was replaced");

    // Sign-out's call: the picture goes, with its folder, and nothing else in the cache folder does.
    world.disk.folders.add("file:///cache/scholar");
    world.disk.files.set("file:///cache/scholar/part.wav", Buffer.from("audio"));
    world.service.deleteWordPictures();
    assert.deepEqual([...world.disk.files.keys()], ["file:///cache/scholar/part.wav"]);
    assert.ok(!world.disk.folders.has("file:///cache/share"));
    // With nothing to remove, and with a cache folder that cannot be changed, it still answers quietly.
    assert.doesNotThrow(() => world.service.deleteWordPictures());
    Date.now = () => 3000;
    world.renderer.answer = async () => JPEG.toString("base64");
    const again = await world.service.makeWordPicture(PICTURE);
    world.disk.flags.failDelete = true;
    assert.doesNotThrow(() => world.service.deleteWordPictures());
    assert.ok(world.disk.files.has(again), "what could not be removed is still there for the next try");
    output.length = 0; // (one development line for the picture that failed; checked above)
  });
}

// ------------------------------------------------------------------ the button (the real hook and the real share link)
function hookWorld({ can = true } = {}) {
  const R = makeReact();
  const state = { can, pictures: [], finish: null, shared: [], shareFails: false, unmounted: false, lateSets: 0 };
  // A state setter called after the screen has gone is what React warns about: count it.
  const react = {
    ...R.react,
    useState(init) {
      const [value, set] = R.react.useState(init);
      return [
        value,
        (next) => {
          if (state.unmounted) state.lateSets += 1;
          set(next);
        },
      ];
    },
  };
  const env = makeEnv({
    fakes: {
      react,
      "react-native": {
        Linking: { openURL: async () => undefined, canOpenURL: async () => false },
        Platform: { OS: "ios" },
        Share: {
          share: async (...args) => {
            state.shared.push(args);
            if (state.shareFails) throw new Error("the share sheet could not open");
            return { action: "sharedAction" };
          },
        },
      },
      "expo-web-browser": { __esModule: true, openBrowserAsync: async () => undefined },
      "@/services/wordCardShare": {
        __esModule: true,
        canShareWordPicture: () => state.can,
        makeWordPicture: (picture) => {
          state.pictures.push(picture);
          return new Promise((resolve) => {
            state.finish = resolve;
          });
        },
        deleteWordPictures: () => undefined,
      },
    },
  });
  const rendered = R.renderHook(env.use("@/hooks/useWordShare").useWordShare);
  return {
    state,
    hook: rendered.result,
    unmount() {
      state.unmounted = true;
      rendered.unmount();
    },
  };
}

async function hookChecks() {
  const URI = "file:///cache/share/1/GraceHush-Psalm-4-8-BSB.jpg";

  await test("hook: the picture goes to the iPhone's share menu by itself, and Share waits while it is made", async () => {
    const world = hookWorld();
    let texts = 0;
    assert.equal(world.hook.current.preparing, false);
    const sharing = world.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    assert.equal(world.hook.current.preparing, true, "the button shows its spinner");
    assert.deepEqual(world.state.pictures, [PICTURE]);
    assert.deepEqual(world.state.shared, [], "nothing is shared before the picture exists");
    world.state.finish(URI);
    await sharing;
    await flush();
    assert.equal(world.hook.current.preparing, false);
    assert.deepEqual(world.state.shared, [[{ url: URI }]], "the file alone: no message beside it, so an app receives one picture");
    assert.equal(texts, 0, "and the text is not shared as well");
    output.length = 0;
  });

  await test("hook: where no picture can be made, and when one fails, Share sends the verse as text as before", async () => {
    const without = hookWorld({ can: false });
    let texts = 0;
    await without.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    assert.equal(texts, 1, "the text at once");
    assert.deepEqual(without.state.pictures, [], "no picture is asked for");
    assert.equal(without.hook.current.preparing, false, "and no spinner is shown");
    assert.deepEqual(without.state.shared, []);

    const failing = hookWorld();
    const sharing = failing.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    failing.state.finish(null);
    await sharing;
    await flush();
    assert.equal(texts, 2, "the text, when the picture could not be made");
    assert.deepEqual(failing.state.shared, []);
    assert.equal(failing.hook.current.preparing, false);
  });

  await test("hook: a second press while a picture is being made does nothing, and the next press after it works", async () => {
    const world = hookWorld();
    let texts = 0;
    const first = world.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    await world.hook.current.share(PICTURE, () => void (texts += 1));
    await world.hook.current.share({ ...PICTURE, scene: 2 }, () => void (texts += 1));
    assert.equal(world.state.pictures.length, 1, "one picture is made");
    world.state.finish(URI);
    await first;
    await flush();
    assert.equal(world.state.shared.length, 1, "and shared once");
    assert.equal(texts, 0);

    const again = world.hook.current.share({ ...PICTURE, scene: 2 }, () => void (texts += 1));
    await flush();
    assert.equal(world.state.pictures.length, 2);
    world.state.finish(URI);
    await again;
    assert.equal(world.state.shared.length, 2);
    output.length = 0;
  });

  await test("hook: leaving the screen while a picture is being made shares nothing, and a share menu that cannot open is no error", async () => {
    const world = hookWorld();
    let texts = 0;
    const sharing = world.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    world.unmount();
    world.state.finish(URI);
    await sharing;
    await flush();
    assert.deepEqual(world.state.shared, [], "no share menu over another screen");
    assert.equal(texts, 0, "and no text share either");
    assert.equal(world.state.lateSets, 0, "and the gone screen's state is not touched");

    const closed = hookWorld();
    closed.state.shareFails = true;
    const failing = closed.hook.current.share(PICTURE, () => void (texts += 1));
    await flush();
    closed.state.finish(URI);
    await failing; // resolves: the link never throws
    await flush();
    assert.equal(closed.state.shared.length, 1);
    assert.equal(texts, 0, "the picture was handed over; the text is not sent after it");
    assert.equal(closed.hook.current.preparing, false);
    output.length = 0;
  });
}

// ------------------------------------------------------------------ the shipped files
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(relative));
    else if (/\.tsx?$/.test(entry.name)) found.push(relative);
  }
  return found;
}

async function sourceChecks() {
  await test("source: the card's text classes say the sizes, the spacing and the colours the picture is drawn with", async () => {
    const { WORD_CARD } = makeEnv().use("@/utils/wordCardLayout");
    const card = read("src/components/today/WordCard.tsx");
    const size = (look) => `text-[${look.size}px] leading-[${look.line}px]`;
    // A class name cannot be built from a number, so the card writes its sizes out: they must be the numbers the picture reads.
    assert.match(card, new RegExp(`"font-fraunces-medium ${size(WORD_CARD.headline).replace(/[[\]]/g, "\\$&")} text-white"`), "the headline: Fraunces Medium, white");
    const verse = /"mt-2 self-stretch font-fraunces-italic (text-\[\d+px\] leading-\[\d+px\]) (text-white\/90)"/.exec(card);
    assert.ok(verse, "the verse: Fraunces italic, white at 90%, 8 under the headline");
    assert.equal(verse[1], size(WORD_CARD.detail));
    assert.equal(WORD_CARD.detailGap, 8, "mt-2 is 8");
    const reference = /"flex-1 font-dm-semibold (text-\[\d+px\] leading-\[\d+px\]) (text-white\/85)"/.exec(card);
    assert.ok(reference, "the reference: DM Sans SemiBold, white at 85%");
    assert.equal(reference[1], size(WORD_CARD.reference));
    assert.match(card, /className="flex-row items-center pb-2 pl-5 pr-2"/, "the foot row: 8 under it, the text 20 from the edge");
    assert.deepEqual([WORD_CARD.footPadding, WORD_CARD.sidePadding], [8, 20]);
    assert.match(card, /action: \{ width: 44, height: 44,/, "the buttons that make the foot row 44 tall");
    assert.equal(WORD_CARD.footHeight, 44);
    assert.match(card, /WORD_CARD\.minHeight/, "the least height");
    assert.match(card, /paddingTop: WORD_CARD\.sceneRoom, paddingHorizontal: WORD_CARD\.sidePadding/, "the scene's room and the side padding");
    // The scene and the fade the picture copies.
    assert.match(card, /contentFit="cover" contentPosition="top"/, "the scene covers the card from its top edge");
    assert.match(card, /colors=\{gradients\.wordFade\.colors\}\s+locations=\{wordFadeLocations\(height, gradients\.wordFade\.locations\)\}/, "under the theme's fade, pinned to points");
    assert.match(card, /onLayout=\{\(event\) => setHeight\(event\.nativeEvent\.layout\.height\)\}/, "the card's own height");
    assert.match(card, /useState<number>\(WORD_CARD\.minHeight\)/, "a card not laid out yet has the theme's own stops");
    assert.match(read("src/services/wordCardImage.ts"), /wordFadeLocations\(frame\.height, gradients\.wordFade\.locations\)/, "the picture pins the same stops to its own height");
    assert.match(card, /backgroundColor: colors\.plumDeep/);
    // The words are the same words: the verse in curly quotes as one flowing paragraph, and the reference with its translation.
    assert.match(card, /quoteVerse\(flowVerse\(verse\.text\)\)/);
    assert.match(card, /copy\.affirmationVerse\.reference\(verse\.reference\)/);
    // Share waits while the picture is made.
    assert.match(card, /accessibilityState=\{\{ busy: sharing, disabled: sharing \}\}\s+disabled=\{sharing\}/, "the Share button waits, and says so");
    assert.match(card, /\{sharing \? \(\s*<ActivityIndicator size="small" color="white" \/>/, "and shows a spinner in the icon's place");
  });

  await test("source: Share sends the picture of the card, with the text as its fallback, and a heavy moment's word keeps its text share", async () => {
    const feed = read("src/screens/journal/JournalFeedScreen.tsx");
    assert.match(feed, /import \{ useWordShare \} from "@\/hooks\/useWordShare";/);
    assert.match(feed, /const wordShare = useWordShare\(\);/);
    // What leaves the app for a heavy moment is the owner's to change: its word is shared as text, as before this change.
    // A picture only for a word whose reflection the screen holds, and never for a heavy moment's.
    assert.match(feed, /const asPicture = [\w.?]+ !== null && !\s*[\w.?]+\.isCrisis;/, "a heavy moment's word is not sent as a picture");
    assert.match(feed, /if \(!asPicture\) \{\s*asText\(\);\s*return;\s*\}/, "it goes the text's way");
    assert.match(feed, /const asText = \(\) =>\s*shareSheet\.share\(copy\.reflection\.share\.message\(quoteVerse\([\w.]+\), [\w.]+\)\);/, "the text share is Reflection's own");
    // The picture is asked for with what the card shows: its words, its scene, its width on this phone and the phone's text size.
    const call = /wordShare\.share\(\s*\{([^}]*)\},\s*asText,?\s*\)/.exec(feed);
    assert.ok(call, "the picture, with the text as its fallback");
    for (const field of [
      /headline: \w+\.headline,/,
      /detail: quoteVerse\(flowVerse\([\w.]+\)\),/,
      /reference: copy\.affirmationVerse\.reference\([\w.]+\),/,
      /\bscene,/,
      /width: width - 2 \* sidePadding,/,
      /\bfontScale,/,
    ]) {
      assert.match(call[1], field, String(field));
    }
    assert.match(feed, /const \{ width, fontScale \} = useWindowDimensions\(\);/);
    assert.match(feed, /paddingHorizontal: sidePadding,/, "the same side padding the list is drawn with");
    assert.match(feed, /sharing=\{[^}]*wordShare\.preparing[^}]*\}/, "the card's Share button waits while the picture is made");
  });

  await test("source: Skia is loaded only where the build has it, sign-out deletes the picture, and sharing makes no haptic, event or log line", async () => {
    const files = sourceFiles("src");
    const importing = (pattern) => files.filter((file) => pattern.test(read(file))).sort();
    // Skia's JavaScript needs its native module the moment it runs: two files import it, and each is loaded only on purpose.
    assert.deepEqual(importing(/from "@shopify\/react-native-skia"/), ["src/components/scholar/VoiceOrbSkia.tsx", "src/services/wordCardImage.ts"]);
    assert.deepEqual(importing(/(from|require\()\s*"(\.\/|@\/services\/)wordCardImage"/), ["src/services/wordCardShare.ts"]);
    const service = read("src/services/wordCardShare.ts");
    assert.ok(!/^import [^;]*wordCardImage/m.test(service), "never a static import");
    assert.match(service, /if \(!canShareWordPicture\(\)\) return null;\s+try \{[\s\S]*require\("\.\/wordCardImage"\)/, "required only once the build is known to have Skia");
    assert.match(service, /Platform\.OS === "ios" && TurboModuleRegistry\.get\("RNSkiaModule"\) !== null/);
    assert.match(service, /new Directory\(Paths\.cache, FOLDER\)/, "the cache folder, which iOS may empty by itself");

    // Sign-out and account deletion delete the picture (signOutCleanup is the one place both run).
    const account = read("src/services/account.ts");
    const cleanup = account.slice(account.indexOf("export async function signOutCleanup"));
    assert.match(account, /import \{ deleteWordPictures \} from "@\/services\/wordCardShare";/);
    assert.match(cleanup.slice(0, cleanup.indexOf(`${NL}}${NL}`)), /\n\s+deleteWordPictures\(\);\n/, "in the sign-out cleanup");

    // The share link hands over the file alone.
    const links = read("src/services/externalLinks.ts");
    assert.match(links, /export async function openSystemShareFile\(url: string\): Promise<void> \{\s+try \{\s+await Share\.share\(\{ url \}\);/);

    // Nothing here ticks, counts or logs: one development line when a picture could not be made, and no word of the card in it.
    const own = ["src/utils/wordCardLayout.ts", "src/services/wordCardImage.ts", "src/services/wordCardShare.ts", "src/hooks/useWordShare.ts"];
    for (const file of own) {
      const source = read(file);
      assert.ok(!/haptics|analytics|\btrack\(|posthog/i.test(source), `${file}: no haptic and no event`);
      const logs = source.split(NL).filter((line) => line.includes("console."));
      if (file === "src/services/wordCardShare.ts") {
        assert.deepEqual(logs.map((line) => line.trim()), ['if (__DEV__) console.warn("[share] the picture could not be made");']);
      } else {
        assert.deepEqual(logs, [], `${file}: nothing is logged`);
      }
    }
  });

  await test("source: the picture's fonts, scenes and mark are the app's own files under the app's own names", async () => {
    const renderer = read("src/services/wordCardImage.ts");
    const app = read("App.tsx");
    const css = read("global.css");
    const theme = read("src/constants/theme.ts");
    const families = { frauncesMedium: "Fraunces_500Medium", frauncesItalic: "Fraunces_400Regular_Italic", frauncesSemibold: "Fraunces_600SemiBold", dmSemibold: "DMSans_600SemiBold" };
    const cssNames = { frauncesMedium: "--font-fraunces-medium", frauncesItalic: "--font-fraunces-italic", frauncesSemibold: "--font-fraunces-semibold", dmSemibold: "--font-dm-semibold" };
    for (const { specifier, name } of FONT_FILES) {
      const line = `import { ${name} } from "${specifier}";`;
      assert.ok(renderer.includes(line), `the renderer loads ${name}`);
      assert.ok(app.includes(line), `from the same file App.tsx loads for the app's text`);
      assert.ok(fs.existsSync(fontFile(name)), `${name}.ttf is installed`);
    }
    for (const [key, family] of Object.entries(families)) {
      assert.ok(theme.includes(`${key}: "${family}",`), `theme.fonts.${key}`);
      assert.ok(css.includes(`${cssNames[key]}: "${family}";`), `the class the card uses names the same family: ${cssNames[key]}`);
      assert.ok(renderer.includes(`[fonts.${key}, ${family}],`), `registered under fonts.${key}`);
      assert.ok(app.includes(`[fonts.${key}]: ${family},`), "as App.tsx registers it");
    }
    // The fake images module of these checks is shaped like the real one.
    const images = read("src/constants/images.ts");
    assert.ok(images.includes('import logoMarkLight from "@/assets/images/logo-mark-light.png";'));
    const list = images.replace(/\r\n/g, "\n").match(/export const playerScenes = \[\n([\s\S]*?)\] as const;/);
    assert.ok(list, "the playerScenes list");
    const names = list[1].split(",").map((name) => name.trim()).filter(Boolean);
    assert.deepEqual(names, Array.from({ length: 20 }, (_, i) => `playerScene${i + 1}`), "the twenty scenes in file order");
    for (let n = 1; n <= 20; n += 1) {
      assert.ok(images.includes(`import playerScene${n} from "@/assets/images/player-scene-${n}.jpg";`), `scene ${n}`);
    }
    assert.match(renderer, /playerScenes\[picture\.scene\] \?\? playerScenes\[0\]/);
    assert.match(renderer, /loadData\(images\.logoMarkLight\)/);
    // Apple's App Store badge (2026-11-23): its file is Apple's artwork as drawn, 359 by 120 with clear corners (RGBA), it is
    // read with the mark, and no screen of the app draws it: only the shared picture.
    assert.ok(images.includes('import appStoreBadge from "@/assets/images/app-store-badge.png";'));
    assert.match(renderer, /loadData\(images\.appStoreBadge\)/);
    const png = fs.readFileSync(BADGE_FILE);
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [359, 120, 6], "359 by 120, with an alpha channel");
    const users = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else if (/\.tsx?$/.test(entry.name) && read(relative).includes("appStoreBadge")) users.push(relative);
      }
    };
    walk("src");
    assert.deepEqual(users.sort(), ["src/constants/images.ts", "src/services/wordCardImage.ts"], "only the shared picture draws the badge");
    // No other store's badge (App Review Guideline 2.3.10; GraceHush is not on Google Play).
    for (const file of ["src/services/wordCardImage.ts", "src/utils/wordCardLayout.ts", "src/constants/images.ts"]) {
      const code = read(file).replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /google ?play|play ?store|googlePlay|playBadge/i, `${file} draws no other store's badge`);
    }
    // The two-tone name is the header wordmark's own words.
    const copy = read("src/constants/copy.ts");
    assert.match(copy, /wordmark: \{ grace: "Grace", hush: "Hush" \}/);
    assert.match(renderer, /copy\.header\.wordmark\.grace[\s\S]*copy\.header\.wordmark\.hush/);
  });
}

(async () => {
  await layoutChecks();
  await pictureChecks();
  await serviceChecks();
  await hookChecks();
  await sourceChecks();
  finished = true;
  if (failures.length === 0) {
    fs.writeSync(1, `${passed} checks passed${NL}`);
  } else {
    fs.writeSync(1, `${passed} checks passed, ${failures.length} FAILED:${NL}${NL} - ${failures.join(`${NL} - `)}${NL}`);
    process.exitCode = 1;
  }
})();
