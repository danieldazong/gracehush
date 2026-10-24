import { useUser } from "@clerk/expo";
import { useScrollToTop } from "@react-navigation/native";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
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

import { AffirmationCard } from "@/components/AffirmationCard";
import { Icon } from "@/components/Icon";
import { JournalCard } from "@/components/JournalCard";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/Skeleton";
import { Toast } from "@/components/Toast";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, layout } from "@/constants/theme";
import {
  filterEntries,
  getAffirmationForSlot,
  getGreeting,
  type JournalFilter,
} from "@/data/selectors";
import { useJournalHome } from "@/hooks/useJournalHome";
import { useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps } from "@/navigation/types";
import type { JournalEntry } from "@/types";
import {
  formatLongDate,
  formatTime12,
  getAffirmationSource,
  getDisplayName,
} from "@/utils/format";

import { JournalFilterSheet } from "./JournalFilterSheet";

const SYNCED_TOAST_MS = 2500;

// The HTML's gap between its state toggle and the greeting. The toggle is not built, the gap stays.
const LIST_TOP_PADDING = 20;

const icons = {
  sun: { android: "wb_sunny", ios: "sun.max.fill" },
  filter: { android: "tune", ios: "slider.horizontal.3" },
  mic: { android: "mic", ios: "mic.fill" },
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
        <View className="gap-2 pt-1">
          <Skeleton width="60%" height={28} radius={8} />
          <Skeleton width="40%" height={14} radius={8} />
        </View>
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

function EmptyState({ onRecord, style, onLayout }: ListEmptyProps & { onRecord: () => void }) {
  return (
    <CenteredState style={style} onLayout={onLayout}>
      <View className="size-24 items-center justify-center rounded-full border border-petal bg-blush">
        <Image
          source={images.logoMark}
          contentFit="contain"
          tintColor={colors.rosewood}
          style={styles.emptyMark}
        />
      </View>
      <Text className="text-section text-ink">{copy.journal.empty.title}</Text>
      <Text className="max-w-[320px] text-center text-body text-mauve">
        {copy.journal.empty.body}
      </Text>
      <PrimaryButton label={copy.journal.empty.action} iconLeft={icons.mic} onPress={onRecord} />
    </CenteredState>
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

type GreetingBlockProps = {
  now: Date;
  name: string | null;
  reflectionDays: number;
};

function GreetingBlock({ now, name, reflectionDays }: GreetingBlockProps) {
  return (
    <View className="pt-1">
      <Text accessibilityRole="header" className="text-title tracking-[-0.7px] text-plum-deep">
        {copy.journal.greeting(getGreeting(now), name)}
      </Text>
      {/* The date and the streak share a line, so the greeting keeps the full width. They wrap under each other when they do not fit. */}
      <View className="mt-1.5 flex-row flex-wrap items-center gap-x-3 gap-y-2">
        <Text className="text-body-sm text-mauve">{formatLongDate(now)}</Text>
        {reflectionDays > 0 ? (
          <View className="chip chip--terracotta shrink-0 gap-1.5 border border-terracotta/25">
            <Icon name={icons.sun} size={15} color={colors.terracotta} />
            <Text className="chip__label chip__label--terracotta">
              {copy.journal.reflectionDays(reflectionDays)}
            </Text>
          </View>
        ) : null}
      </View>
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

export function JournalFeedScreen({ navigation }: MainTabScreenProps<"Journal">) {
  const { user } = useUser();
  const state = useJournalHome();
  const { width } = useWindowDimensions();
  const paddingBottom = useTabScreenBottomPadding();
  const listRef = useRef<FlatList<JournalEntry>>(null);
  useScrollToTop(listRef);

  // Screen state, reset when the screen unmounts.
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [sheetVisible, setSheetVisible] = useState(false);

  // The synced toast shows when the device goes from offline to online. The previous value is kept in
  // state and compared during render, and only while the data is ready: a scenario switch shows the
  // skeleton in between, and it must still count as offline to online.
  const isOffline = state.status === "ready" ? state.isOffline : null;
  const [wasOffline, setWasOffline] = useState(false);
  const [syncedVisible, setSyncedVisible] = useState(false);
  if (isOffline !== null && isOffline !== wasOffline) {
    setWasOffline(isOffline);
    if (wasOffline) {
      setSyncedVisible(true);
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

  let affirmationCard: ReactElement | null = null;
  if (ready) {
    const affirmation = getAffirmationForSlot(ready.affirmations, ready.currentSlot);
    if (affirmation) {
      const source = ready.entries.find((entry) => entry.id === affirmation.entryId);
      affirmationCard = (
        <AffirmationCard
          key={affirmation.id}
          affirmation={affirmation}
          footer={copy.journal.affirmation.footer(
            formatTime12(ready.profile.reminders[affirmation.slot]),
            source ? getAffirmationSource(source.createdAt, ready.now) : null,
          )}
        />
      );
    }
  }

  const header = ready ? (
    <View className="gap-5 pb-5">
      <GreetingBlock
        now={ready.now}
        name={getDisplayName({
          firstName: user?.firstName,
          email: user?.primaryEmailAddress?.emailAddress,
        })}
        reflectionDays={ready.reflectionDays}
      />
      {ready.isOffline ? (
        <OfflineBanner unsyncedCount={ready.entries.filter((entry) => entry.isLocalOnly).length} />
      ) : null}
      {affirmationCard}
      {hasNoEntries ? null : (
        <SectionRow
          count={visibleEntries.length}
          filterName={filter === "all" ? null : copy.journal.filter.chips[filter]}
          onFilter={() => setSheetVisible(true)}
        />
      )}
    </View>
  ) : null;

  let emptyState: ReactElement | null = null;
  if (state.status === "loading") {
    emptyState = <LoadingState />;
  } else if (state.status === "error") {
    emptyState = <ErrorState onRetry={state.retry} />;
  } else if (hasNoEntries) {
    emptyState = <EmptyState onRecord={() => navigation.navigate("NewEntry", { mode: "speak" })} />;
  } else if (visibleEntries.length === 0) {
    emptyState = <FilteredEmptyState onClear={() => setFilter("all")} />;
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.journal} />
      <FlatList
        ref={listRef}
        data={visibleEntries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) =>
          ready ? (
            <JournalCard
              entry={item}
              now={ready.now}
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
            />
          ) : null
        }
        // The card timestamps follow `now`, which is not part of the data.
        extraData={ready?.now}
        ItemSeparatorComponent={ItemSeparator}
        ListHeaderComponent={header ?? undefined}
        ListEmptyComponent={emptyState ?? undefined}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal:
            width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding,
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
      <JournalFilterSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        filter={filter}
        onChange={setFilter}
        count={visibleEntries.length}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  emptyMark: { width: 44, height: 44 },
  pressed: { opacity: 0.6 },
});
