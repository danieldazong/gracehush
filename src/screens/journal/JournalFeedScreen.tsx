import { useUser } from "@clerk/expo";
import { useIsFocused, useScrollToTop } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnalyticsConsentCard } from "@/components/AnalyticsConsentCard";
import { Icon } from "@/components/Icon";
import { JournalCard } from "@/components/JournalCard";
import { NoticeBanner } from "@/components/NoticeBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingReviewDialog } from "@/components/PendingReviewDialog";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ShareSheet } from "@/components/ShareSheet";
import { Skeleton } from "@/components/Skeleton";
import { Toast } from "@/components/Toast";
import { CaptureBar } from "@/components/today/CaptureBar";
import { ListenAgainCard } from "@/components/today/ListenAgainCard";
import { TodayHero } from "@/components/today/TodayHero";
import { WeekStrip } from "@/components/today/WeekStrip";
import { WordStack } from "@/components/today/WordStack";
import { copy } from "@/constants/copy";
import { analyticsEnv } from "@/constants/env";
import { colors, layout } from "@/constants/theme";
import {
  filterEntries,
  getAffirmationForSlot,
  getGreeting,
  getListenAgainEntry,
  getPlaybackTrack,
  getPlayerSceneForHour,
  getUnsentCount,
  getWeekDots,
  getWordStack,
  type JournalFilter,
  type WordStackCard,
} from "@/data/selectors";
import { useAiPermission } from "@/hooks/useAiPermission";
import { useJournalHome } from "@/hooks/useJournalHome";
import { useShareSheet } from "@/hooks/useShareSheet";
import { useTabBarClearance } from "@/hooks/useTabScreenBottomPadding";
import { useWordShare } from "@/hooks/useWordShare";
import type { MainTabScreenProps } from "@/navigation/types";
import { track } from "@/services/analytics";
import { discardItem } from "@/services/syncEngine";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";
import type { HomeEntry } from "@/types";
import {
  flowVerse,
  formatLongDate,
  formatTime12,
  getAffirmationSource,
  getDisplayName,
  quoteVerse,
} from "@/utils/format";
import { deckScenes } from "@/utils/sceneMatch";

import { JournalFilterSheet } from "./JournalFilterSheet";

const SYNCED_TOAST_MS = 2500;

// The HTML's gap between its state toggle and the greeting. The toggle is not built, the gap stays.
const LIST_TOP_PADDING = 20;

// The Today tab has no dock (the hero's orb is the way in), so its content ends the bar's clearance and this much air above it.
const BOTTOM_AIR = 36;

const icons = {
  filter: { android: "tune", ios: "slider.horizontal.3" },
} satisfies Record<string, SymbolViewProps["name"]>;

// FlatList clones ListEmptyComponent with a style and an onLayout, so each state forwards both to its root.
type ListEmptyProps = {
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
};

function CenteredState({ style, onLayout, children }: ListEmptyProps & { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center gap-4" style={style} onLayout={onLayout}>
      {children}
    </View>
  );
}

function LoadingState({ style, onLayout }: ListEmptyProps) {
  return (
    <View
      accessible
      accessibilityLabel={copy.journal.loading}
      accessibilityState={{ busy: true }}
      style={style}
      onLayout={onLayout}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-5"
      >
        <Skeleton height={180} />
        <View className="gap-3.5">
          <Skeleton height={130} />
          <Skeleton height={130} />
          <Skeleton height={130} />
        </View>
      </View>
    </View>
  );
}

function ErrorState({ onRetry, style, onLayout }: ListEmptyProps & { onRetry: () => void }) {
  return (
    <CenteredState style={style} onLayout={onLayout}>
      <View className="card w-full items-center gap-4">
        <Text className="text-center text-body text-ink">{copy.journal.error.message}</Text>
        <PrimaryButton label={copy.journal.error.retry} onPress={onRetry} />
      </View>
    </CenteredState>
  );
}

// New people see the hero above and have nothing to press here: the empty list says what will gather and stays quiet.
function EmptyState({ style, onLayout }: ListEmptyProps) {
  return (
    <View className="items-center gap-1.5 px-6 pt-2" style={style} onLayout={onLayout}>
      <Text accessibilityRole="header" className="text-center text-section tracking-[-0.5px] text-ink">
        {copy.journal.empty.title}
      </Text>
      <Text className="max-w-[320px] text-center text-body text-mauve">{copy.journal.empty.body}</Text>
    </View>
  );
}

