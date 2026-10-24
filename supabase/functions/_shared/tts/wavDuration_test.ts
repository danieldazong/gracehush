import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { looksLikeWav, wavDurationMs } from "./wavDuration.ts";

// The two files in fixtures/ are real Cloud Text-to-Speech answers (LINEAR16, Chirp 3 HD, made-up words, 2026-10-24). The
// expected lengths come from ffprobe, counted independently of this code: the data bytes over the byte rate.
//   a  "Amen." at 24 kHz mono 16-bit                   61,552 data bytes / 48,000 = 1282 ms  (ffprobe 1.282333 s)
//   b  "Peace be with you. [pause] Rest now." at 8 kHz  49,392 data bytes / 16,000 = 3087 ms  (ffprobe 3.087000 s)
const FILES = [
  { file: "a-24k-mono-amen.wav", ms: 1282, rate: 24000 },
  { file: "b-8k-mono-pause.wav", ms: 3087, rate: 8000 },
];

// assertEquals compares through JSON.stringify, which prints NaN as null: a duration of NaN would pass it. This does not.
function isNull(value: number | null, message = ""): void {
  assert(value === null, `${message}: expected null, got ${value}`);
}
const load = (file: string) => Deno.readFile(new URL(`./fixtures/${file}`, import.meta.url));

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

type Spec = {
  channels?: number;
  rate?: number;
  bits?: number;
  tag?: number;
  dataBytes?: number;
  dataSizeField?: number; // what the data chunk's size field says, when it should differ from dataBytes
  before?: number[]; // extra chunks between "fmt " and "data"
  extensible?: boolean; // a 40-byte WAVE_FORMAT_EXTENSIBLE chunk with this sub-format tag
  subFormat?: number;
};

// A WAV built by hand, the way a writer lays it out: RIFF, WAVE, "fmt ", any other chunks, "data".
function wav(spec: Spec = {}): Uint8Array {
  const channels = spec.channels ?? 1, rate = spec.rate ?? 24000, bits = spec.bits ?? 16;
  const dataBytes = spec.dataBytes ?? 48000;
  const blockAlign = channels * (bits / 8);
  const fmtBody = spec.extensible
    ? [
      ...u16(0xfffe),
      ...u16(channels),
      ...u32(rate),
      ...u32(rate * blockAlign),
      ...u16(blockAlign),
      ...u16(bits),
      ...u16(22),
      ...u16(bits),
      ...u32(0),
      ...u16(spec.subFormat ?? 1),
      ...new Array(14).fill(0),
    ]
    : [
      ...u16(spec.tag ?? 1),
      ...u16(channels),
      ...u32(rate),
      ...u32(rate * blockAlign),
      ...u16(blockAlign),
      ...u16(bits),
    ];
  const chunks = [
    ...ascii("fmt "),
    ...u32(fmtBody.length),
    ...fmtBody,
    ...(spec.before ?? []),
    ...ascii("data"),
    ...u32(spec.dataSizeField ?? dataBytes),
    ...new Array(dataBytes).fill(0),
  ];
  return new Uint8Array([...ascii("RIFF"), ...u32(4 + chunks.length), ...ascii("WAVE"), ...chunks]);
}

Deno.test("the real files: the length to the millisecond, as ffprobe counts it", async () => {
  for (const { file, ms } of FILES) {
    const bytes = await load(file);
    assert(looksLikeWav(bytes), file);
    assertEquals(wavDurationMs(bytes), ms, file);
  }
});

Deno.test("the arithmetic: channels, sample rate and bits per sample", () => {
  assertEquals(wavDurationMs(wav()), 1000, "24 kHz mono 16-bit: 48,000 bytes a second");
  assertEquals(wavDurationMs(wav({ rate: 8000, dataBytes: 16000 })), 1000);
  assertEquals(wavDurationMs(wav({ channels: 2, dataBytes: 96000 })), 1000, "stereo doubles the bytes a second");
  assertEquals(wavDurationMs(wav({ bits: 8, dataBytes: 24000 })), 1000, "8-bit halves them");
  assertEquals(wavDurationMs(wav({ dataBytes: 72000 })), 1500);
  assertEquals(wavDurationMs(wav({ dataBytes: 1 })), 0, "a byte that is not a whole sample counts for nothing");
  assertEquals(wavDurationMs(wav({ dataBytes: 0 })), 0);
});

