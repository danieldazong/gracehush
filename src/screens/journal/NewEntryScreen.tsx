import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import { randomUUID } from "expo-crypto";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { MIN_RECORDING_MS, MIN_TEXT_LENGTH } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import * as outbox from "@/db/outbox";
import { useRecorder } from "@/hooks/useRecorder";
import type { RootStackScreenProps } from "@/navigation/types";
import { haptics } from "@/services/haptics";
import { discardItem, syncAndWait, syncNow } from "@/services/syncEngine";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type { ProcessingStage } from "@/types";

import { ProcessingOverlay, type OverlayFailure } from "./ProcessingOverlay";
import { SpeakSection } from "./SpeakSection";
import { WriteSection } from "./WriteSection";

const { header, modes, footer, discard, discardRecording, processing } = copy.newEntry;

// After the modal transition, as in EmailSheet: autoFocus inside a modal can leave the keyboard closed.
const FOCUS_DELAY_MS = 350;

// The footer button's padding, gap and icon, and the width of its longest label at 15 SemiBold. Below
// their sum (scaled with the font) the button wraps under Cancel instead of clipping.
const BUTTON_CHROME = 74;
const LONGEST_BUTTON_LABEL = 130;

const icons = {
  close: { android: "close", ios: "xmark" },
  lock: { android: "lock", ios: "lock.fill" },
  arrow: { android: "arrow_forward", ios: "arrow.right" },
} satisfies Record<string, SymbolViewProps["name"]>;

const modeItems = [
  { value: "speak", label: modes.speak },
  { value: "write", label: modes.write },
] as const;

type Phase = "editing" | "sending" | "error";
type DialogKind = "leave" | "record-again";
// The phone could not save the reflection, or the server refused it for a reason only the person can fix.
type Failure = { kind: "save" } | { kind: "refused"; code: string };
type QueuedItem = Parameters<typeof outbox.enqueue>[0];

