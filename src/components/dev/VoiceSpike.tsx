import { ConversationProvider, useConversation } from "@elevenlabs/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { installVoiceSessionSetup } from "@/components/dev/voiceSessionSetup";
import { getSupabase } from "@/services/supabaseClient";

// Live voice (step 39), the TEST RUN: one ElevenLabs talk with Scholar's test endpoint (scholar-voice-llm, which answers
// with fixed test sentences), to measure the platform on the phone before step 39 is written. Development only.
// DevToolsPanel imports this file lazily, and only in a build that carries the WebRTC native modules: importing
// @elevenlabs/react-native registers WebRTC at once, which would crash Expo Go.
//
// The one exception to "Edge Functions only through src/api/journalApi.ts", like the process-entry check: this file goes
// when step 39 builds the real Talk screen.
//
// It records event kinds and times, never a word (a message is recorded by its length only). The recorder is a global,
// read through the dev server's inspector.

type SpikeEvent = { t: number; kind: string; detail?: string | number | boolean };
type SpikeRecorder = {
  events: SpikeEvent[];
  conversationTail: string | null;
  lastPingMs: number | null;
};

const recorder: SpikeRecorder = { events: [], conversationTail: null, lastPingMs: null };
(globalThis as { __voiceSpike?: SpikeRecorder }).__voiceSpike = recorder;

// Voice activity crosses this score when the person starts or stops speaking, which times the gap between the end of
// their words and Scholar's first sound.
const VAD_THRESHOLD = 0.5;
let vadHigh = false;

function record(kind: string, detail?: SpikeEvent["detail"]) {
  recorder.events.push({ t: Date.now(), kind, ...(detail === undefined ? {} : { detail }) });
  if (recorder.events.length > 600) recorder.events.shift();
}

const DELAYS = [0, 3_000, 6_000, 10_000];
const START_TIMEOUT_MS = 15_000;

type StartAnswer = { conversationToken?: unknown; session?: unknown };

function SpikeButton({
  label,
  onPress,
  selected,
  disabled,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <View className={["btn-ghost", selected ? "border-plum" : "", disabled ? "opacity-50" : ""].join(" ")}>
        <Text className="btn-ghost__label">{label}</Text>
      </View>
    </Pressable>
  );
}

function SpikeControls() {
  const conversation = useConversation();
  const [delayMs, setDelayMs] = useState(0);
  const [bufferWords, setBufferWords] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    const client = getSupabase();
    if (client === null) {
      setNote("Sign in first.");
      return;
    }
    setStarting(true);
    setNote(null);
    record("start_tap", delayMs);
    const { data, error } = await client.functions.invoke("scholar-voice-start", {
      body: {},
      timeout: START_TIMEOUT_MS,
    });
    const answer = (data ?? {}) as StartAnswer;
    if (error || typeof answer.conversationToken !== "string" || typeof answer.session !== "string") {
      const reason = error ? error.name : "bad_answer";
      record("start_failed", reason);
      setNote(`Start failed: ${reason}.`);
      setStarting(false);
      return;
    }
    record("token_received");
    // The corrected setup (voiceSessionSetup.ts): End closes the connection before it switches the audio off.
    installVoiceSessionSetup(record);
    conversation.startSession({
      conversationToken: answer.conversationToken,
      customLlmExtraBody: { session: answer.session, delayMs, bufferWords },
    });
    setStarting(false);
  }

  const status = conversation.status;
  const active = status === "connected" || status === "connecting";
  return (
    <View className="gap-2">
      <Text className="text-center text-body-sm text-ink">
        {`voice test: ${status}${active ? ` | ${conversation.mode}` : ""}${conversation.isMuted ? " | muted" : ""}`}
      </Text>
      <Text className="text-center text-body-sm text-mauve">Server delay before each answer</Text>
      <View className="flex-row flex-wrap justify-center gap-2">
        {DELAYS.map((value) => (
          <SpikeButton
            key={value}
            label={`${value / 1000} s`}
            selected={value === delayMs}
            disabled={active || starting}
            onPress={() => setDelayMs(value)}
          />
        ))}
        <SpikeButton
          label="Buffer words"
          selected={bufferWords}
          disabled={active || starting}
          onPress={() => setBufferWords(!bufferWords)}
        />
      </View>
      <View className="flex-row flex-wrap justify-center gap-2">
        <SpikeButton label="Start talk (dev)" disabled={active || starting} onPress={() => void start()} />
        <SpikeButton
          label={conversation.isMuted ? "Unmute (dev)" : "Mute (dev)"}
          disabled={status !== "connected"}
          onPress={() => {
            record("mute", !conversation.isMuted);
            conversation.setMuted(!conversation.isMuted);
          }}
        />
        <SpikeButton
          label="End talk (dev)"
          disabled={!active}
          onPress={() => {
            record("end_tap");
            conversation.endSession();
          }}
        />
      </View>
      {note !== null ? <Text className="text-center text-body-sm text-mauve">{note}</Text> : null}
    </View>
  );
}

export default function VoiceSpike() {
  return (
    <ConversationProvider
      onConnect={({ conversationId }) => {
        recorder.conversationTail = conversationId.slice(-6);
        record("connected");
      }}
      onDisconnect={(details) => record("disconnected", details.reason)}
      onStatusChange={({ status }) => record("status", status)}
      onModeChange={({ mode }) => record("mode", mode)}
      onInterruption={() => record("interruption")}
      onMessage={({ role, message }) => record(`message_${role}`, message.length)}
      onError={(message) => record("error", message.slice(0, 80))}
      onPing={({ ping_ms }) => {
        recorder.lastPingMs = typeof ping_ms === "number" ? ping_ms : null;
      }}
      onVadScore={({ vadScore }) => {
        const high = vadScore >= VAD_THRESHOLD;
        if (high !== vadHigh) {
          vadHigh = high;
          record(high ? "vad_on" : "vad_off");
        }
      }}
    >
      <SpikeControls />
    </ConversationProvider>
  );
}
