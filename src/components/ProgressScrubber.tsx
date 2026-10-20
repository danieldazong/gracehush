import { useRef, useState } from "react";
import { View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";

import { colors, shadows } from "@/constants/theme";

type ProgressScrubberProps = {
  value: number;
  max: number;
  // What a screen reader's increment and decrement move.
  step: number;
  color: string;
  trackHeight: number;
  disabled?: boolean;
  accessibilityLabel: string;
  // The spoken value: "34 seconds of 1 minute 15 seconds", "50 percent".
  formatValueText: (value: number) => string;
  // A touch took hold of the track. The parent can stop its ScrollView scrolling until onSeekEnd.
  onSeekStart?: () => void;
  // While the finger moves, including the first touch down. The parent decides what to do with the stream.
  onSeekChange: (value: number) => void;
  // The finger lifted, the system took the touch away, or a screen reader moved the value.
  onSeekEnd: (value: number) => void;
};

const THUMB = 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Where the finger took hold: the page position of the touch, and where it was on the track.
type Grab = { pageX: number; x: number; value: number };

// A track with a draggable thumb: the player's scrubber, the ambient volume here, and Profile's volume in
// step 15. It is controlled: it holds no value of its own, so a parent that wants to ignore store ticks while
// dragging keeps the dragged value in its own state.
export function ProgressScrubber({
  value,
  max,
  step,
  color,
  trackHeight,
  disabled = false,
  accessibilityLabel,
  formatValueText,
  onSeekStart,
  onSeekChange,
  onSeekEnd,
}: ProgressScrubberProps) {
  const [width, setWidth] = useState(0);
  // The touch that is dragging. Read and written only in the handlers below, never while rendering.
  const grab = useRef<Grab | null>(null);

  const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;

  // The value follows the finger even beyond the ends of the track, and clamps there.
  function valueAt(event: GestureResponderEvent, from: Grab) {
    const x = from.x + (event.nativeEvent.pageX - from.pageX);
    return width > 0 ? clamp(x / width, 0, 1) * max : 0;
  }

  function onGrant(event: GestureResponderEvent) {
    const from: Grab = { pageX: event.nativeEvent.pageX, x: event.nativeEvent.locationX, value: 0 };
    from.value = valueAt(event, from);
    grab.current = from;
    onSeekStart?.();
    onSeekChange(from.value);
  }

  function onMove(event: GestureResponderEvent) {
    const from = grab.current;
    if (from === null) return;
    from.value = valueAt(event, from);
    onSeekChange(from.value);
  }

  // A release and a terminate (the system took the touch) both end the drag at the last position, so a
  // parent's drag state always ends.
  function onEnd() {
    const from = grab.current;
    grab.current = null;
    if (from !== null) onSeekEnd(from.value);
  }

  function onAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "increment") onSeekEnd(clamp(value + step, 0, max));
    if (event.nativeEvent.actionName === "decrement") onSeekEnd(clamp(value - step, 0, max));
  }

  // The responder props sit on this 44-tall view, so a tap anywhere on the strip seeks. They are not a
  // PanResponder, which is created once and would hold stale callbacks. onResponderTerminationRequest is
  // false: the screen is a vertical ScrollView, and a drag must not turn into a scroll.
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: value, text: formatValueText(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      accessibilityState={{ disabled }}
      onAccessibilityAction={onAction}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onEnd}
      onResponderTerminate={onEnd}
      className="h-11 justify-center"
    >
      <View
        pointerEvents="none"
        className="overflow-hidden rounded-full"
        style={{ height: trackHeight, backgroundColor: colors.petal }}
      >
        <View style={{ height: "100%", width: `${ratio * 100}%`, backgroundColor: color }} />
      </View>
      <View
        pointerEvents="none"
        className="absolute rounded-full"
        style={[
          shadows.card,
          {
            left: ratio * width - THUMB / 2,
            width: THUMB,
            height: THUMB,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}
