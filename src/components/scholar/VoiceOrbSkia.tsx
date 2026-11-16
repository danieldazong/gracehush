import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";
import { type SharedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import {
  createOrbSim,
  type OrbState,
  orbGoal,
  orbUniforms,
  stepOrb,
  type VoiceDrive,
} from "@/utils/orbShape";

import { ORB_SHADER } from "./orbShader";
import { type LevelSink, noteOrbRenderer, type OrbTrack, useTrackLevel } from "./voiceLevels";

// The shader orb (2026-11-15): the voice orb drawn on the GPU by Skia, so its outline can change shape with the voice, which
// views and bitmap layers cannot do. The look is the shader's (orbShader.ts) and the motion is the model's (orbShape.ts): once a
// frame, on the UI thread, `stepOrb` eases the orb toward the talk's state and the two voices' latest reports and moves its
// waves, ribbons, breath and ring on, and `orbUniforms` hands the result to the shader. A report or a frame costs no React
// render. The Talk screen loads this file only in a build that has Skia (VoiceOrb.tsx), and draws the image orb otherwise.
// Decorative: hidden from screen readers, takes no touch.

const effect = Skia.RuntimeEffect.Make(ORB_SHADER);
// False when the shader does not compile on this phone: the image orb is drawn instead.
export const orbShaderReady = effect !== null;

// The canvas is this many times the sphere, so the glow and a ring have room around it.
const CANVAS_RATIO = 1.6;
const SILENT: VoiceDrive = [0, 0, 0, 0];

type VoiceOrbProps = { size: number; state: OrbState; agentTrack: OrbTrack | null; micTrack: OrbTrack | null };

function sinkFor(voice: SharedValue<VoiceDrive>): LevelSink {
  return { set: (drive) => voice.set(drive), clear: () => voice.set(SILENT) };
}

export function VoiceOrbSkia({ size, state, agentTrack, micTrack }: VoiceOrbProps) {
  const reduceMotion = useReduceMotion();
  const canvas = Math.round(size * CANVAS_RATIO);
  const pixel = 1 / PixelRatio.get();
  const agent = useSharedValue<VoiceDrive>(SILENT);
  const mic = useSharedValue<VoiceDrive>(SILENT);
  const goal = useSharedValue(orbGoal(state, reduceMotion));
  const sim = useSharedValue(createOrbSim());
  const uniforms = useSharedValue(orbUniforms(createOrbSim(), size, canvas, pixel, reduceMotion));
  const [sinks] = useState(() => ({ agent: sinkFor(agent), mic: sinkFor(mic) }));

  useTrackLevel(agentTrack, "agent", sinks.agent);
  useTrackLevel(micTrack, "mic", sinks.mic);

  useEffect(() => noteOrbRenderer("shader"), []);
  useEffect(() => {
    goal.set(orbGoal(state, reduceMotion));
  }, [goal, state, reduceMotion]);

  useFrameCallback((frame) => {
    "worklet";
    const now = goal.get();
    const voiceOfAgent = agent.get();
    const voiceOfMic = mic.get();
    const elapsed = frame.timeSincePreviousFrame ?? 16;
    sim.modify((value) => {
      "worklet";
      return stepOrb(value, now, voiceOfAgent, voiceOfMic, elapsed);
    }, false);
    uniforms.set(orbUniforms(sim.get(), size, canvas, pixel, now.still));
  });

  if (effect === null) return null;
  const offset = (size - canvas) / 2;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}
    >
      <Canvas style={[styles.canvas, { width: canvas, height: canvas, left: offset, top: offset }]}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

// Canvas takes a style, not a className (Style Exception Rules); the sizes are computed.
const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  // The canvas is larger than the layout box (the glow and the ring), so it is placed out of flow and centred on the sphere.
  canvas: { position: "absolute" },
});
