import { useScrollToTop } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import {
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
import { DeleteReflectionDialog } from "@/components/DeleteReflectionDialog";
import { Icon } from "@/components/Icon";
import { PrayerCard } from "@/components/prayers/PrayerCard";
import { MarkAnsweredSheet } from "@/components/prayers/MarkAnsweredSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Skeleton } from "@/components/Skeleton";
import { MODAL_HANDOFF_FALLBACK_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, emotionColors, layout, radii, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useDeleteReflection } from "@/hooks/useDeleteReflection";
import { usePrayers } from "@/hooks/usePrayers";
import { useTabBarClearance, useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps } from "@/navigation/types";
import { useNoticeStore } from "@/store/noticeStore";
import type { Prayer, RepoResult } from "@/types";
import { calendarDaysBetween, getPrayerTitle } from "@/utils/format";
import { answeredLocalDate, formatAnsweredDay } from "@/utils/prayerDates";
import { getPrayerMenu, type PrayerMenuAction } from "@/utils/prayerMenu";

type PrayerTab = "active" | "answered";
type Notice = "marked" | "failed" | "removed" | "deleted" | "offline";
type SheetMode = "mark" | "editNote";

const { tabs, notice: noticeText, moveBack, removeFromPrayers: removeText } = copy.prayers;

const icons = {
  prayer: { android: "volunteer_activism", ios: "hands.sparkles" },
  leaf: { android: "eco", ios: "leaf" },
  node: { android: "check", ios: "checkmark" },
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
  // The answered day is a calendar day (utils/prayerDates.ts): the same day in every time zone.
  const answeredDay = answeredAt ? answeredLocalDate(answeredAt) : null;
  // The year shows only when it is not this one.
  const date =
    answeredAt && answeredDay
      ? formatAnsweredDay(answeredAt, answeredDay.getFullYear() !== now.getFullYear())
      : null;
  const afterDays = answeredDay
    ? Math.max(0, calendarDaysBetween(new Date(createdAt), answeredDay))
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
  const barClearance = useTabBarClearance();
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
  // The ⋯ menu of a prayer (the app's own sheet on both platforms), then the dialog that asks before a prayer moves back to
  // Active.
  const [menuPrayer, setMenuPrayer] = useState<Prayer | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Prayer | null>(null);
  const [moving, setMoving] = useState(false);
  // The tab the open menu belongs to decides its items (step 29b): an answered prayer also edits its note and moves back.
  const [menuTab, setMenuTab] = useState<PrayerTab>("active");
  // What was chosen in the menu, waiting for the sheet to finish closing. Most choices open another Modal (a dialog, the Mark
  // Answered sheet), and iOS cannot present one while another is still on its way out, so there the choice goes on from the
  // sheet's onDismiss (or from a timer, if iOS never reports it). Android overlaps its dialogs fine and goes on at once.
  const afterMenu = useRef<(() => void) | null>(null);
  // The widest label of the menu so far. Every label gets that width as a minimum, so the icons line up in one column and the
  // labels start at one edge, while the icon and label of a row stay together as one group centered in the card. It only grows
  // (a label measured wider raises it), so it never settles on a width that is too small, and it needs no reset.
  const [menuLabelWidth, setMenuLabelWidth] = useState(0);
  // An answered prayer asks before it is removed from Prayers (its date and note go with it); an Active one does not.
  const [removeTarget, setRemoveTarget] = useState<Prayer | null>(null);
  const [removing, setRemoving] = useState(false);
  // Delete reflection… (step 29b). The dialog is shared with Reflection. With no connection nothing opens and the banner says why.
  const deletion = useDeleteReflection(() => setNotice("deleted"));

  const ready = state.status === "ready" ? state : null;
  // A change the server refused for good (step 29) says the same as one that failed here.
  const refused = useNoticeStore((store) => store.prayerChangeFailed !== null);
  const noticeMessage =
    notice === "marked"
      ? noticeText.marked
      : notice === "removed"
        ? noticeText.removed
        : notice === "deleted"
          ? noticeText.deleted
          : notice === "offline"
            ? copy.deleteReflection.offline
            : notice === "failed" || refused
              ? noticeText.failed
              : null;
  useAnnounce(noticeMessage);

  function clearNotice() {
    setNotice(null);
    useNoticeStore.getState().clearPrayerChangeFailed();
  }

  // A tab change shows the list from its top and clears the banner.
  function changeTab(next: PrayerTab) {
    setTab(next);
    clearNotice();
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

  // The menu is the app's own sheet on both platforms (utils/prayerMenu.ts lists its items), not the iPhone's native action
  // sheet: that one draws system blue and system red, which are not in the palette (DESIGN.md: sheets are blush, and the
  // destructive colour is Crisis Red).
  function openMenu(prayer: Prayer, from: PrayerTab) {
    setMenuPrayer(prayer);
    setMenuTab(from);
    setMenuVisible(true);
  }

  function runAfterMenu() {
    const run = afterMenu.current;
    afterMenu.current = null;
    run?.();
  }

  function pickFromMenu(prayer: Prayer, action: PrayerMenuAction) {
    setMenuVisible(false);
    afterMenu.current = () => chooseFromMenu(prayer, action);
    if (Platform.OS === "ios") setTimeout(runAfterMenu, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterMenu();
  }

  function chooseFromMenu(prayer: Prayer, action: PrayerMenuAction) {
    if (action === "editNote") openSheet(prayer, "editNote");
    else if (action === "moveBack") setMoveTarget(prayer);
    else if (action === "remove") askRemove(prayer);
    else askDelete(prayer);
  }

  // Remove from Prayers: the reflection stays in the Journal. An Active prayer loses only its flag, so it goes at once; an
  // answered one also loses its date and gratitude note, so it asks first.
  function askRemove(prayer: Prayer) {
    if (prayer.isAnswered) setRemoveTarget(prayer);
    else void removeNow(prayer);
  }

  async function removeNow(prayer: Prayer) {
    if (ready === null) return;
    const result = await ready.removeFromPrayers(prayer.id);
    // TODO(34): prayer_removed { was_answered: boolean }
    setNotice(result.ok ? "removed" : "failed");
  }

  async function confirmRemove() {
    if (removeTarget === null || removing) return;
    setRemoving(true);
    await removeNow(removeTarget);
    setRemoving(false);
    setRemoveTarget(null);
  }

  // Delete reflection…: permanent, so it always asks, and only while there is a connection.
  function askDelete(prayer: Prayer) {
    // TODO(34): reflection_deleted { source: "prayers", had_audio: boolean }
    const opened = deletion.ask({ entryId: prayer.id, answered: prayer.isAnswered });
    if (!opened) setNotice("offline");
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
      {ready.waitingOffline ? (
        <Text className="mt-1 text-body-sm text-mauve">{copy.prayers.offlinePending}</Text>
      ) : null}
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
                onOpenMenu={(prayer) => openMenu(prayer, "active")}
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
                onOpenMenu={(prayer) => openMenu(prayer, "answered")}
                onAddNote={(prayer) => openSheet(prayer, "editNote")}
              />
            </TimelineItem>
          );
        }}
        // The days on the cards follow `now`, which is not part of the data.
        extraData={ready?.now}
        ItemSeparatorComponent={tab === "answered" ? TimelineSeparator : CardGap}
        ListHeaderComponent={header ?? undefined}
        ListEmptyComponent={emptyState ?? undefined}
        // The content runs under the floating tab bar; the indicator stops above it.
        scrollIndicatorInsets={{ bottom: barClearance }}
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
                clearNotice();
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
      <BottomSheet visible={menuVisible} onClose={() => setMenuVisible(false)} onDismiss={runAfterMenu}>
        {menuPrayer !== null ? (
          <Text numberOfLines={2} className="mb-3 text-center text-body-sm text-mauve">
            {getPrayerTitle(menuPrayer)}
          </Text>
        ) : null}
        {/* The rows sit in one white card with a hairline between them, like Profile's groups (DESIGN.md: cards are white with a
            petal outline and rows are at least 56 high). The shadow and the clipping are on different views: with both on
            one view, iOS clips the shadow. */}
        <View className="rounded-card border border-petal bg-card" style={shadows.card}>
          <View className="overflow-hidden rounded-card">
            {getPrayerMenu(menuTab).map((item, index) => (
              <View key={item.action}>
                {index > 0 ? <View className="divider mx-4" /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => {
                    if (menuPrayer !== null) pickFromMenu(menuPrayer, item.action);
                  }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  {/* Icon and label are one group centered in the card (like the sheet's caption, the Filter sheet's chips and the
                      dialogs); the labels share the widest one's width so the icons and the labels line up from row to row, and
                      shrink lets a long label wrap. The icon sits in a soft circle as on Profile's rows: linen for a normal row,
                      a Crisis Red tint for the delete. */}
                  <View className="list-row justify-center">
                    <View
                      className={
                        item.destructive
                          ? "size-9 items-center justify-center rounded-full bg-crisis/12"
                          : "size-9 items-center justify-center rounded-full bg-linen-deep"
                      }
                    >
                      <Icon name={item.icon} size={18} color={item.destructive ? colors.crisis : colors.plum} />
                    </View>
                    <Text
                      onLayout={(event) => {
                        const width = Math.ceil(event.nativeEvent.layout.width);
                        setMenuLabelWidth((widest) => Math.max(widest, width));
                      }}
                      style={menuLabelWidth > 0 ? { minWidth: menuLabelWidth } : undefined}
                      className={
                        item.destructive
                          ? "shrink text-left text-body text-crisis"
                          : "shrink text-left text-body text-ink"
                      }
                    >
                      {item.label}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </BottomSheet>
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
      <ConfirmDialog
        visible={removeTarget !== null}
        title={removeText.title}
        body={removeText.body}
        confirmLabel={removeText.confirm}
        cancelLabel={removeText.cancel}
        loading={removing}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
      <DeleteReflectionDialog {...deletion.dialog} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  pressed: { opacity: 0.7 },
});
