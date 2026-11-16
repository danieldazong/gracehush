import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useRawConversation,
} from "@elevenlabs/react-native";
import type { SymbolViewProps } from "expo-symbols";
import { type ReactNode, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HelpLine } from "@/components/HelpLine";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TalkCaptions } from "@/components/scholar/TalkCaptions";
import { type OrbState, type OrbTrack, VoiceOrb } from "@/components/scholar/VoiceOrb";
import { SCHOLAR_TALK_WARNING_S, SUPPORT_EMAIL } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import { useTalkCaptions } from "@/hooks/useAiPermission";
import { useAnnounce } from "@/hooks/useAnnounce";
import type { RootStackScreenProps } from "@/navigation/types";
import {
  attachTalkControls,
  beginTalk,
  endTalk,
  getTalkState,
  resetTalk,
  setTalkHeld,
  setTalkMuted,
  subscribeTalk,
  talkEvent,
  type TalkState,
} from "@/services/scholarTalk";
import {
  captionsInterrupt,
  captionsPersonWords,
  captionsScholarAlignment,
  resetCaptions,
} from "@/services/talkCaptions";
import { installVoiceSession } from "@/services/voiceSession";
import { formatResetDay } from "@/utils/format";

const icons = {
  hold: { android: "pause", ios: "pause.fill" },
  resume: { android: "play_arrow", ios: "play.fill" },
  muted: { android: "mic_off", ios: "mic.slash" },
  live: { android: "mic", ios: "mic.fill" },
  end: { android: "close", ios: "xmark" },
  captionsOn: { android: "closed_caption", ios: "captions.bubble.fill" },
  captionsOff: { android: "closed_caption_disabled", ios: "captions.bubble" },
} satisfies Record<string, SymbolViewProps["name"]>;

const talk = copy.scholar.talk;
// The orb's size: most of the width on a phone, never more than this, and smaller while a help line shares the page.
const ORB_MAX = 200;
const ORB_HEAVY_MAX = 176;

// Scholar's live talk (step 39): a full-screen page over the conversation it belongs to. ElevenLabs hears the person and speaks
// Scholar's answers; every answer is written and screened by our server, and saved as the conversation's messages, which the
// Conversation screen shows when this page closes. Only this file imports the ElevenLabs package, and the navigator loads it
// only when the route opens, so Expo Go never loads it.
//
// The page is Scholar's name, a voice orb that follows the sound, a line for what the person cannot see elsewhere (connecting,
// muted, on hold, ending), the talk's captions, and three controls (2026-11-15): Hold (Scholar stops and waits until the person
// says go on), the microphone (mute and unmute) and End.
//
// The captions (2026-11-16) are the words ElevenLabs hands the phone: the person's sentence once it has heard it, and the timing
// of each character Scholar says (the audio's alignment), which the talk service sets in time with the voice. Our server's
// invisible holding pad is taken out there. They are drawn, never kept, and the saved messages stay the talk's record. ElevenLabs'
// own text of Scholar's message is still never read: it holds that pad.
export function ScholarTalkScreen(props: RootStackScreenProps<"ScholarTalk">) {
  return (
    <ConversationProvider
      onConnect={() => talkEvent({ type: "connected" })}
      onDisconnect={() => talkEvent({ type: "disconnected" })}
      onModeChange={({ mode }) => talkEvent({ type: "mode", mode: mode === "speaking" ? "speaking" : "listening" })}
      onMessage={({ role, message }) => {
        if (role !== "user") return;
        talkEvent({ type: "user_spoke" });
        captionsPersonWords(message, true);
      }}
      onIncomingEvent={(event: unknown) => {
        const words = tentativeWords(event);
        if (words !== null) captionsPersonWords(words, false);
      }}
      onAudioAlignment={(alignment) => captionsScholarAlignment(alignment)}
      onInterruption={() => captionsInterrupt()}
      onError={() => talkEvent({ type: "error" })}
    >
      <TalkBody {...props} />
    </ConversationProvider>
  );
}

