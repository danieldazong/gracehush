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
import { DeleteReflectionDialog } from "@/components/DeleteReflectionDialog";
import { DeleteReflectionLink } from "@/components/DeleteReflectionLink";
import { FadeIn } from "@/components/FadeIn";
import { HelpLine } from "@/components/HelpLine";
import { Icon } from "@/components/Icon";
import { MiniPlayerCard } from "@/components/MiniPlayerCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ReflectionCarousel, type AddAffirmationFooter } from "@/components/ReflectionCarousel";
import { ScriptureCard } from "@/components/ScriptureCard";
import { TranscriptRow } from "@/components/TranscriptRow";
import { MAX_AFFIRMATIONS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import { getPlaybackTrack } from "@/data/selectors";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useDeleteReflection } from "@/hooks/useDeleteReflection";
import { useReflection } from "@/hooks/useReflection";
import type { RootStackScreenProps } from "@/navigation/types";
import { track } from "@/services/analytics";
import { haptics } from "@/services/haptics";
import { useNoticeStore } from "@/store/noticeStore";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type {
  Affirmation,
  Devotional,
  JournalEntry,
  Prayer,
  ReflectionTab,
  RepoResult,
  Scripture,
  UserProfile,
} from "@/types";
import { formatEntryDate, getReflectionHeadline, quoteVerse } from "@/utils/format";

import {
  ReflectionError,
  ReflectionFailed,
  ReflectionLoading,
  ReflectionNotFound,
  ReflectionPreparing,
  ReflectionRefused,
} from "./ReflectionStateViews";

const { subline, words, request, footer, wordsOnly } = copy.reflection;
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
  // A heavy moment sends no analytics event (Analytics Rules), its prayer change included.
  heavy: boolean;
  prayer: Prayer | null;
  onSetTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
};

// The whole row is the touch target (the native Switch alone is 31 tall on iOS), so the Switch is only
// a picture of the state and is hidden from the touch system and from screen readers. The state is the entry's
// (step 29): a change shows at once and the sync engine sends it. Turning it off on an answered prayer asks
// first, because its answered date and gratitude note go with it.
function PrayerRequestRow({ entryId, heavy, prayer, onSetTracked }: PrayerRequestRowProps) {
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
    const result = await onSetTracked(tracked);
    changing.current = false;
    if (result.ok && !heavy) track("prayer_tracked_changed", { tracked });
    else setFailed(true);
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
  // The spoken devotional is still being made behind the server's answer (2026-11-09): the player card says so.
  audioPending: boolean;
  initialTab: ReflectionTab | undefined;
  onOpenPlayer: () => void;
  onReturn: () => void;
  onSetTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
  // Delete reflection (step 29b): asks before deleting. `deleteOffline` is true after a tap with no connection.
  onDelete: () => void;
  deleteOffline: boolean;
  // One more affirmation (2026-11-09): what the carousel's Affirmations pane offers under its last card.
  addAffirmation: AddAffirmationFooter;
};

// A finished entry with a devotional. The screen keys it by the entry and the tab it was opened on, so another
// entry starts from its own prayer toggle, tab and expanded state, and a tapped notification for the reflection
// that is already open turns it to Affirmations (step 28). A heavy moment (2026-11-08) is shown like any other, with
// one quiet line under its devotional (HelpLine).
function ReadyView({
  entry,
  devotional,
  affirmations,
  profile,
  audioPending,
  initialTab,
  onOpenPlayer,
  onReturn,
  onSetTracked,
  onDelete,
  deleteOffline,
  addAffirmation,
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
          {/* The first line is written from the entry (8 to 18 words, step 36), so it is a lead and not a headline: Fraunces
              Regular 22/30, three lines for a typical line and five at most (2026-11-08; it was the 27/34 one-off of step 11,
              chosen for a two-line fixed sentence, which gave four lines and an orphan). The break strategies keep a lone
              word off the last line, as on PrimaryButton and ScriptureCard. */}
          <Text
            accessibilityRole="header"
            className="font-fraunces text-[22px] leading-[30px] tracking-[-0.55px] text-plum-deep"
            lineBreakStrategyIOS="push-out"
            textBreakStrategy="balanced"
          >
            {getReflectionHeadline(entry)}
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
          audioPending={audioPending}
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
          initialTab={initialTab}
          add={addAffirmation}
        />
      </FadeIn>
      {entry.isCrisis ? (
        <FadeIn {...arrive(3)}>
          <HelpLine />
        </FadeIn>
      ) : null}
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
          <PrayerRequestRow
            entryId={entry.id}
            heavy={entry.isCrisis}
            prayer={entry.prayer}
            onSetTracked={onSetTracked}
          />
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
          <DeleteReflectionLink onPress={onDelete} offline={deleteOffline} />
        </View>
      </FadeIn>
    </ScrollView>
  );
}

type WordsOnlyViewProps = {
  transcript: string | null;
  isVoice: boolean;
  onReturn: () => void;
  onDelete: () => void;
  deleteOffline: boolean;
};

