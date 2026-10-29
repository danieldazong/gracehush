import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CrisisSupportPanel } from "@/components/crisis/CrisisSupportPanel";
import { DeleteReflectionDialog } from "@/components/DeleteReflectionDialog";
import { FadeIn } from "@/components/FadeIn";
import { Icon } from "@/components/Icon";
import { MiniPlayerCard } from "@/components/MiniPlayerCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ReflectionCarousel } from "@/components/ReflectionCarousel";
import { ScriptureCard } from "@/components/ScriptureCard";
import { TranscriptRow } from "@/components/TranscriptRow";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import { getPlaybackTrack } from "@/data/selectors";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useDeleteReflection } from "@/hooks/useDeleteReflection";
import { useReflection } from "@/hooks/useReflection";
import type { RootStackScreenProps } from "@/navigation/types";
import { haptics } from "@/services/haptics";
import { useNoticeStore } from "@/store/noticeStore";
import type {
  Affirmation,
  Devotional,
  JournalEntry,
  Prayer,
  ReflectionTab,
  RepoResult,
  Scripture,
  TimeSlot,
  UserProfile,
} from "@/types";
import { formatEntryDate, getValidationHeadline, quoteVerse } from "@/utils/format";

import {
  ReflectionError,
  ReflectionFailed,
  ReflectionLoading,
  ReflectionNotFound,
  ReflectionPreparing,
} from "./ReflectionStateViews";

const { subline, words, request, footer } = copy.reflection;
const deleteText = copy.deleteReflection;

// The sections arrive one after another: each rises 10dp while it fades in, 60 ms after the one above it.
const ARRIVAL = { rise: 10, duration: 240 };
const ARRIVAL_STEP_MS = 60;
const arrive = (position: number) => ({ ...ARRIVAL, delay: position * ARRIVAL_STEP_MS });

