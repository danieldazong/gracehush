import { LEVEL_CEILING, LEVEL_FLOOR, settleLevel } from "@/utils/orbLevel";

// The voice orb's shape and motion (2026-11-15), for the shader orb (`VoiceOrbSkia`). The orb is a plum sphere whose outline
// is a circle plus four slow waves (two, three, four and five lobes around it). At rest the waves are a breath of the outline,
// about 1.5% of the radius in all, so the sphere looks alive but round; a voice raises them to about 10.7%, so the outline
// bulges and ripples with what is said, more the louder it is. The low bands of the voice drive the broad lobes and the high
// bands the fine ones, so a deep voice and a bright one move it differently. The waves travel round the sphere, faster with
// the voice, and two ribbons of light turn inside it.
//
// What runs in the frame is a worklet: the shader orb runs it on the UI thread once a frame (`stepOrb`, then `orbUniforms`),
// with no React render. The report side (`voiceBands`, `settleDrive`) runs on the JavaScript thread, where LiveKit's reports
// arrive (voiceLevels.ts). It is all pure, so the Node checks run it too.

// The talk as the orb shows it (the Talk screen maps its phases to these).
export type OrbState = "connecting" | "listening" | "thinking" | "speaking" | "muted" | "held" | "ended";

// How see-through the sphere is in each state: a sleeping orb is dimmer.
export const ORB_ALPHA: Record<OrbState, number> = {
  connecting: 0.7,
  listening: 1,
  thinking: 1,
  speaking: 1,
  muted: 0.7,
  held: 0.7,
  ended: 0.6,
};

// A voice as the orb reads it: [level, low, mid, high], each 0 (nothing) to 1 (a full voice). The level is LiveKit's report
// through `orbLevel`; the three drives are its bands, low (the first two), mid (the third) and high (the last two).
export type VoiceDrive = [number, number, number, number];

// How each state should look. The shader orb sets it when the talk's state changes; `stepOrb` eases toward it.
export type OrbGoal = {
  agent: number; // follow Scholar's voice (1) or not (0)
  mic: number; // follow the person's voice
  alpha: number; // the sphere's opacity
  glowOn: number; // the rose glow behind it
  motion: number; // the outline's resting waves: 1 alive, 0 a still circle (muted, on hold, ended)
  breath: number; // the listening breath
  spin: number; // the ribbons turn (1) or rest (0, when the talk is over)
  ripple: boolean; // rings leave the sphere (connecting and thinking)
  still: boolean; // Reduce Motion: nothing moves or changes shape; the voice only brightens the light and the glow
};

// What the orb is now, carried from frame to frame.
export type OrbSim = {
  agent: VoiceDrive;
  mic: VoiceDrive;
  wAgent: number;
  wMic: number;
  alpha: number;
  glowOn: number;
  motion: number;
  breath: number;
  spin: number;
  phase: [number, number, number, number]; // the four waves' phases, radians
  turn: [number, number]; // the rose and the champagne ribbons' angles, radians
  warp: [number, number]; // the liquid warp's two clocks, radians
  breathPhase: number;
  ring: number; // a ring's progress, 0 at the sphere to 1 gone; 1 when no ring is out
};

// The shader's uniforms (orbShader.ts), by name.
export type OrbUniforms = {
  center: [number, number];
  radius: number;
  pixel: number;
  swell: number;
  amp: [number, number, number, number];
  phase: [number, number, number, number];
  turn: [number, number];
  warp: [number, number];
  level: number;
  alpha: number;
  glow: number;
  ring: number;
};

// The four waves (two, three, four and five lobes): their size at rest and what a full voice adds, as shares of the radius,
// and how fast each travels round the sphere at rest, in radians a second (alternate ways, so they never lock together).
export const LOBE_REST: readonly number[] = [0.006, 0.004, 0.003, 0.002];
export const LOBE_VOICE: readonly number[] = [0.034, 0.026, 0.018, 0.014];
export const LOBE_SPEED: readonly number[] = [0.5, -0.7, 0.9, -1.2];
// A full voice makes the waves, the ribbons and the warp run this many times faster (1 + this).
export const VOICE_SPEEDUP = 2;
export const RIBBON_SPEEDUP = 1.5;
// One turn of the rose ribbon and, the other way, of the champagne light.
export const ROSE_TURN_S = 22;
export const LIGHT_TURN_S = 31;
const WARP_SPEED: readonly number[] = [1.3, 1.1];
// The sphere swells this much at a full voice, and the listening breath this much on a four-second cycle.
export const SWELL = 0.04;
export const BREATH = 0.025;
const BREATH_CYCLE_S = 4;
// A ring leaves the sphere every 1.4 seconds while connecting and thinking.
export const RING_S = 1.4;
// The glow's opacity in silence and at a full voice.
export const GLOW_REST = 0.18;
export const GLOW_PEAK = 0.62;
// How fast the orb follows: a voice rises in about a tenth of a second and falls a little slower (LiveKit's reports already
// let it fall over about a second, `settleLevel`); a change of voice crosses over in about 200 ms, a change of state in 300.
export const RISE_S = 0.035;
export const FALL_S = 0.12;
const SOURCE_S = 0.07;
const STATE_S = 0.1;
// A frame longer than this (the app was busy) moves the orb only this far.
const MAX_STEP_S = 0.05;
const TWO_PI = Math.PI * 2;

