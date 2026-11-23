import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type TextInputInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BottomSheet } from "@/components/BottomSheet";
import { HelpLine } from "@/components/HelpLine";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ShareSheet } from "@/components/ShareSheet";
import { Skeleton } from "@/components/Skeleton";
import { ConversationNotice } from "@/components/scholar/ConversationNotice";
import { ScholarAnswer, type ListenView } from "@/components/scholar/ScholarAnswer";
import { SuggestionChips } from "@/components/scholar/SuggestionChips";
import { TalkSheet, type TalkSheetStep } from "@/components/scholar/TalkSheet";
import { TypingIndicator } from "@/components/scholar/TypingIndicator";
import { UserMessage } from "@/components/scholar/UserMessage";
import { VoiceAvatar } from "@/components/scholar/VoiceAvatar";
import { VoicePermissionStep } from "@/components/scholar/VoicePermissionStep";
import { VoiceRows } from "@/components/scholar/VoiceRows";
import { MODAL_HANDOFF_FALLBACK_MS, PRIVACY_POLICY_URL, SCHOLAR_TALK_LOW_S, SUPPORT_EMAIL } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";
import { useAiPermission, useAiWordingNote, useScholarVoice, useVoicePermission } from "@/hooks/useAiPermission";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useConversation, type ConversationNotice as NoticeKind } from "@/hooks/useConversation";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useShareSheet } from "@/hooks/useShareSheet";
import type { RootStackScreenProps } from "@/navigation/types";
import { openLegalPage } from "@/services/externalLinks";
import { getMicPermission, requestMicPermission } from "@/services/recorder";
import {
  clearScholarAudio,
  getScholarListenState,
  playScholarAnswer,
  stopScholarAudio,
  subscribeScholarListen,
  type ScholarListenState,
} from "@/services/scholarPlayer";
import { getTalkState, resetTalk, subscribeTalk } from "@/services/scholarTalk";
import { voiceSupported } from "@/services/voiceSupport";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type { ScholarMessage } from "@/types";
import { formatResetDay } from "@/utils/format";
import { answerShareText, type ConversationRow } from "@/utils/scholarRows";

import { AiPermissionSheet } from "../journal/AiPermissionSheet";
import { ConversationComposer } from "./ConversationComposer";