export function NewEntryScreen({ navigation, route }: RootStackScreenProps<"NewEntry">) {
  const { width, fontScale } = useWindowDimensions();
  // One id per reflection: the recording is named after it (recordings/{id}.m4a), the outbox row is keyed by it, and the
  // server treats a second request with it as the same reflection. "Edit and resend" opens this screen with the id of
  // the item it edits. "Record again" after a refusal makes a new one, because the server has kept the old one.
  const [clientEntryId, setClientEntryId] = useState(() => route.params.resend ?? randomUUID());
  const recorder = useRecorder(clientEntryId);
  const [mode, setMode] = useState(route.params.mode);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // True while a reflection is being saved on this phone with no overlay (the phone is offline).
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  // The removal the guard stopped, kept until the dialog is answered.
  const pendingLeave = useRef<NavigationAction | null>(null);
  // Set just before every deliberate exit, so the guard lets it through.
  const leaving = useRef(false);
  const mounted = useRef(false);
  // Blocks a second press while a submit is on its way.
  const submitting = useRef(false);
  // What was last saved, for "Try again" after the phone could not save it.
  const lastItem = useRef<QueuedItem | null>(null);
  // True once the reflection is in the outbox. Leaving on purpose with "Discard" then deletes it as well.
  const inOutbox = useRef(false);

  // A take that is recording or paused is already something to keep, and the toggle stays locked until it is stopped.
  const recordingOpen = recorder.state === "recording" || recorder.state === "paused";
  const hasAudio = recordingOpen || recorder.state === "recorded";
  const hasContent = hasAudio || text.trim().length > 0;
  const canSubmit =
    mode === "speak"
      ? hasAudio && recorder.durationMs >= MIN_RECORDING_MS
      : text.trim().length >= MIN_TEXT_LENGTH;
  const modeLocked = recordingOpen || recorder.state === "requesting";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (route.params.mode !== "write") {
      return undefined;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [route.params.mode]);

  // "Edit and resend" from Journal: the words that were refused come back into the field, and sending them again
  // reuses the same id (outbox.enqueue puts the refused item back in the queue with the new words).
  const resend = route.params.resend;
  useEffect(() => {
    if (resend === undefined) return undefined;
    let cancelled = false;
    outbox.get(resend).then(
      (item) => {
        if (!cancelled && item?.text) {
          inOutbox.current = true;
          setText(item.text);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [resend]);

  // Every removal fires this, replace() included, so deliberate exits set `leaving` first and the
  // guard passes the action straight on. While sending nothing may leave; otherwise ask first.
  usePreventRemove(phase !== "editing" || hasContent, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
    } else if (phase !== "sending") {
      pendingLeave.current = data.action;
      setDialog("leave");
    }
  });

  function keepEditing() {
    pendingLeave.current = null;
    setDialog(null);
  }

  async function confirmLeave() {
    const action = pendingLeave.current;
    pendingLeave.current = null;
    setDialog(null);
    await recorder.discard();
    // Discarding deletes the reflection from this phone, the queued copy too.
    if (inOutbox.current) await discardItem(clientEntryId);
    // The kept action already carries the routes the guard asked about, so it passes.
    if (action) navigation.dispatch(action);
  }

  async function confirmRecordAgain() {
    setDialog(null);
    await recorder.discard();
  }

  // A reflection that is saved and not finished leaves this screen for Journal, where its card is, with one calm line.
  function leaveToJournal(note: SavedNote | null) {
    if (note !== null) useOfflineStore.getState().setSavedNote(note);
    leaving.current = true;
    navigation.popTo("MainTabs", { screen: "Journal" });
  }

  // Saves the reflection on this phone first, and only then tries the network: what is saved is never lost to a failed
  // request. Online, the overlay shows while the sync engine prepares it. Offline, there is nothing to wait for.
  async function save(item: QueuedItem) {
    const online = selectIsOnline(useOfflineStore.getState()) !== false;
    if (online) {
      setFailure(null);
      setPhase("sending");
      setStage("receiving");
    } else {
      setSaving(true);
    }
    try {
      // A refused written reflection is still in the outbox under this id. If the person has switched to Speak since,
      // the recording replaces it: the old row goes (its words are not wanted any more), and the new one takes its id.
      if (inOutbox.current) {
        const existing = await outbox.get(item.clientEntryId);
        if (existing !== null && existing.inputType !== item.inputType) await outbox.remove(item.clientEntryId);
      }
      await outbox.enqueue(item);
      inOutbox.current = true;
    } catch {
      if (!mounted.current) return;
      submitting.current = false;
      setSaving(false);
      setFailure({ kind: "save" });
      setPhase("error");
      return;
    }
    if (!mounted.current) return;
    if (!online) {
      void syncNow("submit");
      leaveToJournal("offline");
      return;
    }
    const result = await syncAndWait(item.clientEntryId, {
      onStage: (next) => {
        if (mounted.current) setStage(next);
      },
    });
    if (!mounted.current) return;
    switch (result.kind) {
      case "ready":
        leaving.current = true;
        // Only a finished devotional gets the success tap: a crisis result is as calm as the screen it opens.
        if (!result.isCrisis) haptics.success();
        // Reflection decides what to show; the crisis state is a data state (step 13). A crisis is checked before the
        // free limit, so it never reaches the Paywall.
        navigation.replace("Reflection", { entryId: result.entryId });
        break;
      case "limit":
        leaving.current = true;
        // The reflection is saved (on this phone, and on the server: the 402 names the entry it saved): the Paywall says so.
        navigation.replace("Paywall", { source: "limit", entryId: result.entryId ?? item.clientEntryId });
        break;
      case "needs_action":
        submitting.current = false;
        setFailure({ kind: "refused", code: result.code });
        setPhase("error");
        break;
      case "later":
        // No answer yet (offline again, busy, a retry is scheduled): the engine goes on by itself.
        leaveToJournal("retry");
        break;
    }
  }

  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    Keyboard.dismiss();
    let item: QueuedItem;
    if (mode === "speak") {
      // Finish while recording or paused stops first (the file is then in recordings/), then queues what was recorded.
      const audio = recordingOpen ? await recorder.stop() : recorder.recording;
      if (!audio) {
        submitting.current = false;
        return;
      }
      item = {
        clientEntryId,
        inputType: "audio",
        durationMs: audio.durationMs,
        mimeType: audio.mimeType,
      };
    } else {
      item = { clientEntryId, inputType: "text", text: text.trim() };
    }
    lastItem.current = item;
    await save(item);
  }

  // The phone could not save the reflection: the same item again, with the same id.
  function retrySave() {
    if (!lastItem.current || submitting.current) return;
    submitting.current = true;
    void save(lastItem.current);
  }

  // Back to what was on screen. A refused written reflection stays in the outbox until it is sent again or deleted.
  function backToEditing() {
    submitting.current = false;
    setSaving(false);
    setFailure(null);
    setPhase("editing");
  }

  // A refused recording cannot be fixed: the item and its file go, and the next take gets a new id.
  async function recordAgainAfterRefusal() {
    await discardItem(clientEntryId);
    await recorder.discard();
    inOutbox.current = false;
    lastItem.current = null;
    setClientEntryId(randomUUID());
    backToEditing();
  }

  // The item stays in the outbox: Journal shows it with "Review".
  function closeAfterRefusal() {
    leaveToJournal(null);
  }

  function closeWhileSending() {
    // The engine goes on with it, and Journal shows its card.
    leaveToJournal("retry");
  }

  let overlayFailure: OverlayFailure | null = null;
  if (phase === "error" && failure !== null) {
    const { save: saveFailure, refused } = processing.failures;
    overlayFailure =
      failure.kind === "save"
        ? {
            title: saveFailure.title,
            body: saveFailure.body,
            primary: { label: saveFailure.primary, onPress: retrySave },
            secondary: { label: saveFailure.secondary, onPress: backToEditing },
          }
        : {
            title: refused.title,
            body: copy.problems.reason(failure.code),
            primary:
              mode === "speak"
                ? { label: refused.recordAgain, onPress: () => void recordAgainAfterRefusal() }
                : { label: refused.editText, onPress: backToEditing },
            secondary: { label: refused.close, onPress: closeAfterRefusal },
          };
  }

  const padding = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const editing = phase === "editing";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {/* The editing view stays mounted under the overlay, so a retry keeps the text and the recording. */}
        <View
          style={styles.flex}
          accessibilityElementsHidden={!editing}
          importantForAccessibility={editing ? "auto" : "no-hide-descendants"}
        >
          <View className="screen__content min-h-14 flex-row items-center gap-2 py-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.common.close}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="size-11 items-center justify-center">
                <Icon name={icons.close} size={20} color={colors.ink} />
              </View>
            </Pressable>
            <View className="flex-1">
              <Text accessibilityRole="header" className="text-section text-plum-deep">
                {header.title}
              </Text>
            </View>
            <View className="shrink-0 flex-row items-center gap-1 rounded-full bg-linen-deep px-2.5 py-1">
              <Icon name={icons.lock} size={14} color={colors.plumDeep} />
              <Text className="text-label-md text-plum-deep">{header.private}</Text>
            </View>
          </View>
          <View className="screen__content my-1">
            <View className="divider" />
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: padding, paddingBottom: 24 }}
          >
            <View className="mb-4 mt-1">
              <SegmentedControl
                items={modeItems}
                value={mode}
                onChange={setMode}
                variant="plum"
                compact
                disabled={modeLocked}
                accessibilityLabel={modes.label}
              />
            </View>
            {mode === "speak" ? (
              <SpeakSection
                recorder={recorder}
                onRecordAgain={() => setDialog("record-again")}
                onWriteInstead={() => setMode("write")}
              />
            ) : (
              <WriteSection text={text} onChangeText={setText} inputRef={inputRef} />
            )}
          </ScrollView>

          <View className="screen__content flex-row flex-wrap items-center gap-x-4 gap-y-2 pb-3 pt-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={footer.cancel}
              className="min-h-11 justify-center px-5"
              onPress={() => navigation.goBack()}
            >
              <Text className="text-label-lg text-ink/80">{footer.cancel}</Text>
            </Pressable>
            <View className="flex-1" style={{ minWidth: BUTTON_CHROME + LONGEST_BUTTON_LABEL * fontScale }}>
              <PrimaryButton
                label={mode === "speak" ? footer.finish : footer.submit}
                iconRight={icons.arrow}
                disabled={!canSubmit}
                loading={saving}
                onPress={submit}
              />
            </View>
          </View>
        </View>

        {editing ? null : (
          <ProcessingOverlay
            entryKind={mode === "speak" ? "audio" : "text"}
            stage={stage}
            failure={overlayFailure}
            onClose={closeWhileSending}
          />
        )}
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={dialog === "leave"}
        tone="destructive"
        title={discard.title}
        body={discard.body}
        confirmLabel={discard.confirm}
        cancelLabel={discard.cancel}
        onConfirm={confirmLeave}
        onCancel={keepEditing}
      />
      <ConfirmDialog
        visible={dialog === "record-again"}
        tone="destructive"
        title={discardRecording.title}
        body={discardRecording.body}
        confirmLabel={discardRecording.confirm}
        cancelLabel={discardRecording.cancel}
        onConfirm={confirmRecordAgain}
        onCancel={() => setDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
});