function FilteredEmptyState({ onClear, style, onLayout }: ListEmptyProps & { onClear: () => void }) {
  return (
    <CenteredState style={style} onLayout={onLayout}>
      <Text className="text-center text-body text-mauve">{copy.journal.filteredEmpty.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.journal.filteredEmpty.clear}
        className="min-h-11 items-center justify-center"
        onPress={onClear}
      >
        <Text className="btn-text__label btn-text__label--rosewood">
          {copy.journal.filteredEmpty.clear}
        </Text>
      </Pressable>
    </CenteredState>
  );
}

// The greeting while the data loads: the hero under it does not wait for the data.
function GreetingSkeleton() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="gap-1 pt-1"
    >
      <Skeleton width="35%" height={16} radius={8} />
      <Skeleton width="60%" height={28} radius={8} />
    </View>
  );
}

type GreetingBlockProps = {
  now: Date;
  name: string | null;
};

function GreetingBlock({ now, name }: GreetingBlockProps) {
  return (
    <View className="pt-1">
      {/* The date as a small muted eyebrow above the greeting (2026-11-01, the user's request: the date and the streak
          had shared one line under it, at two heights, which read as clutter). */}
      <Text className="font-dm-bold text-[11px] leading-[16px] uppercase tracking-[0.8px] text-mauve">
        {formatLongDate(now)}
      </Text>
      {/* A welcome, not the screen's headline: it takes the content's heading size ("Your Reflections", the
          word card's section heading), under the 22-px wordmark. The days of reflection are the week strip's now
          (2026-11-16), which replaced the tag that sat at this row's right edge. */}
      <Text
        accessibilityRole="header"
        accessibilityLabel={copy.journal.greeting(getGreeting(now), name)}
        className="mt-1 text-section tracking-[-0.5px] text-plum-deep"
      >
        {copy.journal.greetingPrefix(getGreeting(now), name !== null)}
        {/* The name in rosewood (2026-11-01): the one personal word on the screen, in the brand's second colour. */}
        {name !== null ? <Text className="text-rosewood"> {name}</Text> : null}
      </Text>
    </View>
  );
}

type SectionRowProps = {
  count: number;
  // The name of the filter that is on, or null for All.
  filterName: string | null;
  onFilter: () => void;
};

function SectionRow({ count, filterName, onFilter }: SectionRowProps) {
  const { section, filter } = copy.journal;

  return (
    <View className="flex-row items-center gap-2 pt-1">
      <View className="flex-1 flex-row flex-wrap items-baseline gap-x-2">
        <Text accessibilityRole="header" className="text-section tracking-[-0.5px] text-ink">
          {section.title}
        </Text>
        <Text className="text-label-md text-mauve">{section.entryCount(count)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={filterName ? filter.showing(filterName) : filter.title}
        // The label is 18 tall, so 13 above and below makes a 44 touch area.
        hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }}
        onPress={onFilter}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="shrink-0 flex-row items-center gap-1">
          <Text
            className={
              filterName
                ? "font-dm-semibold text-[13px] leading-[18px] text-plum-deep"
                : "text-label-md text-plum-deep"
            }
          >
            {filterName ? section.filterOn : section.filter}
          </Text>
          <Icon name={icons.filter} size={16} color={colors.plumDeep} />
        </View>
      </Pressable>
    </View>
  );
}

function ItemSeparator() {
  return <View className="h-3.5" />;
}

// The small spinner under the last card while the next page of older entries comes (step 25).
function LoadingMore() {
  return (
    <View
      accessible
      accessibilityLabel={copy.journal.loadingMore}
      accessibilityState={{ busy: true }}
      className="items-center py-5"
    >
      <ActivityIndicator size="small" color={colors.plum} />
    </View>
  );
}

