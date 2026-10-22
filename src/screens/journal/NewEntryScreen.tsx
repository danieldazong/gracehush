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
  type TextInput,
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
import { submitEntry } from "@/data/journalRepository";
import { useRecorder } from "@/hooks/useRecorder";
import type { RootStackScreenProps } from "@/navigation/types";
import { haptics } from "@/services/haptics";
import type { ProcessEntryRequest, ProcessingStage } from "@/types";

import { ProcessingOverlay } from "./ProcessingOverlay";
import { SpeakSection } from "./SpeakSection";
import { WriteSection } from "./WriteSection";

const { header, modes, footer, discard, discardRecording } = copy.newEntry;

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

export function NewEntryScreen({ navigation, route }: RootStackScreenProps<"NewEntry">) {
  const { width, fontScale } = useWindowDimensions();
  const recorder = useRecorder();
  const [mode, setMode] = useState(route.params.mode);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // One id for the whole screen: "Try again" resubmits it, and step 23 names the recording after it.
  const [clientEntryId] = useState(() => randomUUID());
  const inputRef = useRef<TextInput>(null);
  // The removal the guard stopped, kept until the dialog is answered.
  const pendingLeave = useRef<NavigationAction | null>(null);
  // Set just before every deliberate exit, so the guard lets it through.
  const leaving = useRef(false);
  const mounted = useRef(false);
  // Blocks a second press while a submit is on its way.
  const submitting = useRef(false);
  const lastRequest = useRef<ProcessEntryRequest | null>(null);

  const hasContent =
    recorder.state === "recording" || recorder.state === "recorded" || text.trim().length > 0;
  const hasAudio = recorder.state === "recording" || recorder.state === "recorded";
  const canSubmit =
    mode === "speak"
      ? hasAudio && recorder.durationMs >= MIN_RECORDING_MS
      : text.trim().length >= MIN_TEXT_LENGTH;
  const modeLocked = recorder.state === "recording" || recorder.state === "requesting";

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
    // The kept action already carries the routes the guard asked about, so it passes.
    if (action) navigation.dispatch(action);
  }

  async function confirmRecordAgain() {
    setDialog(null);
    await recorder.discard();
  }

  async function run(request: ProcessEntryRequest) {
    setPhase("sending");
    setStage("receiving");
    const result = await submitEntry(request, (next) => {
      if (mounted.current) setStage(next);
    });
    if (!mounted.current) return;
    // A crisis result is checked before any error: crisis support is never paywalled.
    if (result.kind === "ready" || result.kind === "crisis") {
      leaving.current = true;
      // Only a finished devotional gets the success tap: a crisis result is as calm as the screen it opens.
      if (result.kind === "ready") haptics.success();
      // Reflection decides what to show; the crisis state is a data state (step 13).
      navigation.replace("Reflection", { entryId: result.entryId });
    } else if (result.code === "LIMIT_REACHED") {
      leaving.current = true;
      // TODO(22): the server returns entryId with LIMIT_REACHED; pass it as { source: "limit", entryId }
      navigation.replace("Paywall", { source: "limit" });
    } else {
      submitting.current = false;
      setPhase("error");
    }
  }

  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    Keyboard.dismiss();
    let request: ProcessEntryRequest;
    if (mode === "speak") {
      // Finish while recording stops first, then sends what was recorded.
      const audio = recorder.state === "recording" ? await recorder.stop() : recorder.recording;
      if (!audio) {
        submitting.current = false;
        return;
      }
      request = {
        clientEntryId,
        inputType: "audio",
        audioPath: audio.uri,
        durationMs: audio.durationMs,
        mimeType: audio.mimeType,
      };
    } else {
      request = { clientEntryId, inputType: "text", text: text.trim() };
    }
    lastRequest.current = request;
    await run(request);
  }

  // The same request again, with the same clientEntryId.
  function retry() {
    if (!lastRequest.current || submitting.current) return;
    submitting.current = true;
    run(lastRequest.current);
  }

  function closeWhileSending() {
    leaving.current = true;
    // TODO(25): keep processing after the screen closes and show the entry when it is ready
    navigation.goBack();
  }

  function saveAndClose() {
    leaving.current = true;
    // TODO(24): queue for retry
    navigation.goBack();
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
              {hasContent ? (
                <View className="flex-row items-center gap-1.5">
                  <View className="size-1.5 rounded-full bg-rose" />
                  <Text className="text-label-md text-mauve">{header.saved}</Text>
                </View>
              ) : null}
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
                onPress={submit}
              />
            </View>
          </View>
        </View>

        {editing ? null : (
          <ProcessingOverlay
            entryKind={mode === "speak" ? "audio" : "text"}
            stage={stage}
            error={phase === "error"}
            onClose={closeWhileSending}
            onRetry={retry}
            onSaveAndClose={saveAndClose}
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
