import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { GRATITUDE_COUNTER_FROM, MAX_GRATITUDE_NOTE_LENGTH } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import type { Prayer, RepoResult } from "@/types";
import { formatCalendarDate, getPrayerTitle } from "@/utils/format";
import { isValidAnsweredDate, parseCalendarDate, toCalendarDate } from "@/utils/prayerDates";

const { sheet, discard, errors } = copy.prayers;

const icons = {
  close: { android: "close", ios: "xmark" },
  prayer: { android: "volunteer_activism", ios: "hands.sparkles" },
  calendar: { android: "calendar_today", ios: "calendar" },
  save: { android: "favorite", ios: "heart.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type MarkAnsweredSheetProps = {
  prayer: Prayer;
  // "mark" asks for the day and a note; "editNote" changes only the note of an answered prayer.
  mode: "mark" | "editNote";
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: { answeredDate: string; note: string | null }) => Promise<RepoResult<Prayer>>;
};

// The screen gives each opening a new key, so the form always starts fresh and its days are the ones of
// the moment the sheet opened.
export function MarkAnsweredSheet({
  prayer,
  mode,
  visible,
  onClose,
  onSubmit,
}: MarkAnsweredSheetProps) {
  const marking = mode === "mark";
  const startingNote = marking ? "" : (prayer.answeredNote ?? "");
  const [days] = useState(() => {
    const now = new Date();
    return {
      today: toCalendarDate(now),
      yesterday: toCalendarDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
      // The picker's range, as local noon on the day the prayer was created and on today.
      earliest: parseCalendarDate(toCalendarDate(new Date(prayer.createdAt))) ?? now,
      latest: parseCalendarDate(toCalendarDate(now)) ?? now,
    };
  });
  const [answeredDate, setAnsweredDate] = useState(days.today);
  const [note, setNote] = useState(startingNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // iOS only: the spinner opens under the date row. Android uses its own dialog.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  useAnnounce(error);

  const title = getPrayerTitle(prayer);
  const pickerValue = parseCalendarDate(answeredDate) ?? days.latest;
  const relative =
    answeredDate === days.today
      ? copy.common.today
      : answeredDate === days.yesterday
        ? copy.common.yesterday
        : null;
  // Only a note that differs from the one the sheet started with is worth asking about. A changed day is not.
  const hasUnsavedNote = note.trim() !== startingNote.trim();

  // The scrim, the X, the text button and Android back all end up here. While saving none of them does anything.
  function requestClose() {
    if (saving) return;
    if (hasUnsavedNote) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function chooseDay(date: Date) {
    setAnsweredDate(toCalendarDate(date));
    setError(null);
  }

  function chooseDate() {
    Keyboard.dismiss();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: "date",
        minimumDate: days.earliest,
        maximumDate: days.latest,
        onValueChange: (_event, date) => chooseDay(date),
      });
      return;
    }
    setPickerOpen((open) => !open);
  }

  async function save() {
    if (saving) return;
    if (marking && !isValidAnsweredDate(answeredDate, prayer.createdAt, new Date())) {
      setError(errors.date);
      return;
    }
    const trimmed = note.trim();
    setError(null);
    setSaving(true);
    const result = await onSubmit({ answeredDate, note: trimmed === "" ? null : trimmed });
    setSaving(false);
    if (result.ok) {
      onClose();
      return;
    }
    // The sheet stays open with the text as it was.
    setError(result.code === "INVALID" && marking ? errors.date : errors.save);
  }

  return (
    <BottomSheet visible={visible} onClose={requestClose}>
      <View className="gap-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="eyebrow">{sheet.eyebrow}</Text>
            <Text accessibilityRole="header" className="text-section text-plum-deep">
              {marking ? sheet.markTitle : sheet.noteTitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.close}
            onPress={requestClose}
            style={({ pressed }) => pressed && styles.pressed}
          >
            {/* The circle is 36 and the touch area 44. */}
            <View className="size-11 items-center justify-center">
              <View className="size-9 items-center justify-center rounded-full bg-linen-deep">
                <Icon name={icons.close} size={20} color={colors.mauve} />
              </View>
            </View>
          </Pressable>
        </View>

        <View className="max-w-full flex-row items-center gap-2 self-start rounded-full border border-petal bg-white/70 px-3 py-2">
          <Icon name={icons.prayer} size={16} color={colors.plum} />
          <Text
            numberOfLines={1}
            className="shrink font-dm-medium text-[13px] leading-[19px] text-plum-deep"
          >
            {title}
          </Text>
        </View>

        {marking ? (
          <View className="gap-1.5">
            <Text className="text-label-md text-ink">{sheet.dateLabel}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sheet.dateA11y(formatCalendarDate(answeredDate), relative)}
              accessibilityHint={sheet.dateHint}
              onPress={chooseDate}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="min-h-12 flex-row items-center gap-2 rounded-input border border-petal bg-card px-3">
                <Icon name={icons.calendar} size={20} color={colors.terracotta} />
                <Text className="flex-1 text-body text-ink">{formatCalendarDate(answeredDate)}</Text>
                {relative ? (
                  <View className="chip chip--terracotta">
                    <Text className="chip__label chip__label--terracotta">{relative}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            {Platform.OS === "ios" && pickerOpen ? (
              <DateTimePicker
                value={pickerValue}
                mode="date"
                display="spinner"
                themeVariant="light"
                minimumDate={days.earliest}
                maximumDate={days.latest}
                onValueChange={(_event, date) => chooseDay(date)}
              />
            ) : null}
          </View>
        ) : null}

        <View className="gap-1.5">
          <Text className="text-label-md text-ink">{sheet.noteLabel}</Text>
          <TextInput
            accessibilityLabel={sheet.noteA11y}
            className="input min-h-[120px] py-3"
            value={note}
            onChangeText={(text) => {
              setNote(text);
              setError(null);
            }}
            placeholder={sheet.notePlaceholder}
            placeholderTextColor={colors.mauve}
            multiline
            textAlignVertical="top"
            maxLength={MAX_GRATITUDE_NOTE_LENGTH}
            keyboardAppearance="light"
            editable={!saving}
          />
          {note.length >= GRATITUDE_COUNTER_FROM ? (
            <Text className="self-end text-body-sm text-mauve">
              {sheet.counter(note.length, MAX_GRATITUDE_NOTE_LENGTH)}
            </Text>
          ) : null}
        </View>

        <View className="gap-2.5 pt-1">
          <PrimaryButton
            label={marking ? sheet.save : sheet.saveNote}
            iconLeft={marking ? icons.save : undefined}
            loading={saving}
            onPress={save}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={marking ? sheet.notYet : sheet.cancel}
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            className="min-h-11 items-center justify-center"
            onPress={requestClose}
          >
            <Text className="text-body text-mauve">{marking ? sheet.notYet : sheet.cancel}</Text>
          </Pressable>
          {error ? (
            <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
              {error}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Inside the sheet's content, not beside it: a Modal presented while another one is up works on iOS only from inside the first one's tree. */}
      <ConfirmDialog
        visible={discardOpen}
        title={discard.title}
        body={discard.body}
        confirmLabel={discard.confirm}
        cancelLabel={discard.cancel}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
