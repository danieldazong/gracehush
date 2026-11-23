import { useFocusEffect } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Skeleton } from "@/components/Skeleton";
import { MODAL_HANDOFF_FALLBACK_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useScholarHistory } from "@/hooks/useScholarHistory";
import type { RootStackScreenProps } from "@/navigation/types";
import { formatEntryTimestamp } from "@/utils/format";
import { groupConversations, type HistoryItem } from "@/utils/scholarHistory";

const icons = {
  back: { android: "chevron_left", ios: "chevron.left" },
  chevron: { android: "chevron_right", ios: "chevron.right" },
  search: { android: "search", ios: "magnifyingglass" },
  clear: { android: "cancel", ios: "xmark.circle.fill" },
  delete: { android: "delete", ios: "trash" },
} satisfies Record<string, SymbolViewProps["name"]>;

type Row = Extract<HistoryItem, { kind: "row" }>;

// One conversation: its title over the time, a chevron, and a hairline under it. A tap opens it; a long press (or the screen
// reader's "Delete conversation" action) offers to delete it.
function HistoryRow({
  item,
  onOpen,
  onMenu,
}: {
  item: Row;
  onOpen: (id: string) => void;
  onMenu: (conversation: Row["conversation"]) => void;
}) {
  const title = item.conversation.title ?? copy.scholar.untitled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={copy.scholar.history.a11y.rowHint}
      accessibilityActions={[{ name: "delete", label: copy.scholar.history.a11y.deleteAction }]}
      onAccessibilityAction={() => onMenu(item.conversation)}
      onPress={() => onOpen(item.conversation.id)}
      onLongPress={() => onMenu(item.conversation)}
      delayLongPress={350}
      style={({ pressed }) => pressed && styles.rowPressed}
    >
      <View className="screen__content min-h-[60px] flex-row items-center gap-3 border-b border-petal py-3">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-label-lg text-ink">
            {title}
          </Text>
          <Text className="text-body-sm text-mauve">{item.time}</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name={icons.chevron} size={16} color={colors.mauve} />
        </View>
      </View>
    </Pressable>
  );
}

// A heading that sticks to the top while its rows scroll under it, so it needs the page's own background.
function SectionHeader({ title }: { title: string }) {
  return (
    <View className="screen__content bg-linen pb-2 pt-5">
      <Text accessibilityRole="header" className="eyebrow">
        {title}
      </Text>
    </View>
  );
}

function SkeletonRows() {
  return (
    <View accessibilityLabel={copy.scholar.groups.recent} accessibilityState={{ busy: true }} className="screen__content gap-5 pt-5">
      {[0, 1, 2, 3, 4].map((index) => (
        <View key={index} className="gap-2">
          <Skeleton height={16} width={index % 2 === 0 ? 220 : 180} radius={8} />
          <Skeleton height={12} width={90} radius={6} />
        </View>
      ))}
    </View>
  );
}

