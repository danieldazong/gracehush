import { ConversationProvider, useConversationControls, useConversationInput } from "@elevenlabs/react-native";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HelpLine } from "@/components/HelpLine";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SCHOLAR_TALK_WARNING_S, SUPPORT_EMAIL } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePulse } from "@/hooks/usePulse";
import type { RootStackScreenProps } from "@/navigation/types";
import {
  attachTalkControls,
  beginTalk,
  endTalk,
  getTalkState,
  resetTalk,
  setTalkMuted,
  subscribeTalk,
  talkEvent,
  type TalkState,
} from "@/services/scholarTalk";
import { installVoiceSession } from "@/services/voiceSession";
import { formatResetDay } from "@/utils/format";

const icons = {
  close: { android: "close", ios: "xmark" },
  mute: { android: "mic_off", ios: "mic.slash" },
  unmute: { android: "mic", ios: "mic.fill" },
  end: { android: "call_end", ios: "phone.down.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

const talk = copy.scholar.talk;
// The halo breathes on a 2-second cycle while Scholar listens, and a little quicker while it speaks.
const SPEAKING_HALF_CYCLE_MS = 650;

// Scholar's live talk (step 39): a full-screen page over the conversation it belongs to. ElevenLabs hears the person and speaks
// Scholar's answers; every answer is written and screened by our server, and saved as the conversation's messages, which the
// Conversation screen shows when this page closes. This page never draws a word of what was said (ElevenLabs' own text holds
// the server's invisible padding). Only this file imports the ElevenLabs package, and the navigator loads it only when the route
// opens, so Expo Go never loads it.
export function ScholarTalkScreen(props: RootStackScreenProps<"ScholarTalk">) {
  return (
    <ConversationProvider
      onConnect={() => talkEvent({ type: "connected" })}
      onDisconnect={() => talkEvent({ type: "disconnected" })}
      onModeChange={({ mode }) => talkEvent({ type: "mode", mode: mode === "speaking" ? "speaking" : "listening" })}
      onMessage={({ role }) => {
        if (role === "user") talkEvent({ type: "user_spoke" });
      }}
      onError={() => talkEvent({ type: "error" })}
    >
      <TalkBody {...props} />
    </ConversationProvider>
  );
}

function isActive(phase: TalkState["phase"]): boolean {
  return phase === "starting" || phase === "connecting" || phase === "live";
}

// What a talk that could not start says, and whether Try again can help.
function failureView(failure: NonNullable<TalkState["failure"]>): { text: string; retry: boolean } {
  const { notices } = copy.scholar;
  switch (failure.code) {
    case "LIMIT_REACHED":
      if (failure.usage?.kind === "talk_month" && failure.usage.resetsAt !== null) {
        return { text: talk.monthUsed(formatResetDay(failure.usage.resetsAt)), retry: false };
      }
      return { text: talk.failed.start, retry: false };
    case "RATE_LIMITED":
      return { text: talk.failed.today, retry: false };
    case "SCHOLAR_UNAVAILABLE":
      return { text: notices.resting, retry: false };
    case "SCHOLAR_ADULTS_ONLY":
      return { text: notices.adultsOnly(SUPPORT_EMAIL), retry: false };
    case "OFFLINE":
    case "NETWORK":
      return { text: notices.offline, retry: true };
    default:
      return { text: talk.failed.start, retry: true };
  }
}

function statusText(state: TalkState): string {
  if (state.phase === "ending") return talk.status.ending;
  if (state.phase !== "live") return talk.status.connecting;
  if (state.muted) return talk.status.muted;
  if (state.mode === "speaking") return talk.status.speaking;
  return state.mode === "thinking" ? talk.status.thinking : talk.status.listening;
}

function endedText(state: TalkState): string | null {
  if (state.phase !== "ended" && state.phase !== "ending") return null;
  if (state.endedBy === "cap") return talk.ended.cap;
  if (state.endedBy === "left_app") return talk.ended.leftApp;
  if (state.endedBy === "dropped") return talk.ended.dropped;
  return null;
}

function TalkBody({ navigation, route }: RootStackScreenProps<"ScholarTalk">) {
  const { conversationId, entryId } = route.params;
  const state = useSyncExternalStore(subscribeTalk, getTalkState);
  const { startSession, endSession } = useConversationControls();
  const { setMuted } = useConversationInput();
  // ElevenLabs' controls change identity between renders: the talk service reads the newest through this ref.
  const latest = useRef({ startSession, endSession, setMuted });
  useEffect(() => {
    latest.current = { startSession, endSession, setMuted };
  });

  useEffect(
    () =>
      attachTalkControls({
        start: (conversationToken, session) => {
          // The app's own voice session setup, installed right before each talk (both iPhone fixes).
          installVoiceSession();
          latest.current.startSession({ conversationToken, customLlmExtraBody: { session } });
        },
        end: () => latest.current.endSession(),
        setMuted: (muted) => latest.current.setMuted(muted),
      }),
    [],
  );

  useEffect(() => {
    void beginTalk({ conversationId, entryId: entryId ?? null });
  }, [conversationId, entryId]);

  // Leaving ends the talk: Close, End, the back key, and the Paywall that replaces a free account's page. When the page has gone,
  // an ended or failed talk goes back to idle.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        if (isActive(getTalkState().phase)) void endTalk("person");
      }),
    [navigation],
  );
  useEffect(() => () => resetTalk(), []);

  // A free account: the Paywall in this page's place.
  const failure = state.phase === "failed" ? state.failure : null;
  const needsPro = failure?.code === "LIMIT_REACHED" && failure.usage?.kind === "talk_plan";
  useEffect(() => {
    if (needsPro) navigation.replace("Paywall", { source: "scholar", reason: "talk" });
  }, [needsPro, navigation]);

  const live = state.phase === "live";
  const breathing = live && !state.muted && state.mode !== "thinking";
  const halo = usePulse(1.08, breathing, state.mode === "speaking" ? SPEAKING_HALF_CYCLE_MS : undefined);
  const status = statusText(state);
  const ended = endedText(state);
  const warning =
    live && !state.heavy && state.secondsLeft !== null && state.secondsLeft <= SCHOLAR_TALK_WARNING_S ? talk.warning : null;
  useAnnounce(ended ?? status);

  function leave() {
    if (isActive(getTalkState().phase)) void endTalk("person");
    navigation.goBack();
  }

  const header = (
    <View className="min-h-14 flex-row items-center gap-1 px-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={talk.close}
        onPress={leave}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="size-11 items-center justify-center">
          <Icon name={icons.close} size={22} color={colors.ink} />
        </View>
      </Pressable>
      <Text accessibilityRole="header" className="flex-1 text-section text-plum-deep">
        {talk.title}
      </Text>
    </View>
  );

  let body;
  if (failure !== null && !needsPro) {
    const view = failureView(failure);
    body = (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text accessibilityLiveRegion="polite" className="text-center text-section text-plum-deep">
          {view.text}
        </Text>
        <View className="w-full max-w-[320px] gap-2">
          {view.retry ? (
            <PrimaryButton
              label={talk.failed.retry}
              onPress={() => {
                resetTalk();
                void beginTalk({ conversationId, entryId: entryId ?? null });
              }}
            />
          ) : null}
          <PrimaryButton label={talk.failed.close} tone="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  } else if (ended !== null) {
    body = (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text accessibilityLiveRegion="polite" className="text-center text-section text-plum-deep">
          {ended}
        </Text>
        <View className="w-full max-w-[320px]">
          <PrimaryButton label={talk.ended.back} onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  } else {
    body = (
      <View className="flex-1">
        <View className="flex-1 items-center justify-center gap-5 px-6">
          <View className="items-center justify-center" style={styles.haloBox}>
            <Animated.View pointerEvents="none" style={[styles.halo, { transform: [{ scale: halo }] }]} />
            <View className="size-[120px] items-center justify-center rounded-full border border-petal bg-card" style={shadows.card}>
              {live || state.phase === "ending" ? (
                <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
              ) : (
                <ActivityIndicator size="small" color={colors.plum} />
              )}
            </View>
          </View>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={talk.a11y.status(status)}
            className="text-center text-section text-plum-deep"
          >
            {status}
          </Text>
          {warning !== null ? <Text className="text-center text-body-sm text-rosewood">{warning}</Text> : null}
        </View>
        {/* In a heavy conversation the help line for the person's situation and region stays on screen (decision 40). */}
        {state.heavy ? (
          <View className="px-6 pb-4">
            <HelpLine kind={state.help} />
          </View>
        ) : null}
        <View className="flex-row items-center justify-center gap-6 pb-6 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state.muted ? talk.unmute : talk.mute}
            accessibilityState={{ disabled: !live, selected: state.muted }}
            disabled={!live}
            onPress={() => setTalkMuted(!state.muted)}
            style={({ pressed }) => [!live && styles.disabled, pressed && styles.pressed]}
          >
            <View className="size-14 items-center justify-center rounded-full border border-petal bg-card">
              <Icon name={state.muted ? icons.unmute : icons.mute} size={24} color={colors.ink} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={talk.end}
            onPress={leave}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-16 items-center justify-center rounded-full bg-crisis">
              <Icon name={icons.end} size={28} color={colors.card} />
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      {header}
      <Text className="px-6 text-center text-body-sm text-mauve">{copy.scholar.aiLine}</Text>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  haloBox: { width: 168, height: 168 },
  halo: { position: "absolute", width: 168, height: 168, borderRadius: 84, backgroundColor: colors.plum, opacity: 0.12 },
  mark: { width: 56, height: 56 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
