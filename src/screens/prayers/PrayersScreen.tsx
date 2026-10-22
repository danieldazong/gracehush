import { useScrollToTop } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActionSheetIOS,
  FlatList,
  Platform,
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

import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { PrayerCard } from "@/components/prayers/PrayerCard";
import { MarkAnsweredSheet } from "@/components/prayers/MarkAnsweredSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Skeleton } from "@/components/Skeleton";
import { copy } from "@/constants/copy";
import { colors, emotionColors, layout, radii } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePrayers } from "@/hooks/usePrayers";
import { useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps } from "@/navigation/types";
import type { Prayer, RepoResult } from "@/types";
import {
  calendarDaysBetween,
  formatEntryDate,
  formatShortDate,
  getPrayerTitle,
} from "@/utils/format";

type PrayerTab = "active" | "answered";
type Notice = "marked" | "failed";
type SheetMode = "mark" | "editNote";

const { tabs, notice: noticeText, menu, moveBack } = copy.prayers;

const icons = {
  prayer: { android: "volunteer_activism", ios: "hands.sparkles" },
  leaf: { android: "eco", ios: "leaf" },
  node: { android: "check", ios: "checkmark" },
  edit: { android: "edit", ios: "pencil" },
  moveBack: { android: "undo", ios: "arrow.uturn.backward" },
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

// The shape of the screen: the title, the tabs and three cards.
function LoadingState({ style, onLayout }: ListEmptyProps) {
  return (
    <View
      accessible
      accessibilityLabel={copy.prayers.loading}
      accessibilityState={{ busy: true }}
      style={style}
      onLayout={onLayout}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-5"
      >
        <Skeleton width="55%" height={28} radius={8} />
        <Skeleton height={52} radius={radii.full} />
        <View className="gap-4">
          <Skeleton height={190} />
          <Skeleton height={190} />
          <Skeleton height={190} />
        </View>
      </View>
    </View>
  );
}

function ErrorState({ onRetry, style, onLayout }: ListEmptyProps & { onRetry: () => void }) {
  return (
    <CenteredState style={style} onLayout={onLayout}>
      <View className="card w-full items-center gap-4">
        <Text className="text-center text-body text-ink">{copy.prayers.error.message}</Text>
        <PrimaryButton label={copy.prayers.error.retry} onPress={onRetry} />
      </View>
    </CenteredState>
  );
}

function EmptyState({ tab, style, onLayout }: ListEmptyProps & { tab: PrayerTab }) {
  const text = copy.prayers.empty[tab];

  return (
    <CenteredState style={style} onLayout={onLayout}>
      <View className="icon-tile">
        <Icon
          name={tab === "active" ? icons.prayer : icons.leaf}
          size={28}
          color={colors.plum}
        />
      </View>
      <Text className="text-center text-section text-ink">{text.title}</Text>
      <Text className="max-w-[320px] text-center text-body text-mauve">{text.body}</Text>
    </CenteredState>
  );
}

function AnsweredBanner({ count }: { count: number }) {
  return (
    <View className="card card--blush flex-row items-center gap-3 p-6">
      <View className="size-10 items-center justify-center rounded-full bg-grateful-bg">
        <Icon name={icons.leaf} size={20} color={emotionColors.grateful.fg} />
      </View>
      <View className="flex-1 gap-0.5">
        {/* 18/25 is a one-off: the type scale has no 18, and the next size up (20/28) makes three lines at 390dp where the design has two. */}
        <Text className="font-fraunces text-[18px] leading-[25px] text-plum-deep">
          {copy.prayers.banner.lead}
          <Text className="font-fraunces-medium text-hopeful-fg">
            {copy.prayers.banner.count(count)}
          </Text>
        </Text>
        <Text className="eyebrow">{copy.prayers.banner.caption}</Text>
      </View>
    </View>
  );
}

// The rail and the node are decoration, drawn with Views: a 2dp line through the centre of a 28dp node, whose
// centre is 10dp from the item's left edge and 16dp from its top.
function TimelineDecoration({ index, isLast }: { index: number; isLast: boolean }) {
  // Items after the first start at their top, so the rail meets the one running through the gap above; the
  // first starts at the node's centre. The last stops 24dp above its bottom.
  const top = index === 0 ? "top-4" : "top-0";
  const bottom = isLast ? "bottom-6" : "bottom-0";

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-0"
    >
      <View className={`absolute left-[9px] w-0.5 bg-petal ${top} ${bottom}`} />
      {/* The linen ring is the HTML's ring-4: it hides the rail behind the node. */}
      <View className="absolute -left-1 top-0.5 size-7 items-center justify-center rounded-full border-4 border-linen bg-terracotta">
        <Icon name={icons.node} size={12} color="white" />
      </View>
    </View>
  );
}