// The Conversations screen (2026-11-16), behind the Scholar tab's "See all": every conversation, newest first, grouped under
// Today, Yesterday, Previous 7 days and a heading for each older month, searchable by title, loaded 30 at a time as the list is
// scrolled. A long press on a row offers to delete it (online only, and always asks). Nothing is cached on the phone.
export function ScholarHistoryScreen({ navigation }: RootStackScreenProps<"ScholarHistory">) {
  const [query, setQuery] = useState("");
  const history = useScholarHistory(query);
  const { state, applied } = history;

  // The times say "Today" and "Yesterday": today is kept in state and read again whenever the screen comes to the front.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, []),
  );

  const items =
    state.phase === "ready"
      ? groupConversations(state.conversations, now, (iso) => formatEntryTimestamp(iso, now))
      : [];
  const headerIndices = items.flatMap((item, index) => (item.kind === "header" ? [index] : []));

  // One conversation opens at a time: a second tap before the screen is covered does nothing (as the Scholar tab).
  const opening = useRef(false);
  useFocusEffect(
    useCallback(() => {
      opening.current = false;
    }, []),
  );
  function open(conversationId: string) {
    if (opening.current) return;
    opening.current = true;
    navigation.navigate("Conversation", { conversationId });
  }

  // The delete: a long press opens a sheet with the one row, whose choice opens the confirmation once the sheet has gone (iOS
  // presents one Modal at a time).
  const [menuFor, setMenuFor] = useState<Row["conversation"] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmFor, setConfirmFor] = useState<Row["conversation"] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const afterMenu = useRef<(() => void) | null>(null);
  useAnnounce(announcement);

  function runAfterMenu() {
    const run = afterMenu.current;
    afterMenu.current = null;
    run?.();
  }

  function openMenu(conversation: Row["conversation"]) {
    setMenuFor(conversation);
    setMenuOpen(true);
  }

  function pickDelete() {
    const target = menuFor;
    setMenuOpen(false);
    if (target === null) return;
    afterMenu.current = () => {
      setDeleteFailed(null);
      setConfirmFor(target);
    };
    if (Platform.OS === "ios") setTimeout(runAfterMenu, MODAL_HANDOFF_FALLBACK_MS);
    else runAfterMenu();
  }

  async function confirmDelete() {
    if (confirmFor === null || deleting) return;
    setDeleting(true);
    setDeleteFailed(null);
    const outcome = await history.deleteOne(confirmFor.id);
    setDeleting(false);
    if (outcome === "ok") {
      setConfirmFor(null);
      setAnnouncement(copy.scholar.history.deleted);
    } else {
      setDeleteFailed(outcome === "offline" ? copy.scholar.delete.offline : copy.scholar.delete.failed);
    }
  }

  const empty =
    state.phase === "ready" ? (
      <View className="flex-1 items-center justify-center gap-2 px-8 pb-24">
        {applied === "" ? (
          <>
            <Text accessibilityRole="header" className="text-center text-section text-ink">
              {copy.scholar.history.empty.title}
            </Text>
            <Text className="text-center text-body text-mauve">{copy.scholar.history.empty.body}</Text>
          </>
        ) : (
          <Text className="text-center text-body text-mauve">{copy.scholar.history.noResults(applied)}</Text>
        )}
      </View>
    ) : undefined;

  const ready = state.phase === "ready" ? state : null;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View className="min-h-14 flex-row items-center gap-1 px-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.history.a11y.back}
          onPress={() => navigation.goBack()}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={icons.back} size={22} color={colors.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" className="flex-1 text-section text-plum-deep">
          {copy.scholar.history.title}
        </Text>
      </View>

      <View className="screen__content pb-1 pt-1">
        <View className="min-h-[46px] flex-row items-center gap-2 rounded-full border border-petal bg-card pl-4 pr-1">
          <Icon name={icons.search} size={18} color={colors.mauve} />
          <TextInput
            accessibilityLabel={copy.scholar.history.a11y.searchField}
            className="flex-1 text-body text-ink"
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={copy.scholar.history.search}
            placeholderTextColor={colors.mauve}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="never"
            keyboardAppearance="light"
            underlineColorAndroid="transparent"
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.scholar.history.clearSearch}
              onPress={() => setQuery("")}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="size-11 items-center justify-center">
                <Icon name={icons.clear} size={18} color={colors.mauve} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      {state.phase === "loading" ? (
        <SkeletonRows />
      ) : state.phase === "error" ? (
        <View className="flex-1 items-center justify-center gap-3 px-8 pb-24">
          <Text className="text-center text-body text-mauve">{copy.scholar.errors.load}</Text>
          <PrimaryButton label={copy.scholar.errors.retry} tone="ghost" onPress={history.retry} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <SectionHeader title={item.title} />
            ) : (
              <HistoryRow item={item} onOpen={open} onMenu={openMenu} />
            )
          }
          stickyHeaderIndices={headerIndices}
          onEndReached={ready !== null && !ready.moreFailed ? history.loadMore : undefined}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={empty}
          ListFooterComponent={
            ready?.loadingMore ? (
              <View
                accessible
                accessibilityLabel={copy.scholar.history.loadingMore}
                accessibilityState={{ busy: true }}
                className="items-center py-5"
              >
                <ActivityIndicator size="small" color={colors.plum} />
              </View>
            ) : ready?.moreFailed ? (
              <View accessibilityLiveRegion="polite" className="items-center gap-1 py-4">
                <Text className="text-center text-body-sm text-mauve">{copy.scholar.history.moreFailed}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.scholar.errors.retry}
                  onPress={history.loadMore}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <View className="min-h-11 justify-center px-4">
                    <Text className="text-label-lg text-plum">{copy.scholar.errors.retry}</Text>
                  </View>
                </Pressable>
              </View>
            ) : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={ready?.refreshing ?? false}
              onRefresh={history.refresh}
              tintColor={colors.plum}
              colors={[colors.plum]}
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Android hears "Conversation deleted" from a hidden live region; iOS from useAnnounce. */}
      {Platform.OS === "android" && announcement !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.hidden}>
          {announcement}
        </Text>
      ) : null}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} onDismiss={runAfterMenu}>
        <View className="gap-3">
          <Text numberOfLines={2} className="px-2 text-center text-body-sm text-mauve">
            {menuFor?.title ?? copy.scholar.untitled}
          </Text>
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
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmFor !== null}
        tone="destructive"
        icon={icons.delete}
        title={copy.scholar.delete.title}
        body={copy.scholar.delete.body}
        confirmLabel={copy.scholar.delete.confirm}
        cancelLabel={copy.scholar.delete.cancel}
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmFor(null)}
      >
        {deleteFailed !== null ? (
          <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
            {deleteFailed}
          </Text>
        ) : null}
      </ConfirmDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  input: { minHeight: 44, paddingVertical: 10 },
  listContent: { flexGrow: 1, paddingBottom: 24 },
  pressed: { opacity: 0.6 },
  rowPressed: { backgroundColor: colors.linenDeep },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
