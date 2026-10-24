// Microphone level helpers for the waveform. Pure: no React and no device.

// The recorder reports a level in dBFS: 0 is the loudest the microphone can carry and about -160 is silence. Speech
// sits roughly between -45 and -10, so -60 and below counts as silence and 0 as full scale.
export function meterToLevel(db: number | undefined): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

// One step of light smoothing, so the bars glide instead of jumping.
export function smoothLevel(previous: number, next: number): number {
  return 0.6 * previous + 0.4 * next;
}