type TimelineItemProps = {
  prayer: Prayer;
  index: number;
  isLast: boolean;
  now: Date;
  children: ReactNode;
};

// One answered prayer on the timeline: the day it was answered and how long it took above its card.
function TimelineItem({ prayer, index, isLast, now, children }: TimelineItemProps) {
  const { answeredAt, createdAt } = prayer;
  // The year shows only when it is not this one.
  const date = answeredAt
    ? new Date(answeredAt).getFullYear() === now.getFullYear()
      ? formatShortDate(answeredAt)
      : formatEntryDate(answeredAt)
    : null;
  const afterDays = answeredAt
    ? Math.max(0, calendarDaysBetween(new Date(createdAt), new Date(answeredAt)))
    : null;

  return (
    <View className="pl-6">
      <TimelineDecoration index={index} isLast={isLast} />
      <View className="mb-2 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* Not the eyebrow class: a second colour utility does not reliably override it. */}
        <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.8px] text-hopeful-fg">
          {date ? copy.prayers.card.answeredOn(date) : copy.prayers.card.answered}
        </Text>
        {afterDays === null ? null : (
          <Text className="text-body-sm text-mauve">{copy.prayers.card.afterDays(afterDays)}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

// The rail through the 40dp gap between two items.
function TimelineSeparator() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="h-10"
    >
      <View className="absolute bottom-0 left-[9px] top-0 w-0.5 bg-petal" />
    </View>
  );
}

function CardGap() {
  return <View className="h-4" />;
}

export function PrayersScreen({ navigation }: MainTabScreenProps<"Prayers">) {
  const state = usePrayers();
  const { width } = useWindowDimensions();
  const paddingBottom = useTabScreenBottomPadding();
  const listRef = useRef<FlatList<Prayer>>(null);
  useScrollToTop(listRef);

  // Screen state, reset when the screen unmounts.
  const [tab, setTab] = useState<PrayerTab>("active");
  const [notice, setNotice] = useState<Notice | null>(null);
  // The Mark Answered sheet. Closing only flips `visible`, so the sheet slides out with its content, and each
  // opening gets a new key, so its form starts fresh.
  const [sheetTarget, setSheetTarget] = useState<{ prayer: Prayer; mode: SheetMode } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  // The overflow menu of an answered card: a sheet on Android (iOS has a native action sheet), then the
  // dialog that asks before a prayer moves back to Active.
  const [menuPrayer, setMenuPrayer] = useState<Prayer | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Prayer | null>(null);
  const [moving, setMoving] = useState(false);

  const ready = state.status === "ready" ? state : null;
  const noticeMessage =
    notice === "marked"
      ? noticeText.marked
      : notice === "failed"
        ? noticeText.failed
        : null;
  useAnnounce(noticeMessage);

  // A tab change shows the list from its top and clears the banner.
  function changeTab(next: PrayerTab) {
    setTab(next);
    setNotice(null);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function openSheet(prayer: Prayer, mode: SheetMode) {
    setSheetTarget({ prayer, mode });
    setSheetKey((key) => key + 1);
    setSheetVisible(true);
  }

  async function submitSheet(values: {
    answeredDate: string;
    note: string | null;
  }): Promise<RepoResult<Prayer>> {
    if (ready === null || sheetTarget === null) {
      return { ok: false, code: "UNKNOWN", message: copy.prayers.errors.save };
    }
    const { prayer, mode } = sheetTarget;
    if (mode === "editNote") {
      return ready.saveNote(prayer.id, values.note);
    }
    const result = await ready.markAnswered({
      prayerId: prayer.id,
      answeredDate: values.answeredDate,
      note: values.note,
    });
    // TODO(34): prayer_marked_answered { has_note: boolean }
    if (result.ok) setNotice("marked");
    return result;
  }

  function openMenu(prayer: Prayer) {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: getPrayerTitle(prayer),
          options: [menu.editNote, menu.moveBack, menu.cancel],
          cancelButtonIndex: 2,
          userInterfaceStyle: "light",
        },
        (index) => {
          if (index === 0) openSheet(prayer, "editNote");
          if (index === 1) setMoveTarget(prayer);
        },
      );
      return;
    }
    setMenuPrayer(prayer);
    setMenuVisible(true);
  }

  function chooseFromMenu(action: "editNote" | "moveBack") {
    setMenuVisible(false);
    if (menuPrayer === null) return;
    if (action === "editNote") openSheet(menuPrayer, "editNote");
    else setMoveTarget(menuPrayer);
  }

  async function confirmMoveBack() {
    if (ready === null || moveTarget === null || moving) return;
    setMoving(true);
    const result = await ready.unmarkAnswered(moveTarget.id);
    setMoving(false);
    setMoveTarget(null);
    if (!result.ok) setNotice("failed");
  }

  const visiblePrayers = ready ? (tab === "active" ? ready.active : ready.answered) : [];

  const header = ready ? (
    <View>
      <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Text accessibilityRole="header" className="text-headline text-plum-deep">
          {copy.prayers.title}
        </Text>
        {ready.counts.total > 0 ? (
          <Text className="eyebrow">{copy.prayers.recorded(ready.counts.total)}</Text>
        ) : null}
      </View>
      <View className="mt-2">
        <SegmentedControl
          accessibilityLabel={tabs.label}
          value={tab}
          onChange={changeTab}
          items={[
            {
              value: "active",
              label: tabs.active,
              count: ready.counts.active,
              accessibilityLabel: tabs.activeA11y(ready.counts.active),
            },
            {
              value: "answered",
              label: tabs.answered,
              count: ready.counts.answered,
              accessibilityLabel: tabs.answeredA11y(ready.counts.answered),
            },
          ]}
        />
      </View>
      {noticeMessage ? (
        <View
          accessibilityLiveRegion="polite"
          className="card card--blush mt-4 flex-row flex-wrap items-center gap-x-3 gap-y-2"
        >
          <Text className="text-body text-ink">{noticeMessage}</Text>
          {notice === "marked" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={noticeText.view}
              onPress={() => changeTab("answered")}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="min-h-11 justify-center">
                {/* plum, not rosewood: a text link on a blush surface is plum (AGENTS.md, colors) */}
                <Text className="btn-text__label text-plum">{noticeText.view}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {tab === "answered" && ready.counts.answered > 0 ? (
        <View className="mt-6">
          <AnsweredBanner count={ready.counts.answered} />
        </View>
      ) : null}
      <View className="h-6" />
    </View>
  ) : null;

  let emptyState: ReactElement | null = null;
  if (state.status === "loading") {
    emptyState = <LoadingState />;
  } else if (state.status === "error") {
    emptyState = <ErrorState onRetry={state.retry} />;
  } else if (visiblePrayers.length === 0) {
    emptyState = <EmptyState tab={tab} />;
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.prayers} />
      <FlatList
        ref={listRef}
        data={visiblePrayers}
        keyExtractor={(prayer) => prayer.id}
        renderItem={({ item, index }) => {
          if (ready === null) return null;
          if (tab === "active") {
            return (
              <PrayerCard
                variant="active"
                prayer={item}
                now={ready.now}
                onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
                onMarkAnswered={(prayer) => openSheet(prayer, "mark")}
              />
            );
          }
          return (
            <TimelineItem
              prayer={item}
              index={index}
              isLast={index === ready.answered.length - 1}
              now={ready.now}
            >
              <PrayerCard
                variant="answered"
                prayer={item}
                onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
                onOpenMenu={openMenu}
                onAddNote={(prayer) => openSheet(prayer, "editNote")}
              />
            </TimelineItem>
          );
        }}
        // The days on the cards follow `now`, which is not part of the data.
        extraData={ready?.now}
        ItemSeparatorComponent={tab === "answered" ? TimelineSeparator : CardGap}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal:
            width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding,
          paddingTop: 8,
          paddingBottom,
        }}
        refreshControl={
          ready ? (
            <RefreshControl
              refreshing={ready.refreshing}
              onRefresh={() => {
                setNotice(null);
                ready.refresh();
              }}
              tintColor={colors.plum}
              colors={[colors.plum]}
            />
          ) : undefined
        }
      />
      {sheetTarget ? (
        <MarkAnsweredSheet
          key={sheetKey}
          prayer={sheetTarget.prayer}
          mode={sheetTarget.mode}
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          onSubmit={submitSheet}
        />
      ) : null}
      {Platform.OS === "android" ? (
        <BottomSheet visible={menuVisible} onClose={() => setMenuVisible(false)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={menu.editNote}
            onPress={() => chooseFromMenu("editNote")}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="list-row">
              <Icon name={icons.edit} size={22} color={colors.plum} />
              <Text className="text-body text-ink">{menu.editNote}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={menu.moveBack}
            onPress={() => chooseFromMenu("moveBack")}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="list-row">
              <Icon name={icons.moveBack} size={22} color={colors.plum} />
              <Text className="text-body text-ink">{menu.moveBack}</Text>
            </View>
          </Pressable>
        </BottomSheet>
      ) : null}
      <ConfirmDialog
        visible={moveTarget !== null}
        title={moveBack.title}
        body={moveBack.body}
        confirmLabel={moveBack.confirm}
        cancelLabel={moveBack.cancel}
        loading={moving}
        onConfirm={confirmMoveBack}
        onCancel={() => setMoveTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  pressed: { opacity: 0.7 },
});