// One band's magnitude, stretched between the floor and the ceiling like the level (`orbLevel`).
export function bandLevel(magnitude: number): number {
  const clean = Number.isFinite(magnitude) ? magnitude : 0;
  return Math.min(Math.max((clean - LEVEL_FLOOR) / (LEVEL_CEILING - LEVEL_FLOOR), 0), 1);
}

function mean(values: readonly number[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to && i < values.length; i += 1) {
    sum += bandLevel(values[i]);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

// The three drives of a report's bands: low (the first two), mid (the third) and high (the fourth and fifth).
export function voiceBands(magnitudes: readonly number[]): [number, number, number] {
  return [mean(magnitudes, 0, 2), mean(magnitudes, 2, 3), mean(magnitudes, 3, 5)];
}

// A drive after a report: each value rises at once and falls by a share, like the level.
export function settleDrive(held: VoiceDrive, reported: VoiceDrive): VoiceDrive {
  return [
    settleLevel(held[0], reported[0]),
    settleLevel(held[1], reported[1]),
    settleLevel(held[2], reported[2]),
    settleLevel(held[3], reported[3]),
  ];
}

// One step of an easing toward a target: quick when rising, slower when falling (time constants in seconds).
export function approach(current: number, target: number, dt: number, rise: number, fall: number): number {
  "worklet";
  const tau = target > current ? rise : fall;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// The four waves' sizes for a voice and how alive the resting outline is.
export function lobeAmplitudes(low: number, mid: number, high: number, motion: number): [number, number, number, number] {
  "worklet";
  return [
    LOBE_REST[0] * motion + LOBE_VOICE[0] * low,
    LOBE_REST[1] * motion + LOBE_VOICE[1] * (low + mid) * 0.5,
    LOBE_REST[2] * motion + LOBE_VOICE[2] * (mid + high) * 0.5,
    LOBE_REST[3] * motion + LOBE_VOICE[3] * high,
  ];
}

function wrap(angle: number): number {
  "worklet";
  const turned = angle % TWO_PI;
  return turned < 0 ? turned + TWO_PI : turned;
}

// The goal for a state: Scholar's voice while Scholar speaks and the person's while they speak, the glow while the talk is
// awake, the resting waves unless it is muted, held or over, the breath while listening, and rings while connecting and
// thinking.
export function orbGoal(state: OrbState, still: boolean): OrbGoal {
  "worklet";
  const asleep = state === "muted" || state === "held" || state === "ended";
  return {
    agent: state === "speaking" ? 1 : 0,
    mic: state === "listening" ? 1 : 0,
    alpha: ORB_ALPHA[state],
    glowOn: state === "listening" || state === "thinking" || state === "speaking" ? 1 : 0,
    motion: asleep ? 0 : 1,
    breath: state === "listening" ? 1 : 0,
    spin: state === "ended" ? 0 : 1,
    ripple: state === "connecting" || state === "thinking",
    still,
  };
}

export function createOrbSim(): OrbSim {
  return {
    agent: [0, 0, 0, 0],
    mic: [0, 0, 0, 0],
    wAgent: 0,
    wMic: 0,
    alpha: 0.7,
    glowOn: 0,
    motion: 1,
    breath: 0,
    spin: 1,
    phase: [0.3, 1.9, 4.1, 2.7],
    turn: [0, 0],
    warp: [0, 0],
    breathPhase: 0,
    ring: 1,
  };
}

// The voice the orb follows now: each source's voice by its weight.
export function orbVoice(sim: OrbSim): VoiceDrive {
  "worklet";
  return [
    sim.agent[0] * sim.wAgent + sim.mic[0] * sim.wMic,
    sim.agent[1] * sim.wAgent + sim.mic[1] * sim.wMic,
    sim.agent[2] * sim.wAgent + sim.mic[2] * sim.wMic,
    sim.agent[3] * sim.wAgent + sim.mic[3] * sim.wMic,
  ];
}

// One frame: the sim eases toward the goal and the two voices' latest reports, and the waves, ribbons, breath and ring move on.
// It changes the sim in place (the shader orb keeps it in a shared value and steps it with `modify`).
export function stepOrb(sim: OrbSim, goal: OrbGoal, agent: VoiceDrive, mic: VoiceDrive, elapsedMs: number): OrbSim {
  "worklet";
  const dt = Math.min(Math.max(elapsedMs, 0) / 1000, MAX_STEP_S);
  for (let i = 0; i < 4; i += 1) {
    sim.agent[i] = approach(sim.agent[i], agent[i], dt, RISE_S, FALL_S);
    sim.mic[i] = approach(sim.mic[i], mic[i], dt, RISE_S, FALL_S);
  }
  sim.wAgent = approach(sim.wAgent, goal.agent, dt, SOURCE_S, SOURCE_S);
  sim.wMic = approach(sim.wMic, goal.mic, dt, SOURCE_S, SOURCE_S);
  sim.alpha = approach(sim.alpha, goal.alpha, dt, STATE_S, STATE_S);
  sim.glowOn = approach(sim.glowOn, goal.glowOn, dt, STATE_S, STATE_S);
  sim.motion = approach(sim.motion, goal.still ? 0 : goal.motion, dt, STATE_S, STATE_S);
  sim.breath = approach(sim.breath, goal.still ? 0 : goal.breath, dt, STATE_S, STATE_S);
  sim.spin = approach(sim.spin, goal.still ? 0 : goal.spin, dt, STATE_S, STATE_S);

  const level = orbVoice(sim)[0];
  if (!goal.still) {
    const speed = Math.max(sim.motion, level) * (1 + VOICE_SPEEDUP * level);
    for (let i = 0; i < 4; i += 1) sim.phase[i] = wrap(sim.phase[i] + LOBE_SPEED[i] * speed * dt);
    const ribbons = sim.spin * (1 + RIBBON_SPEEDUP * level);
    sim.turn[0] = wrap(sim.turn[0] + (TWO_PI / ROSE_TURN_S) * ribbons * dt);
    sim.turn[1] = wrap(sim.turn[1] - (TWO_PI / LIGHT_TURN_S) * ribbons * dt);
    const flow = sim.spin * (1 + VOICE_SPEEDUP * level);
    sim.warp[0] = wrap(sim.warp[0] + WARP_SPEED[0] * flow * dt);
    sim.warp[1] = wrap(sim.warp[1] + WARP_SPEED[1] * flow * dt);
    sim.breathPhase = wrap(sim.breathPhase + (TWO_PI / BREATH_CYCLE_S) * dt);
  }
  // A ring that is out finishes; a new one starts only while the goal asks for rings.
  if (sim.ring < 1) sim.ring = Math.min(sim.ring + dt / RING_S, 1);
  else if (goal.ripple && !goal.still) sim.ring = 0;
  return sim;
}

// The shader's uniforms for a frame. The ring's progress is eased out, as the orb's first build drew it.
export function orbUniforms(sim: OrbSim, size: number, canvas: number, pixel: number, still: boolean): OrbUniforms {
  "worklet";
  const voice = orbVoice(sim);
  const level = voice[0];
  const amp: [number, number, number, number] = still
    ? [0, 0, 0, 0]
    : lobeAmplitudes(voice[1], voice[2], voice[3], sim.motion);
  const breathing = 1 + BREATH * sim.breath * (0.5 - 0.5 * Math.cos(sim.breathPhase));
  const ring = sim.ring >= 1 ? 1 : 1 - (1 - sim.ring) * (1 - sim.ring);
  return {
    center: [canvas / 2, canvas / 2],
    radius: size / 2,
    pixel,
    swell: still ? 1 : breathing * (1 + SWELL * level),
    amp,
    phase: [sim.phase[0], sim.phase[1], sim.phase[2], sim.phase[3]],
    turn: [sim.turn[0], sim.turn[1]],
    warp: [sim.warp[0], sim.warp[1]],
    level,
    alpha: sim.alpha,
    glow: sim.glowOn * (GLOW_REST + (GLOW_PEAK - GLOW_REST) * level),
    ring,
  };
}
