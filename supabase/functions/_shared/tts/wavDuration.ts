// The length of a WAV, read from its header (step 22; the devotional is a WAV since 2026-10-24). Google's answer to a
// synthesize request carries no duration, and the app needs one (the scrubber, "1:55", the lock screen), so the function
// measures the file it stores. Cloud Text-to-Speech's LINEAR16 is a plain WAV: a 44-byte header (RIFF, one 16-byte "fmt "
// chunk for PCM, then "data") and 16-bit mono samples at the voice's native 24 kHz. The reader walks the chunks instead of
// assuming that layout, so a "LIST" chunk or an odd-sized chunk in front of "data" does not throw it, and it counts the
// bytes that are there when the data chunk's size field is a placeholder (0 or 0xFFFFFFFF, which streaming writers leave)
// or claims more than the file holds (a file cut short). Anything that is not a PCM WAVE gives null, never a guess.

const PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

type WavFormat = { channels: number; sampleRate: number; bitsPerSample: number };

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

// True for the bytes a WAV starts with: "RIFF", a size, "WAVE".
export function looksLikeWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WAVE";
}

// The "fmt " chunk, or null when it is not plain PCM (a float or a compressed format has no fixed bytes per sample).
function readFormat(view: DataView, body: number, size: number): WavFormat | null {
  if (size < 16 || body + 16 > view.byteLength) return null;
  const tag = view.getUint16(body, true);
  // WAVE_FORMAT_EXTENSIBLE keeps the real tag in the first two bytes of its sub-format GUID, 24 bytes into the chunk.
  const extensiblePcm = tag === WAVE_FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= view.byteLength &&
    view.getUint16(body + 24, true) === PCM;
  if (tag !== PCM && !extensiblePcm) return null;
  const format = {
    channels: view.getUint16(body + 2, true),
    sampleRate: view.getUint32(body + 4, true),
    bitsPerSample: view.getUint16(body + 14, true),
  };
  if (
    format.channels === 0 || format.sampleRate === 0 || format.bitsPerSample === 0 || format.bitsPerSample % 8 !== 0
  ) {
    return null;
  }
  return format;
}

// The duration in whole milliseconds, or null when the bytes are not a PCM WAV with a format and a data chunk.
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (!looksLikeWav(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: WavFormat | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = fourcc(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = readFormat(view, body, size);
      if (format === null) return null;
    } else if (id === "data") {
      if (format === null) return null;
      const available = bytes.length - body;
      const placeholder = size === 0 || size === 0xffffffff;
      const dataBytes = placeholder || size > available ? available : size;
      const frame = format.channels * (format.bitsPerSample / 8);
      return Math.round((Math.floor(dataBytes / frame) / format.sampleRate) * 1000);
    }
    at = body + size + (size % 2); // a chunk is padded to an even length
  }
  return null;
}
