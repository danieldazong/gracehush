import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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
import { Skeleton } from "@/components/Skeleton";
import { ConversationNotice } from "@/components/scholar/ConversationNotice";
import { ScholarAnswer, type ListenView } from "@/components/scholar/ScholarAnswer";
import { SuggestionChips } from "@/components/scholar/SuggestionChips";
import { UserMessage } from "@/components/scholar/UserMessage";
import { MODAL_HANDOFF_FALLBACK_MS, PRIVACY_POLICY_URL, SUPPORT_EMAIL } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, layout, shadows } from "@/constants/theme";
import { useAiPermission, useAiWordingNote } from "@/hooks/useAiPermission";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useConversation, type ConversationNotice as NoticeKind } from "@/hooks/useConversation";
import { useEntitlement } from "@/hooks/useEntitlement";
import type { RootStackScreenProps } from "@/navigation/types";
import { openLegalPage } from "@/services/externalLinks";
import {
  clearScholarAudio,
  getScholarListenState,
  playScholarAnswer,
  stopScholarAudio,
  subscribeScholarListen,
  type ScholarListenState,
} from "@/services/scholarPlayer";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type { ScholarMessage } from "@/types";
import type { ConversationRow } from "@/utils/scholarRows";

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

function noticeText(kind: NoticeKind): string {
  const { notices, speak } = copy.scholar;
  switch (kind) {
    case "offline":
      return notices.offline;
    case "freeLimit":
      return notices.freeLimit;
    case "proLimit":
      return notices.proLimit;
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
    return {
      phase: "failed",
      line: state.usage?.kind === "listen_day" ? copy.scholar.notices.listenLimit : copy.scholar.listen.failed,
    };
  }
  return { phase: state.phase };
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
  const { isPaid, known } = useEntitlement();
  const online = useOfflineStore(selectIsOnline);
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

  // The newest message stays in view when the keyboard opens.
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => listRef.current?.scrollToEnd({ animated: true }));
    return () => subscription.remove();
  }, []);

  // "Scholar is writing" while a turn is in flight, then "Scholar answered": the two alternate, so each answer is heard.
  const announcement = chat.sending ? copy.scholar.a11y.writing : chat.fresh.length > 0 ? copy.scholar.a11y.answered : null;
  useAnnounce(announcement);

  function allow() {
    setAllowed(true);
    chat.sendStarter();
  }

  async function onListen(message: ScholarMessage) {
    // A free account hears Scholar with Pro, except in a heavy conversation, where the tap plays for everyone.
    if (!chat.heavy && known && !isPaid) {
      navigation.navigate("Paywall", { source: "scholar", reason: "listen" });
      return;
    }
    await playScholarAnswer(message.id);
    const after = getScholarListenState();
    if (after.phase === "failed" && after.messageId === message.id && after.usage?.kind === "listen_plan") {
      stopScholarAudio();
      navigation.navigate("Paywall", { source: "scholar", reason: "listen" });
    }
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
          onRetry={() => chat.retry(item.message.id)}
        />
      );
    }
    if (item.kind === "waiting") {
      return (
        <View className="flex-row items-center gap-2">
          <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
            <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
          </View>
          <ActivityIndicator size="small" color={colors.plum} />
          <Text accessibilityLiveRegion="polite" className="text-body-sm text-mauve">
            {copy.scholar.waiting}
          </Text>
        </View>
      );
    }
    return (
      <View className="gap-3">
        <ScholarAnswer
          message={item.message}
          animate={chat.fresh.includes(item.message.id)}
          listen={listenView(listen, item.message.id)}
          onListen={() => void onListen(item.message)}
          onStopListening={stopScholarAudio}
          onDelete={item.message.helpLine === "abuse" ? openDelete : null}
        />
        {item.newest && !chat.heavy && !chat.sending ? (
          <SuggestionChips chips={copy.scholar.chips.after} onPick={(text) => chat.send(text)} disabled={chat.sending} />
        ) : null}
      </View>
    );
  }

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
        <Text accessibilityRole="header" className="flex-1 text-section text-plum-deep">
          {copy.scholar.header}
        </Text>
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
                text={noticeText(noticeKind)}
                action={
                  noticeKind === "freeLimit"
                    ? {
                      label: copy.scholar.notices.seePlans,
                      onPress: () => navigation.navigate("Paywall", { source: "scholar", reason: "messages" }),
                    }
                    : undefined
                }
                help={noticeKind === "rateLimited" && chat.heavy ? chat.help : null}
              />
            </View>
          ) : chat.headsUp !== null ? (
            <Text accessibilityLiveRegion="polite" className="px-4 pb-2 text-center text-body-sm text-mauve">
              {copy.scholar.remaining(chat.headsUp)}
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
  mark: { width: 18, height: 18 },
  pressed: { opacity: 0.6 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