Deno.test("chunks in front of the data are walked past, odd-sized ones with their padding byte", () => {
  const list = [...ascii("LIST"), ...u32(4), ...ascii("INFO")];
  assertEquals(wavDurationMs(wav({ before: list })), 1000);
  const odd = [...ascii("junk"), ...u32(3), 1, 2, 3, 0]; // three bytes of body and one of padding
  assertEquals(wavDurationMs(wav({ before: odd })), 1000);
  assertEquals(wavDurationMs(wav({ before: [...list, ...odd] })), 1000);
});

Deno.test("a placeholder size counts the bytes that are there, and so does a size past the end of the file", () => {
  assertEquals(wavDurationMs(wav({ dataSizeField: 0 })), 1000, "0: a writer that never came back to fill it in");
  assertEquals(wavDurationMs(wav({ dataSizeField: 0xffffffff })), 1000, "0xFFFFFFFF: a streaming writer");
  const cut = wav().slice(0, 44 + 24000); // half the samples are missing
  assertEquals(wavDurationMs(cut), 500);
  assertEquals(wavDurationMs(wav().slice(0, 44 + 48000 - 1)), 1000, "one byte short is a sample short: still 1000 ms");
});

Deno.test("WAVE_FORMAT_EXTENSIBLE is read when its sub-format is PCM, and refused otherwise", () => {
  assertEquals(wavDurationMs(wav({ extensible: true })), 1000);
  isNull(wavDurationMs(wav({ extensible: true, subFormat: 3 })), "float in an extensible header");
});

Deno.test("not a PCM WAV is null, never a guess", () => {
  isNull(wavDurationMs(new Uint8Array(0)), "empty");
  isNull(wavDurationMs(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), "bytes");
  isNull(wavDurationMs(crypto.getRandomValues(new Uint8Array(5000))), "noise");
  isNull(wavDurationMs(new Uint8Array([0xff, 0xf3, 0x44, 0xc4, ...new Array(2000).fill(0)])), "an MPEG frame");
  isNull(wavDurationMs(new TextEncoder().encode("RIFF....WAVEfmt ".repeat(200))), "the words with nothing behind them");
  isNull(wavDurationMs(wav({ tag: 3 })), "32-bit float");
  isNull(wavDurationMs(wav({ tag: 85 })), "an MP3 inside a WAV");
  isNull(wavDurationMs(wav({ rate: 0 })), "a sample rate of zero");
  isNull(wavDurationMs(wav({ channels: 0 })), "no channels");
  isNull(wavDurationMs(wav({ bits: 12 })), "bits that are not whole bytes");

  // "data" before any "fmt ": nothing says how to count the bytes.
  const noFormat = new Uint8Array([
    ...ascii("RIFF"),
    ...u32(100),
    ...ascii("WAVE"),
    ...ascii("data"),
    ...u32(96),
    ...new Array(96).fill(0),
  ]);
  isNull(wavDurationMs(noFormat), "no fmt chunk");
  // A header and nothing else.
  isNull(wavDurationMs(wav().slice(0, 36)), "ends after the format");
  assert(!looksLikeWav(new Uint8Array([0x49, 0x44, 0x33, 4, 0])), "an ID3 tag is not a WAV");
});

Deno.test("a long file is read at once: the header says everything", () => {
  // 25 MiB is the bucket's limit: at 48,000 bytes a second that is about 546 s. The size field is read, not the samples.
  const seconds = 546;
  const bytes = wav({ dataBytes: seconds * 48000 });
  const started = performance.now();
  assertEquals(wavDurationMs(bytes), seconds * 1000);
  assert(performance.now() - started < 50, "reading a 25 MiB header took too long");
});