// A heavy moment saved before 2026-11-08, when such an entry kept only the person's words: those words (collapsed), the quiet
// help line, the way back and the delete link. Nothing here animates, and nothing is logged.
function WordsOnlyView({ transcript, isVoice, onReturn, onDelete, deleteOffline }: WordsOnlyViewProps) {
  const { width } = useWindowDimensions();
  const shared = transcript?.trim() ?? "";
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
      <View>
        {/* The same lead class as the ready view's first line, so the first line has one rule on both views. */}
        <Text
          accessibilityRole="header"
          className="font-fraunces text-[22px] leading-[30px] tracking-[-0.55px] text-plum-deep"
          lineBreakStrategyIOS="push-out"
          textBreakStrategy="balanced"
        >
          {wordsOnly.title}
        </Text>
        <Text className="mt-1.5 text-body-sm text-mauve">{wordsOnly.body}</Text>
      </View>
      {shared ? (
        <TranscriptRow title={isVoice ? words.titleAudio : wordsOnly.words} transcript={shared} />
      ) : null}
      <HelpLine />
      <View className="gap-3 pt-1">
        <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
        <DeleteReflectionLink onPress={onDelete} offline={deleteOffline} />
      </View>
    </ScrollView>
  );
}

export function ReflectionScreen({ navigation, route }: RootStackScreenProps<"Reflection">) {
  const state = useReflection(route.params.entryId);
  // Delete reflection (step 29b): the dialog is shared with Prayers. A delete takes the person back to where they came from.
  // A heavy moment can be deleted like any reflection, with no analytics event (Analytics Rules: no event is about a heavy
  // moment).
  const isCrisisEntry = state.status === "ready" && state.entry.isCrisis;
  const deletion = useDeleteReflection(() => {
    if (!isCrisisEntry) track("reflection_deleted", { source: "reflection" });
    goBack();
  });
  const [deleteOffline, setDeleteOffline] = useState(false);
  useAnnounce(deleteOffline ? deleteText.offline : null);

  // Held by the free limit after New Entry handed the reflection to this screen (2026-11-10): the Paywall, as New Entry opens
  // it when the 402 comes inside its three seconds. Once; with the entry the server saved when it named one, else the phone's id.
  const held = state.status === "ready" && state.entry.pending?.status === "limit_reached" ? state.entry : null;
  const redirected = useRef(false);
  useEffect(() => {
    if (held === null || redirected.current) return;
    redirected.current = true;
    navigation.replace("Paywall", { source: "limit", entryId: held.pending?.serverEntryId ?? held.id });
  }, [held, navigation]);

  // One more affirmation (2026-11-09). The tap goes to the hook, which replaces the list; a failure shows a calm line until the
  // next tap. With no connection nothing is asked: the line says so (null, before NetInfo has answered, counts as online). A heavy
  // moment gets one like any reflection and sends no event (Analytics Rules).
  const online = useOfflineStore(selectIsOnline) !== false;
  const [addFailed, setAddFailed] = useState(false);
  async function addOne() {
    if (state.status !== "ready" || state.addAffirmation === null || !online) return;
    setAddFailed(false);
    const added = await state.addAffirmation();
    if (added.ok) {
      const position = added.data.length;
      if (!state.entry.isCrisis && position >= 4 && position <= MAX_AFFIRMATIONS) {
        track("affirmation_added", { position: position as 4 | 5 | 6 | 7 | 8 | 9 | 10 });
      }
    } else if (added.code !== "INVALID") {
      setAddFailed(true);
    }
  }

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
  } else if (state.entry.pending?.status === "needs_action") {
    // A reflection this phone handed to this screen that the server refused for a reason only the person can fix (2026-11-10):
    // the reason, and the way back to Journal, where its card offers Review.
    body = (
      <ReflectionRefused reason={copy.problems.reason(state.entry.pending.lastErrorCode)} onReturn={returnToJournal} />
    );
  } else if (state.entry.pending?.status === "limit_reached") {
    // The effect above is opening the Paywall: nothing of the reflection meanwhile.
    body = <ReflectionLoading />;
  } else if (
    state.entry.status === "pending" ||
    state.entry.status === "uploading" ||
    state.entry.status === "processing"
  ) {
    body = <ReflectionPreparing onReturn={returnToJournal} />;
  } else if (state.entry.status === "ready" && state.entry.isCrisis && state.entry.devotional === null) {
    body = (
      <WordsOnlyView
        transcript={state.entry.transcript}
        isVoice={state.entry.inputType === "audio"}
        onReturn={returnToJournal}
        onDelete={() => {
          const opened = deletion.ask({ entryId: state.entry.id, answered: false, crisis: true });
          setDeleteOffline(!opened);
        }}
        deleteOffline={deleteOffline}
      />
    );
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
        audioPending={state.audioPending}
        initialTab={route.params.tab}
        onOpenPlayer={() => navigation.navigate("NowPlaying", { entryId: state.entry.id })}
        onReturn={returnToJournal}
        onSetTracked={state.setTracked}
        onDelete={() => {
          const opened = deletion.ask({
            entryId: state.entry.id,
            answered: state.entry.prayer?.isAnswered === true,
          });
          setDeleteOffline(!opened);
        }}
        deleteOffline={deleteOffline}
        addAffirmation={{
          onAdd: state.addAffirmation === null || !online ? null : () => void addOne(),
          remaining: Math.max(0, MAX_AFFIRMATIONS - state.affirmations.length),
          adding: state.adding,
          online,
          failed: addFailed,
        }}
      />
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ReflectionHeader
        date={state.status === "ready" ? formatEntryDate(state.entry.createdAt) : null}
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
