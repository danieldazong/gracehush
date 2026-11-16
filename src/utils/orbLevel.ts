// The voice orb's level (2026-11-15). LiveKit's multiband volume processor reports a magnitude from 0 to 1 for each of a few
// frequency bands about 25 times a second; the orb wants one number from 0 (nothing to hear) to 1 (a full voice). Pure, so the
// Node checks run it. The numbers are worked out from the processor's scale (its magnitudes are normalized over 64 dB) and are
// to be tuned on the phone: the orb's developer read-out (`getOrbLevelDebug`) shows what the processor really reports.

// At or below this level the room's own noise; at or above this a full voice.
export const LEVEL_FLOOR = 0.08;
export const LEVEL_CEILING = 0.6;
// Per report, how much of the last level is kept when the voice drops: the orb rises at once, falls to half in about 200 ms and
// is at rest in about a second (reports come every 40 ms).
export const LEVEL_RELEASE = 0.85;
// A level this small is silence: it is set to nothing so the orb comes to rest instead of shrinking forever.
const SILENCE = 0.01;

// One level from a report's band magnitudes: their root mean square, so a voice that fills a few of the bands counts for more
// than a hiss across all of them, stretched between the floor and the ceiling. Anything that is not a number counts as nothing.
export function orbLevel(magnitudes: readonly number[]): number {
  if (magnitudes.length === 0) return 0;
  let squares = 0;
  for (const magnitude of magnitudes) {
    const clean = Number.isFinite(magnitude) ? Math.min(Math.max(magnitude, 0), 1) : 0;
    squares += clean * clean;
  }
  const rms = Math.sqrt(squares / magnitudes.length);
  return Math.min(Math.max((rms - LEVEL_FLOOR) / (LEVEL_CEILING - LEVEL_FLOOR), 0), 1);
}

// The level the orb holds after a report: a louder report is taken at once, a quieter one only lets the last level fall by a
// fixed share, so a spoken word swells and then settles.
export function settleLevel(held: number, reported: number): number {
  const next = Math.max(reported, held * LEVEL_RELEASE);
  return next < SILENCE ? 0 : next;
}