const icons = {
  back: { android: "chevron_left", ios: "chevron.left" },
  date: { android: "calendar_today", ios: "calendar" },
  prayer: { android: "volunteer_activism", ios: "hands.sparkles" },
  share: { android: "share", ios: "square.and.arrow.up" },
  delete: { android: "delete", ios: "trash" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ReflectionHeaderProps = {
  // Null until an entry is loaded: loading, not found and error show no date.
  date: string | null;
  onBack: () => void;
};

function ReflectionHeader({ date, onBack }: ReflectionHeaderProps) {
  return (
    <View className="border-b border-petal">
      <View className="screen__content min-h-14 flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.reflection.back}
          onPress={onBack}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={icons.back} size={24} color={colors.ink} />
          </View>
        </Pressable>
        {date ? (
          <View className="flex-1 flex-row items-center gap-1.5">
            <Icon name={icons.date} size={18} color={colors.rosewood} />
            <Text className="shrink text-label-lg text-rosewood">{date}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

type PrayerRequestRowProps = {
  entryId: string;
  prayer: Prayer | null;
  onSetTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
};

// The whole row is the touch target (the native Switch alone is 31 tall on iOS), so the Switch is only
// a picture of the state and is hidden from the touch system and from screen readers. The state is the entry's
// (step 29): a change shows at once and the sync engine sends it. Turning it off on an answered prayer asks
// first, because its answered date and gratitude note go with it.
function PrayerRequestRow({ entryId, prayer, onSetTracked }: PrayerRequestRowProps) {
  const checked = prayer !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // A change the server refused for good is said here too, for this entry only.
  const refused = useNoticeStore((store) => store.prayerChangeFailed === entryId);
  // One change at a time: a second tap waits for the first to be saved on the phone.
  const changing = useRef(false);

  // Leaving the reflection ends the notice.
  useEffect(() => () => useNoticeStore.getState().clearPrayerChangeFailed(), []);

  async function change(tracked: boolean) {
    if (changing.current) return;
    changing.current = true;
    setFailed(false);
    useNoticeStore.getState().clearPrayerChangeFailed();
    haptics.selection();
    // TODO(34): prayer_tracked_changed { tracked }
    const result = await onSetTracked(tracked);
    changing.current = false;
    if (!result.ok) setFailed(true);
  }

  function press() {
    if (prayer !== null && prayer.isAnswered) {
      setConfirmOpen(true);
      return;
    }
    void change(!checked);
  }

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked }}
        accessibilityLabel={request.title}
        accessibilityHint={request.helper}
        onPress={press}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="card flex-row items-center gap-3 p-3.5">
          <View className="size-9 items-center justify-center rounded-full bg-blush">
            <Icon name={icons.prayer} size={20} color={colors.plum} />
          </View>
          <View className="flex-1">
            <Text className="text-label-lg text-ink">{request.title}</Text>
            <Text className="mt-0.5 text-body-sm text-mauve">{request.helper}</Text>
          </View>
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Switch
              value={checked}
              trackColor={{ false: colors.petal, true: colors.plum }}
              thumbColor={colors.card}
              ios_backgroundColor={colors.petal}
            />
          </View>
        </View>
      </Pressable>
      {failed || refused ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
          {copy.prayers.notice.failed}
        </Text>
      ) : null}
      <ConfirmDialog
        visible={confirmOpen}
        title={request.remove.title}
        body={request.remove.body}
        confirmLabel={request.remove.confirm}
        cancelLabel={request.remove.cancel}
        onConfirm={() => {
          setConfirmOpen(false);
          void change(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}

// Only the verse and its reference leave the app: never the transcript, the emotion or the devotional.
async function shareScripture(scripture: Scripture) {
  if (!scripture.verified || scripture.text === null) return;
  try {
    await Share.share({
      message: copy.reflection.share.message(quoteVerse(scripture.text), scripture.reference),
    });
  } catch {
    // The share sheet could not open. There is nothing to show: nothing was shared.
  }
}

type ReadyViewProps = {
  entry: JournalEntry;
  devotional: Devotional;
  affirmations: Affirmation[];
  profile: UserProfile;
  currentSlot: TimeSlot;
  initialTab: ReflectionTab | undefined;
  onOpenPlayer: () => void;
  onReturn: () => void;
  onSetTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
  // Delete reflection (step 29b): asks before deleting. `deleteOffline` is true after a tap with no connection.
  onDelete: () => void;
  deleteOffline: boolean;
};

// A finished entry with a devotional. The screen keys it by the entry and the tab it was opened on, so another
// entry starts from its own prayer toggle, tab and expanded state, and a tapped notification for the reflection
// that is already open turns it to Affirmations (step 28).
function ReadyView({
  entry,
  devotional,
  affirmations,
  profile,
  currentSlot,
  initialTab,
  onOpenPlayer,
  onReturn,
  onSetTracked,
  onDelete,
  deleteOffline,
}: ReadyViewProps) {
  const { width } = useWindowDimensions();
  const { scripture } = entry;
  const transcript = entry.transcript?.trim() ?? "";
  const isVoice = entry.inputType === "audio";
  // Unverified scripture is never shared.
  const shareable = scripture?.verified && scripture.text !== null ? scripture : null;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        {
          paddingHorizontal:
            width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding,
        },
      ]}
    >
      <FadeIn {...arrive(0)}>
        <View>
          <Text
            accessibilityRole="header"
            className="font-fraunces text-[27px] leading-[34px] tracking-[-0.675px] text-plum-deep"
          >
            {getValidationHeadline(entry.dominantEmotion)}
          </Text>
          <Text className="mt-1.5 text-body-sm text-mauve">
            {isVoice ? subline.audio : subline.text}
          </Text>
        </View>
      </FadeIn>
      <FadeIn {...arrive(1)}>
        <MiniPlayerCard
          devotional={devotional}
          track={getPlaybackTrack(entry)}
          ambientDefault={profile}
          onOpen={onOpenPlayer}
        />
      </FadeIn>
      {scripture ? (
        <FadeIn {...arrive(2)}>
          <ScriptureCard scripture={scripture} />
        </FadeIn>
      ) : null}
      <FadeIn {...arrive(3)}>
        <ReflectionCarousel
          devotional={devotional}
          affirmations={affirmations}
          reminders={profile.reminders}
          currentSlot={currentSlot}
          initialTab={initialTab}
        />
      </FadeIn>
      {transcript ? (
        <FadeIn {...arrive(4)}>
          <TranscriptRow
            title={isVoice ? words.titleAudio : words.titleText}
            transcript={transcript}
          />
        </FadeIn>
      ) : null}
      <FadeIn {...arrive(5)}>
        <View className="gap-3 pt-1">
          <PrayerRequestRow entryId={entry.id} prayer={entry.prayer} onSetTracked={onSetTracked} />
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
            </View>
            {shareable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={footer.share}
                onPress={() => shareScripture(shareable)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="size-12 items-center justify-center rounded-full border border-petal bg-card">
                  <Icon name={icons.share} size={20} color={colors.plum} />
                </View>
              </Pressable>
            ) : null}
          </View>
          {/* Deleting is permanent, so it is a quiet link at the very end, not a button beside the main action (step 29b). */}
          <View className="items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={deleteText.linkLabel}
              accessibilityHint={deleteText.linkHint}
              onPress={onDelete}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="min-h-11 flex-row items-center gap-1.5 px-4">
                <Icon name={icons.delete} size={16} color={colors.mauve} />
                <Text className="btn-text__label text-mauve">{deleteText.link}</Text>
              </View>
            </Pressable>
            {deleteOffline ? (
              <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-mauve">
                {deleteText.offline}
              </Text>
            ) : null}
          </View>
        </View>
      </FadeIn>
    </ScrollView>
  );
}

export function ReflectionScreen({ navigation, route }: RootStackScreenProps<"Reflection">) {
  const state = useReflection(route.params.entryId);
  // Delete reflection (step 29b): the dialog is shared with Prayers. A delete takes the person back to where they came from.
  const deletion = useDeleteReflection(() => goBack());
  const [deleteOffline, setDeleteOffline] = useState(false);
  useAnnounce(deleteOffline ? deleteText.offline : null);

  // The chevron goes back to where the user came from. With nothing to go back to (a notification can
  // open Reflection first, step 28) it lands on Journal, like "Return to Journal".
  function goBack() {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      returnToJournal();
    }
  }

  // popTo, not navigate: navigate would push a second MainTabs on top of Reflection, and Android back
  // would then show Reflection again. popTo goes back to the MainTabs already in the stack.
  function returnToJournal() {
    navigation.popTo("MainTabs", { screen: "Journal" });
  }

  let body: ReactElement;
  if (state.status === "loading") {
    body = <ReflectionLoading />;
  } else if (state.status === "not-found") {
    body = <ReflectionNotFound onReturn={returnToJournal} />;
  } else if (state.status === "error") {
    body = <ReflectionError onRetry={state.retry} onReturn={returnToJournal} />;
  } else if (state.entry.isCrisis) {
    // Checked before the status: a crisis entry is a finished one in the data, so it has to win over the
    // status checks below. The panel is given the transcript and nothing else of the entry.
    body = (
      <CrisisSupportPanel
        transcript={state.entry.transcript}
        onOpenResources={() => navigation.navigate("CrisisResources", { source: "reflection" })}
        onReturn={returnToJournal}
      />
    );
  } else if (
    state.entry.status === "pending" ||
    state.entry.status === "uploading" ||
    state.entry.status === "processing"
  ) {
    body = <ReflectionPreparing onReturn={returnToJournal} />;
  } else if (state.entry.status === "failed" || state.entry.devotional === null) {
    body = <ReflectionFailed onReturn={returnToJournal} />;
  } else {
    body = (
      <ReadyView
        key={`${state.entry.id}:${route.params.tab ?? ""}`}
        entry={state.entry}
        devotional={state.entry.devotional}
        affirmations={state.affirmations}
        profile={state.profile}
        currentSlot={state.currentSlot}
        initialTab={route.params.tab}
        onOpenPlayer={() => navigation.navigate("NowPlaying", { entryId: state.entry.id })}
        onReturn={returnToJournal}
        onSetTracked={state.setTracked}
        onDelete={() => {
          // TODO(34): reflection_deleted { source: "reflection", had_audio: boolean }
          const opened = deletion.ask({
            entryId: state.entry.id,
            answered: state.entry.prayer?.isAnswered === true,
          });
          setDeleteOffline(!opened);
        }}
        deleteOffline={deleteOffline}
      />
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ReflectionHeader
        // No date on the crisis view: it means nothing to someone in distress and makes the screen feel clinical.
        date={
          state.status === "ready" && !state.entry.isCrisis ? formatEntryDate(state.entry.createdAt) : null
        }
        onBack={goBack}
      />
      {body}
      <DeleteReflectionDialog {...deletion.dialog} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  content: { gap: 16, paddingTop: 16, paddingBottom: 32 },
  pressed: { opacity: 0.6 },
});
