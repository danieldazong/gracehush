import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, StyleSheet, TurboModuleRegistry, View } from "react-native";

import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
import { usePulse } from "@/hooks/usePulse";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { ORB_ALPHA, type OrbState, type VoiceDrive } from "@/utils/orbShape";

import { type LevelSink, noteOrbRenderer, type OrbTrack, useTrackLevel } from "./voiceLevels";

export type { OrbState } from "@/utils/orbShape";
export type { OrbTrack } from "./voiceLevels";

// The voice orb of a live talk with Scholar (2026-11-15): a plum sphere with two ribbons of light turning inside it, a sheen
// for the glass look and a rose glow behind it, in the brand's colours. It follows the sound: Scholar's voice while Scholar
// speaks and the person's own while they speak (voiceLevels.ts reads them from LiveKit).
//
// - Where the build has Skia, it is the shader orb (VoiceOrbSkia.tsx): its outline changes shape with the voice, more the
//   louder it is, and its waves, ribbons and light run faster and brighter. The Talk screen's bundle loads Skia only then,
//   because Skia's native module is required the moment its JavaScript runs (a build without it, and Expo Go, would throw).
// - Otherwise it is the image orb below, five bitmap layers (assets/images/orb-*.png) that swell, spread and glow with the
//   level but keep a round outline.
// - Both: listening, a slow breath; thinking and connecting, a ring that leaves the sphere about every second and a half;
//   muted, on hold and ended, the sphere dims and the glow goes out. Reduce Motion: nothing turns, swells, breathes, ripples or
//   changes shape; the level only changes the brightness of the light, the sheen and the glow. Decorative: hidden from screen
//   readers, takes no touch. The screen's status line says what is happening.

type VoiceOrbProps = {
  // The sphere's diameter. The glow is drawn at 1.6 times it, so the layout box stays the sphere's own and the glow overflows.
  size: number;
  state: OrbState;
  // Scholar's voice and the person's microphone, when the room has them.
  agentTrack: OrbTrack | null;
  micTrack: OrbTrack | null;
};

// The shader orb, when this build can draw it: Skia's native module is here and the shader compiles. Read once, when the Talk
// screen first loads this file.
type ShaderOrbModule = typeof import("./VoiceOrbSkia");
function loadShaderOrb(): ShaderOrbModule["VoiceOrbSkia"] | null {
  try {
    if (TurboModuleRegistry.get("RNSkiaModule") === null) return null;
    // A lazy require keeps Skia out of a build that does not have it: its JavaScript requires the native module on load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("./VoiceOrbSkia") as ShaderOrbModule;
    return loaded.orbShaderReady ? loaded.VoiceOrbSkia : null;
  } catch {
    return null;
  }
}
const ShaderOrb = loadShaderOrb();

export function VoiceOrb(props: VoiceOrbProps) {
  return ShaderOrb === null ? <ImageOrb {...props} /> : <ShaderOrb {...props} />;
}

// The image orb. Each report is eased in over this long, a little over two reports, so the motion runs on between them.
const LEVEL_STEP_MS = 80;
// A change of voice (Scholar to the person and back) crosses over in this time.
const SOURCE_FADE_MS = 200;
const DIM_MS = 300;

// Looks and motion.
const GLOW_RATIO = 1.6; // the glow layer, drawn at this many times the sphere
const GLOW_REACH = 1.2; // at a full voice the glow has grown to this much of its size
const GLOW_REST = 0.18; // the glow's opacity in silence, and at a full voice
const GLOW_PEAK = 0.62;
const SPHERE_SWELL = 1.06; // the sphere at a full voice
const ROSE_SWELL = 1.35; // the rose ribbon spreads this far at a full voice
const LIGHT_REST = 0.55; // the champagne light's opacity in silence (it is 1 at a full voice)
const SHEEN_REST = 0.3;
const SHEEN_PEAK = 0.5;
const ROSE_START = "20deg"; // where each ribbon starts, so the two never line up
const LIGHT_START = "-35deg";
const ROSE_TURN_MS = 22_000; // one turn of the rose ribbon, and of the champagne light the other way
const LIGHT_TURN_MS = 31_000;
const BREATH_TO = 1.025; // listening: the sphere swells and settles on a four-second cycle
const BREATH_HALF_MS = 2_000;
const RIPPLE_MS = 1_400; // thinking and connecting: a ring leaves the sphere
const RIPPLE_TO = 1.35;
const RIPPLE_OPACITY = 0.45;

// Everything the orb animates, made once: the two levels, the weights that say which of them to follow, and every value derived
// from the level (a derived node made in render would be made again each time).
function createNodes() {
  const agentLevel = new Animated.Value(0);
  const micLevel = new Animated.Value(0);
  // A track's voice, as the image orb reads it: its level, eased in natively.
  const sinkFor = (target: Animated.Value): LevelSink => ({
    set: (voice: VoiceDrive) =>
      Animated.timing(target, {
        toValue: voice[0],
        duration: LEVEL_STEP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(),
    clear: () => target.setValue(0),
  });
  const agentWeight = new Animated.Value(0);
  const micWeight = new Animated.Value(0);
  const level = Animated.add(Animated.multiply(agentLevel, agentWeight), Animated.multiply(micLevel, micWeight));
  const glowOn = new Animated.Value(0);
  const ripple = new Animated.Value(1); // 1 is the end of a ring: out at full size and gone
  const turnRose = new Animated.Value(0);
  const turnLight = new Animated.Value(0);
  const ramp = (from: number, to: number) =>
    level.interpolate({ inputRange: [0, 1], outputRange: [from, to], extrapolate: "clamp" });
  return {
    agentSink: sinkFor(agentLevel),
    micSink: sinkFor(micLevel),
    agentWeight,
    micWeight,
    glowOn,
    ripple,
    turnRose,
    turnLight,
    dim: new Animated.Value(ORB_ALPHA.connecting),
    sphereSwell: ramp(1, SPHERE_SWELL),
    roseSwell: ramp(1, ROSE_SWELL),
    lightOpacity: ramp(LIGHT_REST, 1),
    sheenOpacity: ramp(SHEEN_REST, SHEEN_PEAK),
    glowScale: ramp(1, GLOW_REACH),
    glowOpacity: Animated.multiply(glowOn, ramp(GLOW_REST, GLOW_PEAK)),
    rippleScale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, RIPPLE_TO] }),
    rippleOpacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [RIPPLE_OPACITY, 0] }),
    spinRose: turnRose.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
    spinLight: turnLight.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] }),
  };
}