// The person's words while they are still speaking, if ElevenLabs ever sends them (the agents ask for the event; it has not
// arrived on the phone or a PC yet, 2026-11-16).
function tentativeWords(event: unknown): string | null {
  const value = event as { type?: unknown; tentative_user_transcription_event?: { user_transcript?: unknown } } | null;
  if (value?.type !== "tentative_user_transcript") return null;
  const words = value.tentative_user_transcription_event?.user_transcript;
  return typeof words === "string" ? words : null;
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

// What a screen reader hears of the talk's state. The screen shows only labelText.
function statusText(state: TalkState): string {
  if (state.phase === "ending") return talk.status.ending;
  if (state.phase !== "live") return talk.status.connecting;
  if (state.held) return talk.status.held;
  if (state.muted) return talk.status.muted;
  if (state.mode === "speaking") return talk.status.speaking;
  return state.mode === "thinking" ? talk.status.thinking : talk.status.listening;
}

// The one line under the orb (2026-11-16): only what the person cannot see elsewhere. Listening, thinking and speaking are the
// orb's and the captions' to show, and a screen reader still hears them (statusText).
function labelText(state: TalkState): string | null {
  if (state.phase === "ending") return talk.status.ending;
  if (state.phase !== "live") return talk.status.connecting;
  if (state.held) return talk.status.held;
  if (state.muted) return talk.status.muted;
  return null;
}

function endedText(state: TalkState): string | null {
  if (state.phase !== "ended" && state.phase !== "ending") return null;
  if (state.endedBy === "cap") return talk.ended.cap;
  if (state.endedBy === "left_app") return talk.ended.leftApp;
  if (state.endedBy === "dropped") return talk.ended.dropped;
  return null;
}

// What the orb does for the talk's state: it connects, listens, thinks, speaks, sleeps (muted, on hold) or is over.
function orbState(state: TalkState): OrbState {
  if (state.phase === "ending" || state.phase === "ended" || state.phase === "failed") return "ended";
  if (state.phase !== "live") return "connecting";
  if (state.held) return "held";
  if (state.muted) return "muted";
  return state.mode;
}

// The two audio tracks of the talk, which the orb reads the sound of straight from LiveKit's native volume processor: Scholar's
// (the room's remote participant) and the person's microphone. This only finds out which tracks exist, from the LiveKit room
// behind ElevenLabs' conversation, and hands over their ids. A talk the room cannot be reached for has none, and the orb then
// only moves with its state.
type RoomTrack = { mediaStreamTrack?: { id: string; _peerConnectionId?: number } };
type RoomParticipant = { audioTrackPublications: Map<string, { track?: RoomTrack }> };
type TalkRoom = {
  localParticipant?: RoomParticipant;
  remoteParticipants: Map<string, RoomParticipant>;
  on: (event: string, listener: () => void) => unknown;
  off: (event: string, listener: () => void) => unknown;
};
type TalkTracks = { agent: OrbTrack | null; mic: OrbTrack | null };
type TrackStore = { subscribe: (listener: () => void) => () => void; read: () => TalkTracks };

// A track appears or goes: Scholar's is subscribed to, the microphone is published.
const ROOM_EVENTS = ["trackSubscribed", "trackUnsubscribed", "localTrackPublished", "localTrackUnpublished"] as const;
const NO_TRACKS: TalkTracks = { agent: null, mic: null };
const NO_STORE: TrackStore = { subscribe: () => () => undefined, read: () => NO_TRACKS };

// ElevenLabs' conversation holds its connection from the moment it exists, and the connection hands out its room.
function roomOf(conversation: unknown): TalkRoom | null {
  const connection = (conversation as { connection?: { getRoom?: () => TalkRoom } } | null)?.connection;
  return connection?.getRoom?.() ?? null;
}

function describeTrack(track: RoomTrack | undefined): OrbTrack | null {
  const media = track?.mediaStreamTrack;
  return media === undefined ? null : { peerConnectionId: media._peerConnectionId ?? -1, trackId: media.id };
}

function firstAudioTrack(participants: Iterable<RoomParticipant>): OrbTrack | null {
  for (const participant of participants) {
    for (const publication of participant.audioTrackPublications.values()) {
      const found = describeTrack(publication.track);
      if (found !== null) return found;
    }
  }
  return null;
}

function sameTrack(a: OrbTrack | null, b: OrbTrack | null): boolean {
  return a === b || (a !== null && b !== null && a.peerConnectionId === b.peerConnectionId && a.trackId === b.trackId);
}

function createTrackStore(room: TalkRoom): TrackStore {
  const listeners = new Set<() => void>();
  const read = (): TalkTracks => ({
    agent: firstAudioTrack(room.remoteParticipants.values()),
    mic: room.localParticipant === undefined ? null : firstAudioTrack([room.localParticipant]),
  });
  let snapshot = read();
  const update = () => {
    const next = read();
    if (sameTrack(next.agent, snapshot.agent) && sameTrack(next.mic, snapshot.mic)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener) => {
      if (listeners.size === 0) ROOM_EVENTS.forEach((event) => room.on(event, update));
      listeners.add(listener);
      // Anything that changed between the render and this subscription.
      update();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) ROOM_EVENTS.forEach((event) => room.off(event, update));
      };
    },
    read: () => snapshot,
  };
}