export function JournalFeedScreen({ navigation }: MainTabScreenProps<"Journal">) {
  const { user } = useUser();
  const state = useJournalHome();
  const { allowed: aiAllowed } = useAiPermission();
  const { width, fontScale } = useWindowDimensions();
  // The list's side padding. It also gives the word card its width, which the picture of the card is drawn at.
  const sidePadding = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const barClearance = useTabBarClearance();
  const shareSheet = useShareSheet();
  const wordShare = useWordShare();
  const paddingBottom = barClearance + BOTTOM_AIR;
  const focused = useIsFocused();
  // Blocks a second tap before New Entry has taken focus, as the dock did. It resets when the tab is in front again.
  const opening = useRef(false);
  useEffect(() => {
    if (focused) {
      opening.current = false;
    }
  }, [focused]);
  function openNewEntry(mode: "speak" | "write") {
    if (opening.current) {
      return;
    }
    opening.current = true;
    navigation.navigate("NewEntry", { mode });
  }
  const listRef = useRef<FlatList<HomeEntry>>(null);
  useScrollToTop(listRef);

  // Screen state, reset when the screen unmounts.
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [sheetVisible, setSheetVisible] = useState(false);
  // The refused reflection whose "Review" was tapped.
  const [reviewing, setReviewing] = useState<HomeEntry | null>(null);
  // The card of the deck whose picture is being made for sharing: its Share button shows the spinner.
  const [sharingId, setSharingId] = useState<string | null>(null);

  // The analytics question, once, on the first visit after sign-in (2026-11-01, round 8; until then onboarding's fourth
  // step): shown while the device has not answered and a PostHog token is set. Sharing also sends the first event, as the
  // step did; an unanswered card means no, as before.
  const analyticsConsent = useOnboardingStore((state) => state.analyticsConsent);
  const setAnalyticsConsent = useOnboardingStore((state) => state.setAnalyticsConsent);
  const askConsent = analyticsEnv.status === "ok" && analyticsConsent === "unset";
  function chooseAnalytics(choice: "granted" | "declined") {
    setAnalyticsConsent(choice);
    if (choice === "granted") {
      track("onboarding_completed", {
        permissions_prompted: useOnboardingStore.getState().permissionsPromptedAt !== null,
      });
    }
  }

  // The synced toast shows when the device goes from offline to online and nothing is left to send. The previous
  // value is kept in state and compared during render, and only while the data is ready: a scenario switch shows the
  // skeleton in between, and it must still count as offline to online. With reflections still waiting, "All
  // reflections synced" would not be true yet: their cards change instead.
  const unsentCount = state.status === "ready" ? getUnsentCount(state.entries) : 0;
  const isOffline = state.status === "ready" ? state.isOffline : null;
  const [wasOffline, setWasOffline] = useState(false);
  const [syncedVisible, setSyncedVisible] = useState(false);
  if (isOffline !== null && isOffline !== wasOffline) {
    setWasOffline(isOffline);
    if (wasOffline) {
      setSyncedVisible(unsentCount === 0);
    }
  }
  useEffect(() => {
    if (!syncedVisible) {
      return undefined;
    }
    const timer = setTimeout(() => setSyncedVisible(false), SYNCED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [syncedVisible]);

  const ready = state.status === "ready" ? state : null;
  const visibleEntries = ready ? filterEntries(ready.entries, filter) : [];
  const hasNoEntries = ready !== null && ready.entries.length === 0;

  // Share on a card of the deck sends the card itself, as a picture (2026-11-20), drawn with the card's own scene. A heavy
  // moment's word keeps the text share it had, and so does a word whose reflection this screen does not hold: what leaves the
  // app for a heavy moment is the owner's to change.
  function shareWord(card: WordStackCard, scene: number) {
    const { affirmation } = card;
    const verse = affirmation.verse;
    if (!verse) return;
    const asPicture = card.entry !== null && !card.entry.isCrisis;
    // The verse as text, the way Reflection shares it: also where no picture can be made (Expo Go, Android) or the drawing
    // fails.
    const asText = () =>
      shareSheet.share(copy.reflection.share.message(quoteVerse(verse.text), verse.reference));
    if (!asPicture) {
      asText();
      return;
    }
    // One picture at a time: a press on another card while one is being made does nothing.
    if (wordShare.preparing) return;
    setSharingId(affirmation.id);
    void wordShare.share(
      {
        headline: affirmation.headline,
        detail: quoteVerse(flowVerse(verse.text)),
        reference: copy.affirmationVerse.reference(verse.reference),
        scene,
        width: width - 2 * sidePadding,
        fontScale,
      },
      asText,
    );
  }

  // The deck of words (2026-11-20). On top lies today's word, on the painted scene that interprets its reflection (deckScenes;
  // the hour's scene when the screen does not hold the reflection): since 2026-11-17 the word the last
  // reminder carried, from the Word Deck's calendar (the reflections of the week take turns, and the card agrees with the lock
  // screen, notifications on or off), and without one (the calendar has none, or the phone no longer holds that word) the newest
  // reflection's affirmation for the current slot, as before. Behind it lies one card for each earlier reflection, newest
  // first, and a swipe turns them. A person with no reflection has no affirmation, and sees the hero.
  let wordStack: ReactElement | null = null;
  if (ready && !hasNoEntries) {
    const word = ready.word;
    const fallback = word === null ? getAffirmationForSlot(ready.affirmations, ready.currentSlot) : null;
    const affirmation = word?.affirmation ?? fallback;
    // The slot is the one the word was delivered at, which is not always its own.
    const slot = word?.slot ?? fallback?.slot ?? null;
    if (affirmation && slot) {
      const source =
        word !== null ? word.entry : (ready.entries.find((entry) => entry.id === affirmation.entryId) ?? null);
      const cards = getWordStack({ affirmation, entry: source, slot }, ready.entries, ready.words);
      wordStack = (
        <WordStack
          cards={cards}
          scenes={deckScenes(
            cards.map((card) => card.entry),
            getPlayerSceneForHour(ready.now.getHours()),
          )}
          pageWidth={width}
          side={sidePadding}
          // Shown where the verse's reference would be, for an affirmation with no verse: today's word says when it came,
          // an earlier card what it is tied to.
          footer={(card) =>
            card.slot !== null
              ? copy.journal.affirmation.footer(
                  formatTime12(ready.profile.reminders[card.slot]),
                  card.entry ? getAffirmationSource(card.entry.createdAt, ready.now) : null,
                )
              : card.entry
                ? copy.today.word.tiedTo(getAffirmationSource(card.entry.createdAt, ready.now))
                : ""
          }
          sharing={wordShare.preparing ? sharingId : null}
          saveFailed={ready.favoriteFailed}
          onOpen={(card) => navigation.navigate("Reflection", { entryId: card.affirmation.entryId, tab: "affirmations" })}
          onToggleFavorite={(card) => ready.toggleFavorite(card.affirmation)}
          onShare={shareWord}
          onNearEnd={ready.loadMore}
        />
      );
    }
  }

  // The latest devotional that can be played, for the "Listen again" row. A heavy moment is never put on the first screen.
  const listenEntry = ready ? getListenAgainEntry(ready.entries) : null;
  const listenTrack = listenEntry ? getPlaybackTrack(listenEntry) : null;

  // What the mini player's play button does, then the reflection opens with its player showing: a Journal card's play pill
  // and the "Listen again" row. The player is read without subscribing: this screen must not redraw on every tick of the clock.
  function playEntry(entry: HomeEntry) {
    if (!ready) return;
    const track = getPlaybackTrack(entry);
    if (track === null) return;
    const player = usePlayerStore.getState();
    player.load(track, ready.profile);
    player.play();
    navigation.navigate("Reflection", { entryId: entry.id });
  }

  let greeting: ReactElement | null = null;
  if (ready) {
    const weekDots = getWeekDots(ready.entries, ready.now, ready.profile.timezone);
    greeting = (
      <View className="gap-4">
        <GreetingBlock
          now={ready.now}
          name={getDisplayName({
            firstName: user?.firstName,
            email: user?.primaryEmailAddress?.emailAddress,
          })}
        />
        {/* The week appears once one of its days is filled: a week with nothing in it is not drawn, so it never reads as a blank. */}
        {weekDots.some((dot) => dot.reflected) ? (
          <WeekStrip dots={weekDots} streakDays={ready.reflectionDays} />
        ) : null}
      </View>
    );
  } else if (state.status === "loading") {
    greeting = <GreetingSkeleton />;
  }

  // The way in needs no data, so it is drawn in every state: the person can start while the rest loads. A new person (no
  // reflection yet) sees the hero, the one big orb; everyone else sees the word card first and the compact capture bar under
  // it (2026-11-16). While the data loads, or if it could not be loaded, the compact bar stands in: it is the action at its
  // smallest, and the hero only grows in once, for a person who has none.
  const wayIn = hasNoEntries ? (
    <TodayHero
      active={focused}
      onSpeak={() => openNewEntry("speak")}
      onWrite={() => openNewEntry("write")}
    />
  ) : (
    <CaptureBar
      active={focused}
      onSpeak={() => openNewEntry("speak")}
      onWrite={() => openNewEntry("write")}
    />
  );
  const header = (
    <View className="gap-6 pb-6">
      {greeting}
      {/* While the person's permission is off nothing will go by itself when the phone reconnects. */}
      {ready?.isOffline ? <OfflineBanner unsyncedCount={aiAllowed ? unsentCount : 0} /> : null}
      {ready && ready.savedNote !== null ? (
        <NoticeBanner message={copy.journal.notes[ready.savedNote]} onDismiss={ready.dismissNote} />
      ) : null}
      {wordStack}
      {wayIn}
      {ready && askConsent ? (
        <AnalyticsConsentCard onShare={() => chooseAnalytics("granted")} onNotNow={() => chooseAnalytics("declined")} />
      ) : null}
      {listenEntry && listenTrack ? (
        <ListenAgainCard
          title={listenTrack.title}
          reference={listenEntry.scripture?.reference ?? null}
          durationMs={listenTrack.durationMs}
          onPlay={() => playEntry(listenEntry)}
        />
      ) : null}
      {ready && !hasNoEntries ? (
        <SectionRow
          count={filter === "all" ? ready.entryCount : visibleEntries.length}
          filterName={filter === "all" ? null : copy.journal.filter.chips[filter]}
          onFilter={() => setSheetVisible(true)}
        />
      ) : null}
    </View>
  );

  let emptyState: ReactElement | null = null;
  if (state.status === "loading") {
    emptyState = <LoadingState />;
  } else if (state.status === "error") {
    emptyState = <ErrorState onRetry={state.retry} />;
  } else if (hasNoEntries) {
    emptyState = <EmptyState />;
  } else if (visibleEntries.length === 0) {
    emptyState = <FilteredEmptyState onClear={() => setFilter("all")} />;
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.today} />
      <FlatList
        ref={listRef}
        data={visibleEntries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) =>
          ready ? (
            <JournalCard
              entry={item}
              now={ready.now}
              online={ready.isOffline ? false : ready.isOnline}
              heldForPermission={!aiAllowed}
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
              onPlay={playEntry}
              onReview={setReviewing}
              onUnlock={(entry) =>
                navigation.navigate("Paywall", {
                  source: "limit",
                  entryId: entry.pending?.serverEntryId ?? entry.id,
                })
              }
            />
          ) : null
        }
        // The card timestamps follow `now`, which is not part of the data.
        extraData={ready?.now}
        ItemSeparatorComponent={ItemSeparator}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState ?? undefined}
        ListFooterComponent={ready?.loadingMore ? <LoadingMore /> : undefined}
        onEndReached={ready ? ready.loadMore : undefined}
        onEndReachedThreshold={0.5}
        // The content runs under the floating tab bar; the indicator stops above it.
        scrollIndicatorInsets={{ bottom: barClearance }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: sidePadding,
          paddingTop: LIST_TOP_PADDING,
          paddingBottom,
        }}
        refreshControl={
          ready ? (
            <RefreshControl
              refreshing={ready.refreshing}
              onRefresh={ready.refresh}
              tintColor={colors.plum}
              colors={[colors.plum]}
            />
          ) : undefined
        }
      />
      <Toast message={copy.journal.synced} visible={syncedVisible} />
      <ShareSheet text={shareSheet.text} whatsApp={shareSheet.whatsApp} onClose={shareSheet.close} />
      <JournalFilterSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        filter={filter}
        onChange={setFilter}
        count={visibleEntries.length}
      />
      <PendingReviewDialog
        entry={reviewing}
        onClose={() => setReviewing(null)}
        onEdit={(clientEntryId) => {
          setReviewing(null);
          navigation.navigate("NewEntry", { mode: "write", resend: clientEntryId });
        }}
        onDelete={discardItem}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  pressed: { opacity: 0.6 },
});