function ImageOrb({ size, state, agentTrack, micTrack }: VoiceOrbProps) {
  const reduceMotion = useReduceMotion();
  const [nodes] = useState(createNodes);
  const breath = usePulse(BREATH_TO, state === "listening", BREATH_HALF_MS);
  const sphereScale = useMemo(() => Animated.multiply(breath, nodes.sphereSwell), [breath, nodes]);

  useTrackLevel(agentTrack, "agent", nodes.agentSink);
  useTrackLevel(micTrack, "mic", nodes.micSink);
  useEffect(() => noteOrbRenderer("images"), []);

  // Which voice the orb follows, how dim it is and whether it glows follow the state.
  useEffect(() => {
    const fade = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, { toValue, duration, useNativeDriver: true });
    const glows = state === "listening" || state === "thinking" || state === "speaking";
    const running = Animated.parallel([
      fade(nodes.agentWeight, state === "speaking" ? 1 : 0, SOURCE_FADE_MS),
      fade(nodes.micWeight, state === "listening" ? 1 : 0, SOURCE_FADE_MS),
      fade(nodes.dim, ORB_ALPHA[state], DIM_MS),
      fade(nodes.glowOn, glows ? 1 : 0, DIM_MS),
    ]);
    running.start();
    return () => running.stop();
  }, [nodes, state]);

  // A ring leaves the sphere while Scholar is thinking and while the talk connects.
  const rippling = !reduceMotion && (state === "connecting" || state === "thinking");
  useEffect(() => {
    nodes.ripple.setValue(1);
    if (!rippling) return undefined;
    nodes.ripple.setValue(0);
    const loop = Animated.loop(
      Animated.timing(nodes.ripple, {
        toValue: 1,
        duration: RIPPLE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      nodes.ripple.setValue(1);
    };
  }, [nodes, rippling]);

  // The two ribbons turn the whole time the talk is on, held and muted included: stopping and starting them again would jump.
  const turning = !reduceMotion && state !== "ended";
  useEffect(() => {
    if (!turning) return undefined;
    const turn = (value: Animated.Value, duration: number) =>
      Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    const rose = turn(nodes.turnRose, ROSE_TURN_MS);
    const light = turn(nodes.turnLight, LIGHT_TURN_MS);
    rose.start();
    light.start();
    return () => {
      rose.stop();
      light.stop();
    };
  }, [nodes, turning]);

  const glowBox = Math.round(size * GLOW_RATIO);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}
    >
      <Animated.View
        style={[
          styles.layer,
          { width: glowBox, height: glowBox, opacity: nodes.glowOpacity },
          !reduceMotion && { transform: [{ scale: nodes.glowScale }] },
        ]}
      >
        <Image source={images.orbGlow} contentFit="fill" style={styles.fill} />
      </Animated.View>
      <Animated.View
        needsOffscreenAlphaCompositing
        style={[
          styles.sphere,
          { width: size, height: size, borderRadius: size / 2, opacity: nodes.dim },
          !reduceMotion && { transform: [{ scale: sphereScale }] },
        ]}
      >
        <Image source={images.orbCore} contentFit="fill" style={styles.fill} />
        <Animated.View
          style={[
            styles.fill,
            styles.blend,
            {
              transform: reduceMotion
                ? [{ rotate: ROSE_START }]
                : [{ rotate: ROSE_START }, { rotate: nodes.spinRose }, { scale: nodes.roseSwell }],
            },
          ]}
        >
          <Image source={images.orbRibbonRose} contentFit="fill" style={styles.fill} />
        </Animated.View>
        <Animated.View
          style={[
            styles.fill,
            styles.blend,
            {
              opacity: nodes.lightOpacity,
              transform: reduceMotion ? [{ rotate: LIGHT_START }] : [{ rotate: LIGHT_START }, { rotate: nodes.spinLight }],
            },
          ]}
        >
          <Image source={images.orbRibbonLight} contentFit="fill" style={styles.fill} />
        </Animated.View>
        <Animated.View style={[styles.fill, styles.blend, { opacity: nodes.sheenOpacity }]}>
          <Image source={images.orbSheen} contentFit="fill" style={styles.fill} />
        </Animated.View>
      </Animated.View>
      <Animated.View
        style={[
          styles.layer,
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: nodes.rippleOpacity,
            transform: [{ scale: nodes.rippleScale }],
          },
        ]}
      />
    </View>
  );
}

// Animated.View and expo-image take a style, not a className (Style Exception Rules); the sizes are computed.
const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  // The glow and the ring are centred on the sphere and larger or smaller than the layout box, so they are placed out of flow.
  layer: { position: "absolute" },
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  // The ribbons and the sheen are screen-blended into the sphere, which clips them to its circle.
  sphere: { overflow: "hidden" },
  blend: { mixBlendMode: "screen" },
  ring: { borderWidth: 2, borderColor: colors.plum },
});