type ControlProps = {
  label: string;
  icon: SymbolViewProps["name"];
  onPress: () => void;
  // The microphone is the main control: the one circle, plum while it is on.
  large?: boolean;
  filled?: boolean;
  selected?: boolean;
  disabled?: boolean;
};

// The microphone is a 72 circle, plum with a white icon while it is on and white with a petal rim otherwise. Hold and End are
// bare plum icons in a 56 touch area beside it, with no circle (the owner's reference, 2026-11-15).
function ControlButton({ label, icon, onPress, large = false, filled = false, selected = false, disabled = false }: ControlProps) {
  const box = large ? `size-[72px] rounded-full ${filled ? "bg-plum" : "border border-petal bg-card"}` : "size-14";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View className={`${box} items-center justify-center`} style={filled ? shadows.orb : undefined}>
        <Icon name={icon} size={large ? 30 : 26} color={filled ? colors.card : colors.plum} />
      </View>
    </Pressable>
  );
}

function TalkBody({ navigation, route }: RootStackScreenProps<"ScholarTalk">) {
  const { conversationId, entryId } = route.params;
  const state = useSyncExternalStore(subscribeTalk, getTalkState);
  const { width } = useWindowDimensions();
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { setMuted } = useConversationInput();
  // ElevenLabs' controls change identity between renders: the talk service reads the newest through this ref.
  const latest = useRef({ startSession, endSession, sendUserMessage, setMuted });
  useEffect(() => {
    latest.current = { startSession, endSession, sendUserMessage, setMuted };
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
        // Hold and Resume are typed turns: the server reads them like spoken ones.
        sendText: (text) => latest.current.sendUserMessage(text),
      }),
    [],
  );

  useEffect(() => {
    void beginTalk({ conversationId, entryId: entryId ?? null });
  }, [conversationId, entryId]);

  // Leaving ends the talk: End, the back key, and the Paywall that replaces a free account's page. When the page has gone, an
  // ended or failed talk goes back to idle.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        if (isActive(getTalkState().phase)) void endTalk("person");
      }),
    [navigation],
  );
  useEffect(() => () => resetTalk(), []);
  // The captions belong to one live talk: they go when it stops being live and when the page goes.
  const live = state.phase === "live";
  useEffect(() => {
    if (!live) resetCaptions();
  }, [live]);
  useEffect(() => () => resetCaptions(), []);
  const captions = useTalkCaptions();

  // A free account: the Paywall in this page's place.
  const failure = state.phase === "failed" ? state.failure : null;
  const needsPro = failure?.code === "LIMIT_REACHED" && failure.usage?.kind === "talk_plan";
  useEffect(() => {
    if (needsPro) navigation.replace("Paywall", { source: "scholar", reason: "talk" });
  }, [needsPro, navigation]);

  // The orb's two audio tracks, from the LiveKit room behind the conversation.
  const conversation = useRawConversation();
  const trackStore = useMemo(() => {
    const room = roomOf(conversation);
    return room === null ? NO_STORE : createTrackStore(room);
  }, [conversation]);
  const tracks = useSyncExternalStore(trackStore.subscribe, trackStore.read);

  const status = statusText(state);
  const label = labelText(state);
  const ended = endedText(state);
  const warning =
    live && !state.heavy && state.secondsLeft !== null && state.secondsLeft <= SCHOLAR_TALK_WARNING_S ? talk.warning : null;
  const voiceName = state.voice === null ? null : copy.scholarVoice.voices[state.voice].name;
  const orbSize = Math.min(state.heavy ? ORB_HEAVY_MAX : ORB_MAX, Math.round(width * 0.56));
  const showControls = failure === null && ended === null;
  useAnnounce(ended ?? status);

  function leave() {
    if (isActive(getTalkState().phase)) void endTalk("person");
    navigation.goBack();
  }

  // Under the orb: what is happening, or why there is no talk, and what the person can do about it.
  let message: ReactNode;
  let actions: ReactNode = null;
  if (failure !== null && !needsPro) {
    const view = failureView(failure);
    message = (
      <Text accessibilityLiveRegion="polite" className="text-center text-section text-plum-deep">
        {view.text}
      </Text>
    );
    actions = (
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
    );
  } else if (ended !== null) {
    message = (
      <Text accessibilityLiveRegion="polite" className="text-center text-section text-plum-deep">
        {ended}
      </Text>
    );
    actions = (
      <View className="w-full max-w-[320px]">
        <PrimaryButton label={talk.ended.back} onPress={() => navigation.goBack()} />
      </View>
    );
  } else {
    message = (
      <>
        <View className="min-h-5 items-center justify-center">
          {label !== null ? (
            <Text accessibilityLabel={talk.a11y.status(label)} className="text-center text-body-sm text-mauve">
              {label}
            </Text>
          ) : null}
          {warning !== null ? <Text className="text-center text-body-sm text-rosewood">{warning}</Text> : null}
        </View>
        {/* Android hears every status from a live region of its own; iOS from useAnnounce. */}
        {Platform.OS === "android" ? (
          <Text accessibilityLiveRegion="polite" style={styles.spoken}>
            {talk.a11y.status(status)}
          </Text>
        ) : null}
        {captions.on ? <TalkCaptions heavy={state.heavy} /> : null}
      </>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View className="items-center gap-0.5 px-14 pt-3">
        <Text accessibilityRole="header" className="text-section text-plum-deep">
          {talk.title}
        </Text>
        <View className="min-h-5 justify-center">
          {voiceName !== null ? <Text className="text-body-sm text-mauve">{talk.voice(voiceName)}</Text> : null}
        </View>
        {showControls ? (
          <View style={styles.captionsSwitch}>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={talk.captions}
              accessibilityHint={talk.captionsHint}
              accessibilityState={{ checked: captions.on }}
              hitSlop={4}
              onPress={() => captions.setOn(!captions.on)}
              style={({ pressed }) => [styles.captionsButton, pressed && styles.pressed]}
            >
              <Icon
                name={captions.on ? icons.captionsOn : icons.captionsOff}
                size={24}
                color={captions.on ? colors.plum : colors.mauve}
              />
            </Pressable>
          </View>
        ) : null}
      </View>
      <ScrollView
        style={styles.middle}
        contentContainerStyle={styles.middleContent}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
      >
        <VoiceOrb size={orbSize} state={orbState(state)} agentTrack={tracks.agent} micTrack={tracks.mic} />
        {message}
        {/* In a heavy conversation the help line for the person's situation and region stays on screen (decision 40). */}
        {state.heavy ? <HelpLine kind={state.help} /> : null}
        {actions}
      </ScrollView>
      <View className="px-6 pb-1">
        <Text className="text-center font-dm text-[11px] leading-[16px] text-mauve">{copy.scholar.aiLine}</Text>
      </View>
      {showControls ? (
        <View className="flex-row items-center justify-center gap-12 pb-5 pt-3">
          <ControlButton
            label={state.held ? talk.resume : talk.hold}
            icon={state.held ? icons.resume : icons.hold}
            selected={state.held}
            disabled={!live}
            onPress={() => setTalkHeld(!state.held)}
          />
          <ControlButton
            large
            filled={live && !state.muted}
            label={state.muted ? talk.unmute : talk.mute}
            icon={live && !state.muted ? icons.live : icons.muted}
            selected={state.muted}
            disabled={!live || state.held}
            onPress={() => setTalkMuted(!state.muted)}
          />
          <ControlButton label={talk.end} icon={icons.end} onPress={leave} />
        </View>
      ) : (
        <View className="pb-5" />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  middle: { flex: 1 },
  // The orb, its line, the captions and the help line are centred in the space between the name and the controls; they
  // scroll only when large text leaves too little room.
  middleContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 16 },
  // The captions switch sits at the header's right, level with the title and the voice's name.
  captionsSwitch: { position: "absolute", top: 0, bottom: 0, right: 8, justifyContent: "center" },
  captionsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // A status a screen reader hears on Android: a live region the eye cannot see.
  spoken: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