const icons = {
  back: { android: "chevron_left", ios: "chevron.left" },
  more: { android: "more_horiz", ios: "ellipsis" },
  help: { android: "favorite", ios: "heart" },
  delete: { android: "delete", ios: "trash" },
  info: { android: "info", ios: "info.circle" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The field comes up once the screen has settled (as New Entry's).
const FOCUS_DELAY_MS = 300;

// The space between two rows of the conversation.
function RowGap() {
  return <View style={styles.gap} />;
}

// `opensDay` is the day a trial's plan begins ("Friday, Nov 21"), or null when it is not known.
function noticeText(kind: NoticeKind, opensDay: string | null): string {
  const { notices, speak } = copy.scholar;
  switch (kind) {
    case "offline":
      return notices.offline;
    case "plan":
      return notices.plan;
    case "opens":
      return notices.opens(opensDay);
    case "opensSaved":
      return notices.opensSaved(opensDay);
    case "rateLimited":
      return notices.rateLimited;
    case "resting":
      return notices.resting;
    case "adultsOnly":
      return notices.adultsOnly(SUPPORT_EMAIL);
    case "noWords":
      return speak.noWords;
    case "uploadFailed":
      return speak.uploadFailed;
    case "tooShort":
      return speak.tooShort;
  }
}

function listenView(state: ScholarListenState, messageId: string): ListenView {
  if (state.phase === "idle" || state.messageId !== messageId) return { phase: "idle" };
  if (state.phase === "failed") {
    // A refusal by the plan or the credits (2026-11-18) is said above the composer, not under the answer.
    if (state.usage !== null) return { phase: "idle" };
    return { phase: "failed", line: copy.scholar.listen.failed };
  }
  return { phase: state.phase };
}

// The answer's words and passages, never the person's own message (2026-11-15). They go through GraceHush's share panel
// (2026-11-16): WhatsApp and Messages open the app itself, so the person lands in the chat they pick; More is the iPhone's
// share menu. Null when the answer has nothing to share.
function answerShareMessage(message: ScholarMessage): string | null {
  const body = answerShareText(message);
  return body === null ? null : copy.scholar.share.message(body);
}

// A conversation with Scholar (step 38): the header, the messages and their answers, and the composer pinned above the keyboard.
// Until the account has allowed Google's AI, the permission sheet covers it and nothing is sent. Leaving stops Scholar's voice
// and deletes the parts read aloud.
export function ConversationScreen({ navigation, route }: RootStackScreenProps<"Conversation">) {
  const params = route.params;
  const chat = useConversation(params);
  const { allowed, setAllowed } = useAiPermission();
  const { show: showWordingNote, seen: wordingSeen } = useAiWordingNote();
  const listen = useSyncExternalStore(subscribeScholarListen, getScholarListenState);
  const { tier, known, trialEndsAt } = useEntitlement();
  const online = useOfflineStore(selectIsOnline);
  const shareSheet = useShareSheet();
  // The screen's side padding: 20, or 16 on a narrow screen (the rule .screen__content applies to views).
  const { width } = useWindowDimensions();
  const side = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<ConversationRow>>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  // The menu's choice waits for the sheet to close before its dialog opens (iOS presents one Modal at a time).
  const afterMenu = useRef<(() => void) | null>(null);
  // The live talk (step 39): its one-time sheet, the microphone line, and the talk that last ended.
  const { allowed: voiceAllowed, setAllowed: setVoiceAllowed } = useVoicePermission();
  const { voice, setVoice, locked: voicesLocked } = useScholarVoice();
  // The voice sheet (2026-11-19): the chosen voice's portrait in the header opens it, to change Scholar's voice from the chat. The
  // chosen voice reads answers aloud through ElevenLabs, so an account that has not allowed ElevenLabs is asked first.
  const [voicesStep, setVoicesStep] = useState<"permission" | "voices" | null>(null);
  const [talkSheet, setTalkSheet] = useState<TalkSheetStep | null>(null);
  const [micOff, setMicOff] = useState(false);
  const afterTalkSheet = useRef<(() => void) | null>(null);
  // A Pro voice tapped in the voice sheet (2026-11-20): the plans open once the sheet has closed.
  const afterVoices = useRef<(() => void) | null>(null);
  const talk = useSyncExternalStore(subscribeTalk, getTalkState);
  const seenTalk = useRef(getTalkState().last?.seq ?? null);

  // Leaving stops Scholar's voice and deletes the parts it read (they stay only for this visit).
  useEffect(() => () => clearScholarAudio(), []);

  // Seeing the one-time note records the permission's current words, so it never shows again.
  useEffect(() => {
    if (showWordingNote) wordingSeen();
  }, [showWordingNote, wordingSeen]);

  // From the ask bar's "Ask Scholar…": the keyboard comes up once the permission is answered.
  useEffect(() => {
    if (params.compose !== "type" || !allowed || chat.phase !== "ready") return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [params.compose, allowed, chat.phase]);

  // From the Scholar tab's hero button (`compose: "talk"`): the talk's own order starts once, as soon as the permission is
  // answered and the conversation is ready, as if the Talk button had been pressed here. Once only, so coming back from the
  // Talk screen leaves the conversation as it is. It waits out the screen's own slide first (as the keyboard does), runs after
  // every render on purpose (it reads the latest state through `openTalk`, and the ref stops it after the first start) and its
  // timer ends with the screen, so leaving within that moment starts nothing.
  const talkOnOpen = useRef(params.compose === "talk");
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (talkTimer.current !== null) clearTimeout(talkTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!talkOnOpen.current || !allowed || chat.phase !== "ready") return;
    talkOnOpen.current = false;
    talkTimer.current = setTimeout(openTalk, FOCUS_DELAY_MS);
  });

  // A free account's message after its free conversation (2026-11-20): the message is kept, and the plans open by themselves,
  // once for each refusal.
  const { paywallAsk } = chat;
  useEffect(() => {
    if (paywallAsk > 0) navigation.navigate("Paywall", { source: "scholar", reason: "conversation" });
  }, [paywallAsk, navigation]);

  // The newest message stays in view when the keyboard opens.
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => listRef.current?.scrollToEnd({ animated: true }));
    return () => subscription.remove();
  }, []);

  // When a talk from this conversation ends, its turns are read from the server (they are its messages).
  const lastTalk = talk.last;
  const { refreshAfterTalk } = chat;
  useEffect(() => {
    if (lastTalk === null || lastTalk.seq === seenTalk.current) return;
    if (lastTalk.requestedId !== chat.conversationId && lastTalk.conversationId !== chat.conversationId) return;
    seenTalk.current = lastTalk.seq;
    void refreshAfterTalk(lastTalk.conversationId);
  }, [lastTalk, chat.conversationId, refreshAfterTalk]);

  // "Scholar is writing" while a turn is in flight, then "Scholar answered": the two alternate, so each answer is heard.
  const announcement = chat.sending ? copy.scholar.a11y.writing : chat.fresh.length > 0 ? copy.scholar.a11y.answered : null;
  useAnnounce(announcement);

  function allow() {
    setAllowed(true);
    chat.sendStarter();
  }

  function shareAnswer(message: ScholarMessage) {
    const text = answerShareMessage(message);
    if (text !== null) shareSheet.share(text);
  }

  // Scholar is part of Pro (2026-11-18), with one free conversation for every account (2026-11-20): Listen works on its answers,
  // and a talk may start in it, or in a new conversation while none is claimed yet. Elsewhere an account RevenueCat reports as free
  // sees the plans, and a trial is told, above the composer, the day its plan begins and Scholar opens. Until RevenueCat and the
  // free conversation's read have answered, the server decides.
  function outsidePlan(reason: "listen" | "talk"): boolean {
    if (!known || tier === "pro" || !chat.freeKnown) return false;
    if (reason === "listen" ? chat.freeHere : chat.freeOpen) return false;
    if (tier === "trial") chat.noteOpens(trialEndsAt);
    else navigation.navigate("Paywall", { source: "scholar", reason });
    return true;
  }

  async function onListen(message: ScholarMessage) {
    // In a heavy conversation the tap plays for everyone, and is never counted.
    if (!chat.heavy && outsidePlan("listen")) return;
    await playScholarAnswer(message.id);
    const after = getScholarListenState();
    if (after.phase !== "failed" || after.messageId !== message.id || after.usage === null) return;
    if (after.usage.kind === "listen_plan") {
      stopScholarAudio();
      if (after.usage.resetsAt !== null) chat.noteOpens(after.usage.resetsAt);
      else navigation.navigate("Paywall", { source: "scholar", reason: "listen" });
    } else if (after.usage.kind === "credits") {
      // No credit left: the notice above the composer says when they renew.
      chat.noteUsage(after.usage);
    }
  }

  // Talk, in the plan's order: an account Scholar is not part of is told so (above); no voice permission yet, the one-time sheet;
  // then the microphone, asked with the recorder's own functions; then the Talk screen.
  function openTalk() {
    if (outsidePlan("talk")) return;
    if (!voiceAllowed) {
      setTalkSheet("permission");
      return;
    }
    void startTalking();
  }

  async function startTalking() {
    let mic = await getMicPermission();
    if (mic === "undetermined") mic = await requestMicPermission();
    if (mic !== "granted") {
      setMicOff(true);
      return;
    }
    setMicOff(false);
    resetTalk();
    const entryId = chat.entry?.id ?? params.entryId;
    navigation.navigate("ScholarTalk", {
      conversationId: chat.conversationId,
      ...(entryId === undefined ? {} : { entryId }),
    });
  }

  // The voice sheet's previews would play over Scholar reading an answer aloud, so that stops first.
  function openVoices() {
    stopScholarAudio();
    setVoicesStep(voiceAllowed ? "voices" : "permission");
  }

  function runAfterVoices() {
    const run = afterVoices.current;
    afterVoices.current = null;
    run?.();
  }

  // A Pro voice tapped by an account that is not subscribed (2026-11-20): the sheet closes first (iOS presents one Modal at a time),
  // then the plans open.
  function voiceLocked() {
    setVoicesStep(null);
    afterVoices.current = () => navigation.navigate("Paywall", { source: "scholar", reason: "voice" });
    if (Platform.OS === "ios") setTimeout(runAfterVoices, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterVoices();
  }

  // The same from the Talk sheet's voices.
  function talkVoiceLocked() {
    setTalkSheet(null);
    afterTalkSheet.current = () => navigation.navigate("Paywall", { source: "scholar", reason: "voice" });
    if (Platform.OS === "ios") setTimeout(runAfterTalkSheet, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterTalkSheet();
  }

  function runAfterTalkSheet() {
    const run = afterTalkSheet.current;
    afterTalkSheet.current = null;
    run?.();
  }

  // "Start talking" closes the sheet first (iOS presents one Modal at a time), then the microphone and the Talk screen follow.
  function startFromSheet() {
    setTalkSheet(null);
    afterTalkSheet.current = () => void startTalking();
    if (Platform.OS === "ios") setTimeout(runAfterTalkSheet, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterTalkSheet();
  }

  function openDelete() {
    setDeleteFailed(null);
    setConfirmDelete(true);
  }

  function runAfterMenu() {
    const run = afterMenu.current;
    afterMenu.current = null;
    run?.();
  }

  function pickDelete() {
    setMenuOpen(false);
    afterMenu.current = openDelete;
    if (Platform.OS === "ios") setTimeout(runAfterMenu, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterMenu();
  }

  async function confirmRemove() {
    if (deleting) return;
    if (online === false) {
      setDeleteFailed(copy.scholar.delete.offline);
      return;
    }
    setDeleting(true);
    setDeleteFailed(null);
    const ok = await chat.remove();
    setDeleting(false);
    if (ok) {
      setConfirmDelete(false);
      navigation.goBack();
    } else {
      setDeleteFailed(copy.scholar.delete.failed);
    }
  }

  // One notice at a time: what the last turn said, else no connection.
  const noticeKind: NoticeKind | null = chat.notice ?? (online === false ? "offline" : null);
  // Talk shows in a build that can hold one, and in a heavy conversation only for Pro (no paywall and no plan notice there).
  const canTalk = voiceSupported() && !(chat.heavy && known && tier !== "pro");
  // The voice's portrait shows where a talk can run, once the conversation has loaded, and never in a heavy conversation, whose
  // header keeps Get help beside the menu and nothing else (Profile still changes the voice there).
  const showVoice = voiceSupported() && chat.phase === "ready" && !chat.heavy;
  const opensDay = chat.opensAt === null ? null : formatResetDay(chat.opensAt);
  const { credits } = copy.scholar;
  // After a talk from this conversation, when little of the month is left (the server's numbers).
  const talkLeft =
    lastTalk !== null &&
    (lastTalk.requestedId === chat.conversationId || lastTalk.conversationId === chat.conversationId) &&
    lastTalk.limits !== null &&
    lastTalk.limits.monthSecondsLeft !== null &&
    lastTalk.limits.monthSecondsLeft > 0 &&
    lastTalk.limits.monthSecondsLeft <= SCHOLAR_TALK_LOW_S
      ? Math.max(1, Math.round(lastTalk.limits.monthSecondsLeft / 60))
      : null;
  const chipsNew = chat.entry !== null || params.entryId !== undefined ? copy.scholar.chips.reflection : Object.values(copy.scholar.starters);

  function renderRow({ item }: { item: ConversationRow }) {
    if (item.kind === "reminder") {
      return (
        <View className="flex-row items-start justify-center gap-1.5 px-2">
          <Icon name={icons.info} size={14} color={colors.mauve} />
          <Text className="shrink text-center text-body-sm text-mauve">{copy.scholar.aiLine}</Text>
        </View>
      );
    }
    if (item.kind === "user") {
      return (
        <UserMessage
          message={item.message}
          failure={item.failure}
          retryDisabled={chat.sending}
          animate={chat.sentIds.includes(item.message.id)}
          onRetry={() => chat.retry(item.message.id)}
        />
      );
    }
    if (item.kind === "waiting") return <TypingIndicator />;
    return (
      <View className="gap-3">
        <ScholarAnswer
          message={item.message}
          animate={chat.fresh.includes(item.message.id)}
          listen={listenView(listen, item.message.id)}
          onListen={() => void onListen(item.message)}
          onStopListening={stopScholarAudio}
          onShare={chat.heavy || item.message.helpLine !== null ? null : () => shareAnswer(item.message)}
          onDelete={item.message.helpLine === "abuse" ? openDelete : null}
        />
        {item.newest && !chat.heavy && !chat.sending ? (
          <SuggestionChips
            // Under a welcome, the situations GraceHush is for (scholar-v3); under any other answer, the ways to go further.
            chips={item.message.welcome ? copy.scholar.chips.topics : copy.scholar.chips.after}
            onPick={(text) => chat.send(text)}
            disabled={chat.sending}
          />
        ) : null}
      </View>
    );
  }

  // The conversation's title under "Scholar" once it has one (a heavy conversation has none).
  const title = chat.conversation?.title?.trim() ?? "";
  const conversationTitle = title.length > 0 ? title : null;

  const header = (
    <View>
      <View className="min-h-14 flex-row items-center gap-1 px-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.a11y.back}
          onPress={() => navigation.goBack()}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={icons.back} size={22} color={colors.ink} />
          </View>
        </Pressable>
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-section text-plum-deep">
            {copy.scholar.header}
          </Text>
          {conversationTitle !== null ? (
            <Text numberOfLines={1} className="text-body-sm text-mauve">
              {conversationTitle}
            </Text>
          ) : null}
        </View>
        {showVoice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholarVoice.a11y.change(copy.scholarVoice.voices[voice].name)}
            accessibilityHint={copy.scholarVoice.a11y.changeHint}
            onPress={openVoices}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-11 items-center justify-center">
              <VoiceAvatar voice={voice} size={32} />
            </View>
          </Pressable>
        ) : null}
        {/* The readers: in a heavy conversation help stays within reach for the rest of it. */}
        {chat.heavy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.help.button}
            accessibilityHint={copy.scholar.help.hint}
            onPress={() => setHelpOpen(true)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 flex-row items-center gap-1 rounded-full px-3">
              <Icon name={icons.help} size={16} color={colors.plum} />
              <Text className="text-label-md text-plum">{copy.scholar.help.button}</Text>
            </View>
          </Pressable>
        ) : null}
        {chat.conversation !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.a11y.options}
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-11 items-center justify-center">
              <Icon name={icons.more} size={22} color={colors.ink} />
            </View>
          </Pressable>
        ) : null}
      </View>
      <View className="divider" />
    </View>
  );

  let body;
  if (chat.phase === "loading") {
    body = (
      <View accessibilityLabel={copy.scholar.waiting} accessibilityState={{ busy: true }} className="gap-4 px-5 pt-6">
        <Skeleton height={16} width={220} radius={8} />
        <Skeleton height={120} />
        <View className="items-end">
          <Skeleton height={44} width={200} />
        </View>
        <Skeleton height={140} />
      </View>
    );
  } else if (chat.phase === "error" || chat.phase === "missing") {
    const missing = chat.phase === "missing";
    body = (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <Text accessibilityRole="header" className="text-center text-section text-plum-deep">
          {missing ? copy.scholar.errors.missing : copy.scholar.errors.conversation}
        </Text>
        <View className="w-full max-w-[320px] gap-2">
          {missing ? null : <PrimaryButton label={copy.scholar.errors.retry} onPress={chat.reload} />}
          <PrimaryButton label={copy.scholar.errors.back} tone="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  } else {
    const empty = chat.messages.length === 0;
    body = (
      <>
        <FlatList
          ref={listRef}
          data={chat.rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.list, { paddingHorizontal: side }]}
          ItemSeparatorComponent={RowGap}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            !showWordingNote && chat.entry === null ? undefined : (
            <View className="mb-5 gap-4">
              {showWordingNote ? (
                <View className="rounded-input border border-petal bg-blush px-4 py-3">
                  <Text className="text-body-sm text-ink">{copy.scholar.notices.permissionNote}</Text>
                </View>
              ) : null}
              {chat.entry !== null ? (
                <View className="card card--blush gap-1">
                  <Text className="eyebrow">{copy.scholar.contextEyebrow}</Text>
                  {chat.entry.devotional?.title ? (
                    <Text className="text-label-lg text-ink">{chat.entry.devotional.title}</Text>
                  ) : null}
                  {chat.entry.scripture?.reference ? (
                    <Text className="text-label-md text-rosewood">{chat.entry.scripture.reference}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            )
          }
          ListFooterComponent={
            empty && !chat.sending && !chat.heavy ? (
              <View className="pt-5">
                <SuggestionChips chips={chipsNew} onPick={(text) => chat.send(text)} disabled={chat.sending} />
              </View>
            ) : undefined
          }
        />
        <View>
          {noticeKind !== null ? (
            <View className="px-4 pb-2">
              <ConversationNotice
                text={noticeText(noticeKind, opensDay)}
                action={
                  noticeKind === "plan"
                    ? {
                      label: copy.scholar.notices.seePlans,
                      onPress: () => navigation.navigate("Paywall", { source: "scholar", reason: "conversation" }),
                    }
                    : undefined
                }
                help={noticeKind === "rateLimited" && chat.heavy ? chat.help : null}
              />
            </View>
          ) : chat.creditsOut !== null ? (
            <View className="px-4 pb-2">
              <ConversationNotice
                text={copy.scholar.notices.creditsOut}
                detail={{
                  text: credits.renew(credits.renewsIn(chat.creditsOut)),
                  label: credits.renew(credits.renewsInSpoken(chat.creditsOut)),
                }}
              />
            </View>
          ) : micOff ? (
            <View className="px-4 pb-2">
              <ConversationNotice
                text={copy.scholar.speak.micOff}
                action={{
                  label: copy.scholar.speak.openSettings,
                  onPress: () => {
                    void Linking.openSettings().catch(() => undefined);
                  },
                }}
              />
            </View>
          ) : talkLeft !== null ? (
            <Text accessibilityLiveRegion="polite" className="px-4 pb-2 text-center text-body-sm text-mauve">
              {copy.scholar.talk.low(talkLeft)}
            </Text>
          ) : chat.freeLeft !== null ? (
            // The free conversation's last few messages (2026-11-20): the number is the server's, from the last answer.
            <Text className="px-4 pb-2 text-center text-body-sm text-mauve">
              {copy.scholar.notices.freeLeft(chat.freeLeft)}
            </Text>
          ) : chat.creditsLow !== null ? (
            // Not a live region: its countdown moves every minute.
            <Text
              accessibilityLabel={credits.lowSpoken(
                chat.creditsLow.percent,
                credits.renewsInSpoken(chat.creditsLow.renewsInMinutes),
              )}
              className="px-4 pb-2 text-center text-body-sm text-mauve"
            >
              {credits.low(chat.creditsLow.percent, credits.renewsIn(chat.creditsLow.renewsInMinutes))}
            </Text>
          ) : chat.breakNote ? (
            <Text className="px-4 pb-2 text-center text-body-sm text-mauve">{copy.scholar.notices.breakNote}</Text>
          ) : null}
          <ConversationComposer
            initialMode={params.compose === "speak" ? "speak" : "type"}
            busy={chat.sending}
            inputRef={inputRef}
            onSend={chat.send}
            onSendSpoken={chat.sendSpoken}
            onTalk={canTalk ? openTalk : null}
          />
        </View>
      </>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {/* Under the permission sheet nothing here can be reached by a screen reader until the person has answered. */}
        <View
          style={styles.flex}
          accessibilityElementsHidden={!allowed}
          importantForAccessibility={allowed ? "auto" : "no-hide-descendants"}
        >
          {header}
          {body}
        </View>
      </KeyboardAvoidingView>
      {/* Android hears "Scholar is writing" and "Scholar answered" from a hidden live region; iOS from useAnnounce. */}
      {Platform.OS === "android" && announcement !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.hidden}>
          {announcement}
        </Text>
      ) : null}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} onDismiss={runAfterMenu}>
        <View className="rounded-card border border-petal bg-card" style={shadows.card}>
          <View className="overflow-hidden rounded-card">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.scholar.delete.menu}
              onPress={pickDelete}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="list-row justify-center">
                <View className="size-9 items-center justify-center rounded-full bg-crisis/12">
                  <Icon name={icons.delete} size={18} color={colors.crisis} />
                </View>
                <Text className="shrink text-body text-crisis">{copy.scholar.delete.menu}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet visible={helpOpen} onClose={() => setHelpOpen(false)}>
        <View className="gap-4">
          <HelpLine kind={chat.help} />
          <PrimaryButton label={copy.scholar.help.close} tone="ghost" onPress={() => setHelpOpen(false)} />
        </View>
      </BottomSheet>

      {/* A new voice is kept the moment it is chosen; the next talk and the next answer read aloud speak with it. Without the
          ElevenLabs permission the sheet asks first; "Not now" closes it, and answers are read in the devotional's voice. */}
      <BottomSheet visible={voicesStep !== null} onClose={() => setVoicesStep(null)} onDismiss={runAfterVoices}>
        {voicesStep === "permission" ? (
          <VoicePermissionStep
            onAllow={() => {
              setVoiceAllowed(true);
              setVoicesStep("voices");
            }}
            onNotNow={() => setVoicesStep(null)}
            onOpenPrivacy={() => void openLegalPage(PRIVACY_POLICY_URL)}
          />
        ) : (
          <View className="gap-4">
            <Text accessibilityRole="header" className="text-headline text-plum-deep">
              {copy.scholarVoice.title}
            </Text>
            <Text className="text-body text-mauve">{copy.scholarVoice.sheet.body}</Text>
            <VoiceRows selected={voice} onSelect={setVoice} locked={voicesLocked} onLocked={voiceLocked} />
            <PrimaryButton label={copy.scholarVoice.sheet.done} onPress={() => setVoicesStep(null)} />
          </View>
        )}
      </BottomSheet>

      <ShareSheet text={shareSheet.text} whatsApp={shareSheet.whatsApp} onClose={shareSheet.close} />

      <ConfirmDialog
        visible={confirmDelete}
        tone="destructive"
        icon={icons.delete}
        title={copy.scholar.delete.title}
        body={copy.scholar.delete.body}
        confirmLabel={copy.scholar.delete.confirm}
        cancelLabel={copy.scholar.delete.cancel}
        loading={deleting}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setConfirmDelete(false)}
      >
        {deleteFailed !== null ? (
          <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
            {deleteFailed}
          </Text>
        ) : null}
      </ConfirmDialog>

      <TalkSheet
        step={talkSheet}
        voice={voice}
        onAllow={() => {
          setVoiceAllowed(true);
          setTalkSheet("voice");
        }}
        onChooseVoice={setVoice}
        onStart={startFromSheet}
        onClose={() => setTalkSheet(null)}
        onDismiss={runAfterTalkSheet}
        onOpenPrivacy={() => void openLegalPage(PRIVACY_POLICY_URL)}
        locked={voicesLocked}
        onLocked={talkVoiceLocked}
      />

      {/* Nothing is sent until this account has allowed Google's AI (Apple's guideline 5.1.2(i)). A starter waits for Allow;
          "Not now" goes back and nothing is sent. */}
      {allowed ? null : (
        <AiPermissionSheet
          onAllow={allow}
          onNotNow={() => navigation.goBack()}
          onOpenPrivacy={() => void openLegalPage(PRIVACY_POLICY_URL)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  flex: { flex: 1 },
  list: { paddingTop: 16, paddingBottom: 16 },
  gap: { height: 20 },
  pressed: { opacity: 0.6 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
