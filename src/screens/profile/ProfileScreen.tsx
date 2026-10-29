import { useAuth, useUser } from "@clerk/expo";
import { useFocusEffect, useScrollToTop } from "@react-navigation/native";
import Constants from "expo-constants";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DevToolsPanel } from "@/components/dev/DevToolsPanel";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AmbientPanel } from "@/components/profile/AmbientPanel";
import { PlanCard } from "@/components/profile/PlanCard";
import { RemindersPanel } from "@/components/profile/RemindersPanel";
import { SettingsGroup } from "@/components/profile/SettingsGroup";
import { SettingsRow } from "@/components/profile/SettingsRow";
import { openAndroidTimeDialog, ReminderTimePicker } from "@/components/ReminderTimePicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/Skeleton";
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, TERMS_URL } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useProfileSettings } from "@/hooks/useProfileSettings";
import { useTabBarClearance, useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps } from "@/navigation/types";
import { countPendingPrayerChanges, countUnsentItems } from "@/data/journalRepository";
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { isPreviewing, previewAmbient, stopPreview, subscribePreview } from "@/services/ambientPlayer";
import {
  openLegalPage,
  openManageSubscription,
  openSupportEmail,
  type LinkResult,
} from "@/services/externalLinks";
import { haptics } from "@/services/haptics";
import { requestNotificationPermission } from "@/services/notifications";
import { restorePurchases } from "@/services/purchases";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";
import type { PermissionResult, ProfilePatch, TimeSlot } from "@/types";
import { formatMonthYear, formatTime12, getFullName, getInitials } from "@/utils/format";

const { profile: text } = copy;
const { rhythm } = copy.onboarding;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

const icons = {
  reminders: { android: "schedule", ios: "clock" },
  ambient: { android: "graphic_eq", ios: "waveform" },
  affirmations: { android: "notifications", ios: "bell" },
  // The row's tile is a plain cloud: the trailing icon carries the state, so a "done" cloud would contradict "pending".
  cloud: { android: "cloud", ios: "icloud" },
  synced: { android: "check_circle", ios: "checkmark.circle.fill" },
  pending: { android: "cloud_upload", ios: "icloud.and.arrow.up" },
  export: { android: "download", ios: "square.and.arrow.down" },
  document: { android: "description", ios: "doc.text" },
  lock: { android: "lock", ios: "lock" },
  delete: { android: "delete", ios: "trash" },
  warning: { android: "warning", ios: "exclamationmark.triangle" },
  support: { android: "favorite", ios: "heart" },
  help: { android: "help", ios: "questionmark.circle" },
  external: { android: "open_in_new", ios: "arrow.up.right.square" },
  signOut: { android: "logout", ios: "rectangle.portrait.and.arrow.right" },
  chevron: { android: "chevron_right", ios: "chevron.right" },
  chevronDown: { android: "keyboard_arrow_down", ios: "chevron.down" },
  blessing: { android: "volunteer_activism", ios: "hands.sparkles" },
  arrow: { android: "arrow_forward", ios: "arrow.right" },
  person: { android: "person", ios: "person" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The trailing pictures of the rows: a chevron for a row that opens something, and the external-link mark for a
// page that leaves the app.
const chevron = <Icon name={icons.chevron} size={20} color={colors.mauve} />;
const externalMark = <Icon name={icons.external} size={20} color={colors.mauve} />;

// One ConfirmDialog serves all four, so the content follows the step. The delete dialog has two steps.
type DialogKind = "signOut" | "export" | "delete1" | "delete2";

const DIALOGS: Record<
  DialogKind,
  {
    strings: { title: string; body: string; confirm: string; cancel: string };
    icon?: SymbolViewProps["name"];
    destructive: boolean;
  }
> = {
  signOut: { strings: text.dialogs.signOut, destructive: false },
  export: { strings: text.dialogs.export, icon: icons.document, destructive: false },
  delete1: { strings: text.dialogs.deleteFirst, icon: icons.warning, destructive: true },
  delete2: { strings: text.dialogs.deleteFinal, icon: icons.delete, destructive: true },
};

// A calm line under the group it belongs to. It stays until the next action or until the user leaves the tab,
// never on a timer.
type NoticeKind =
  | "saveAmbient"
  | "saveAffirmations"
  | "subscription"
  | "restored"
  | "restoreNone"
  | "restoreError"
  | "exportRequested"
  | "email"
  | "page";

function Notice({
  message,
  tone = "rosewood",
  centered = false,
  selectable = false,
}: {
  message: string;
  tone?: "rosewood" | "mauve";
  centered?: boolean;
  selectable?: boolean;
}) {
  useAnnounce(message);

  return (
    <Text
      accessibilityLiveRegion="polite"
      selectable={selectable}
      className={[
        "px-2 text-body-sm",
        tone === "rosewood" ? "text-rosewood" : "text-mauve",
        centered ? "text-center" : "",
      ].join(" ")}
    >
      {message}
    </Text>
  );
}

// The name, email and photo come from Clerk and need no profile data, so they show in every state. The photo is
// used only when Clerk has an uploaded one and it loads; otherwise the initials, otherwise a person icon.
function AccountHeader({ memberSince }: { memberSince: ReactNode }) {
  const { user } = useUser();
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const names = { firstName: user?.firstName, lastName: user?.lastName, email };
  const initials = getInitials(names);
  const photoUrl = user?.hasImage ? user.imageUrl : null;
  const photo = photoUrl !== null && photoUrl !== failedPhoto ? photoUrl : null;

  return (
    <View className="flex-row items-center gap-4">
      {/* The name beside it says who this is, so the avatar is hidden from screen readers. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="size-16 items-center justify-center overflow-hidden rounded-full border border-petal bg-blush"
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            contentFit="cover"
            onError={() => setFailedPhoto(photo)}
            style={styles.photo}
          />
        ) : initials ? (
          <Text className="text-headline text-plum-deep">{initials}</Text>
        ) : (
          <Icon name={icons.person} size={28} color={colors.plum} />
        )}
      </View>
      <View className="flex-1">
        <Text className="text-headline text-plum-deep">{getFullName(names) ?? text.account.friend}</Text>
        {email ? <Text className="text-body-sm text-mauve">{email}</Text> : null}
        {memberSince}
      </View>
    </View>
  );
}

// A group's label line over its card.
function SkeletonGroup({ height }: { height: number }) {
  return (
    <View className="gap-1">
      <Skeleton width={110} height={16} radius={8} />
      <Skeleton height={height} />
    </View>
  );
}

// The shape of the sections: the plan card with its Restore purchases button, and the three groups. The heights
// are those of the real sections (collapsed, at normal text size), so the page does not jump when the data arrives.
function LoadingSections() {
  return (
    <View
      accessible
      accessibilityLabel={text.loading}
      accessibilityState={{ busy: true }}
      className="gap-6"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-6"
      >
        <View className="items-center gap-1">
          <Skeleton height={284} />
          <Skeleton width={150} height={44} radius={22} />
        </View>
        <SkeletonGroup height={148} />
        <SkeletonGroup height={148} />
        <SkeletonGroup height={168} />
      </View>
    </View>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="card items-center gap-4">
      <Text className="text-center text-body text-ink">{text.errors.load}</Text>
      <PrimaryButton label={text.errors.retry} onPress={onRetry} />
    </View>
  );
}

// Shown under Notifications & storage while Daily Affirmations is on and the phone will not show them.
function NotificationCard({
  status,
  onOpenSettings,
  onAllow,
}: {
  status: PermissionResult;
  onOpenSettings: () => void;
  onAllow: () => void;
}) {
  if (status === "granted") return null;
  const denied = status === "denied";

  return (
    <View className="card card--blush gap-3">
      {denied ? (
        <View className="gap-1">
          <Text className="text-label-lg text-ink">{text.notifications.deniedTitle}</Text>
          <Text className="text-body-sm text-mauve">{text.notifications.deniedBody}</Text>
        </View>
      ) : (
        <Text className="text-body text-ink">{text.notifications.undeterminedTitle}</Text>
      )}
      <PrimaryButton
        tone="ghost"
        label={denied ? text.notifications.openSettings : text.notifications.allow}
        onPress={denied ? onOpenSettings : onAllow}
      />
    </View>
  );
}

// What the first delete step adds under its body: a way to export first, and for a paid plan the reminder that
// deleting the account does not cancel the subscription.
function DeleteFirstExtras({
  isPaid,
  onExportFirst,
  onManage,
}: {
  isPaid: boolean;
  onExportFirst: () => void;
  onManage: () => void;
}) {
  const { deleteFirst } = text.dialogs;

  return (
    <View className="mt-3 w-full items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={deleteFirst.exportFirst}
        onPress={onExportFirst}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="min-h-11 flex-row items-center justify-center gap-1">
          <Text className="btn-text__label btn-text__label--rosewood">{deleteFirst.exportFirst}</Text>
          <Icon name={icons.arrow} size={16} color={colors.rosewood} />
        </View>
      </Pressable>
      {isPaid ? (
        <>
          <Text className="mt-2 text-center text-body-sm text-mauve">
            {deleteFirst.subscriptionWarning}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={text.plan.manage}
            onPress={onManage}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 items-center justify-center">
              <Text className="btn-text__label text-plum">{text.plan.manage}</Text>
            </View>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function Footer() {
  const version = Constants.expoConfig?.version ?? null;

  return (
    <View className="items-center gap-1 py-2">
      <Text className="text-center font-dm text-[11px] leading-[16px] text-mauve">
        {text.footer.line(version)}
      </Text>
      <View className="mt-1 flex-row items-center gap-1.5">
        <Icon name={icons.blessing} size={15} color={colors.rosewood} />
        <Text className="text-body-sm text-rosewood">{text.footer.blessing}</Text>
      </View>
    </View>
  );
}

export function ProfileScreen({ navigation }: MainTabScreenProps<"Profile">) {
  const state = useProfileSettings();
  // RevenueCat's own link to this customer's subscription page, when it has one (step 30).
  const { managementUrl } = useEntitlement();
  const { signOut } = useAuth();
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTop(scrollRef);
  const paddingBottom = useTabScreenBottomPadding();
  const barClearance = useTabBarClearance();
  const reminders = useOnboardingStore((store) => store.reminders);
  const setReminder = useOnboardingStore((store) => store.setReminder);

  // Screen state, reset when the screen unmounts. Both accordion rows start closed.
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [ambientOpen, setAmbientOpen] = useState(false);
  // iOS only: the slot shown in the time sheet. Android uses its native dialog.
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  // True while a finger is on the volume track: the page does not scroll then.
  const [isSeeking, setIsSeeking] = useState(false);
  const [notices, setNotices] = useState<NoticeKind[]>([]);
  // The dialog keeps its kind after it closes, so the fade-out never shows empty content.
  const [dialog, setDialog] = useState<DialogKind>("signOut");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // What this phone holds that the server has never been given, which signing out deletes: reflections (step 24) and prayers
  // with changes waiting (step 29 follow-up).
  const [unsent, setUnsent] = useState({ reflections: 0, prayers: 0 });
  // "Restore purchases" is running. The ref blocks a second tap in the same tick, before the state has rendered.
  const [restoring, setRestoring] = useState(false);
  const restoreRunning = useRef(false);
  useAnnounce(dialogError);
  // The ambient preview (step 27) plays only while no devotional is playing.
  const previewing = useSyncExternalStore(subscribePreview, isPreviewing);
  const devotionalPlaying = usePlayerStore((store) => store.status === "playing");

  // Leaving the tab (or opening a screen over it) clears every notice and stops a preview.
  useFocusEffect(
    useCallback(
      () => () => {
        setNotices([]);
        stopPreview();
      },
      [],
    ),
  );

  const ready = state.status === "ready" ? state : null;
  const isPaid = ready !== null && ready.usage.tier !== "free";
  const has = (kind: NoticeKind) => notices.includes(kind);

  function showNotice(kind: NoticeKind) {
    setNotices((current) => (current.includes(kind) ? current : [...current, kind]));
  }

  function hideNotice(...kinds: NoticeKind[]) {
    setNotices((current) => current.filter((kind) => !kinds.includes(kind)));
  }

  function changeTime(slot: TimeSlot) {
    if (Platform.OS === "android") {
      openAndroidTimeDialog(reminders[slot], (hhmm) => setReminder(slot, hhmm));
      return;
    }
    setEditingSlot(slot);
  }

  // The affirmation notifications follow the new time by themselves: the scheduler watches the reminder times (step 28).
  function changeReminder(hhmm: string) {
    if (editingSlot) setReminder(editingSlot, hhmm);
  }

  async function changeAffirmations(enabled: boolean) {
    if (state.status !== "ready") return;
    const result = await state.save({ affirmationsEnabled: enabled });
    if (result.ok) {
      hideNotice("saveAffirmations", "saveAmbient");
      // Off cancels the affirmation notifications and on schedules them again (step 28).
      requestAffirmationReschedule();
    } else {
      showNotice("saveAffirmations");
    }
  }

  async function changeAmbient(patch: ProfilePatch) {
    if (state.status !== "ready") return;
    const result = await state.save(patch);
    if (result.ok) {
      hideNotice("saveAffirmations", "saveAmbient");
      // The saved choice is what the next devotional starts with. What is playing keeps its sound and volume.
      usePlayerStore.getState().reseedAmbient();
      // TODO(34): ambient_changed { sound, source: 'profile' }
    } else {
      showNotice("saveAmbient");
    }
  }

  async function allowNotifications() {
    await requestNotificationPermission();
    requestAffirmationReschedule();
    if (state.status === "ready") await state.refresh();
  }

  async function openSystemSettings() {
    try {
      await Linking.openSettings();
    } catch {
      // The system Settings could not open. There is nothing to show: the card stays as it is.
    }
  }

  // Asks the store for the user's earlier purchases. The plan card follows a restored plan by itself: the mock
  // tells Profile to reload, and RevenueCat's answer reaches it through the entitlement store (step 30).
  async function restore() {
    if (restoreRunning.current) return;
    restoreRunning.current = true;
    setRestoring(true);
    hideNotice("subscription", "restored", "restoreNone", "restoreError");
    try {
      const result = await restorePurchases();
      if (!result.ok) showNotice("restoreError");
      else showNotice(result.restored ? "restored" : "restoreNone");
      // TODO(34): restore_completed { found: boolean }
    } catch {
      showNotice("restoreError");
    } finally {
      restoreRunning.current = false;
      setRestoring(false);
    }
  }

  // Opens a link, and shows or clears the notice that belongs to it.
  async function openLink(open: () => Promise<LinkResult>, notice: NoticeKind) {
    const result = await open();
    if (result.ok) hideNotice(notice);
    else showNotice(notice);
  }

  // The plan card is behind the delete dialog, so a link that fails there is reported inside the dialog.
  async function manageFromDialog() {
    const result = await openManageSubscription(managementUrl);
    setDialogError(result.ok ? null : text.errors.subscription);
  }

  function openDialog(kind: DialogKind) {
    setDialog(kind);
    setDialogError(null);
    setDialogOpen(true);
  }

  // The counts are read before the dialog opens, so its first frame already says the truth.
  async function openSignOut() {
    const [reflections, prayers] = await Promise.all([countUnsentItems(), countPendingPrayerChanges()]);
    setUnsent({ reflections, prayers });
    openDialog("signOut");
  }

  // Sign out and account deletion both end here. deleteAccount has already run the cleanup. On success the
  // navigator shows Sign In and removes this screen, so nothing below sets state.
  async function endSession(runCleanup: boolean) {
    try {
      if (runCleanup) await signOutCleanup();
      await signOut();
    } catch {
      setBusy(false);
      setDialogError(text.errors.signOut);
    }
  }

  async function confirmDialog() {
    if (busy) return;
    if (dialog === "delete1") {
      // A line from step 1 (its "Manage subscription" link failing) must not follow the user to step 2.
      setDialogError(null);
      setDialog("delete2");
      return;
    }
    setBusy(true);
    setDialogError(null);
    if (dialog === "signOut") {
      await endSession(true);
    } else if (dialog === "export") {
      const result = await requestDataExport();
      setBusy(false);
      if (result.ok) {
        setDialogOpen(false);
        showNotice("exportRequested");
        // TODO(34): data_export_requested {}
      } else {
        setDialogError(result.message);
      }
    } else {
      const result = await deleteAccount();
      if (result.ok) {
        await endSession(false);
      } else {
        setBusy(false);
        setDialogError(result.message);
      }
    }
  }

  const memberSince =
    state.status === "ready" ? (
      <Text className="text-body-sm text-mauve">
        {text.account.memberSince(formatMonthYear(state.profile.createdAt))}
      </Text>
    ) : state.status === "loading" ? (
      <View className="mt-1">
        <Skeleton width={160} height={14} radius={7} />
      </View>
    ) : null;

  const dialogContent = DIALOGS[dialog];
  const { signOutUnsent } = text.dialogs;
  const dialogStrings =
    dialog === "signOut" && (unsent.reflections > 0 || unsent.prayers > 0)
      ? {
          ...dialogContent.strings,
          body: signOutUnsent.body(unsent.reflections, unsent.prayers),
          confirm: signOutUnsent.confirm,
          cancel: signOutUnsent.cancel,
        }
      : dialogContent.strings;
  const reminderTimes = SLOTS.map((slot) => ({
    name: rhythm.slots[slot].name,
    time: formatTime12(reminders[slot]),
  }));
  // "Soft Rain, 50% volume", or "Off" (the volume does not matter then).
  const ambientSummary = ready
    ? text.ambient.summary(
        copy.ambient.labels[ready.profile.ambientSound],
        ready.profile.ambientSound === "off" ? null : Math.round(ready.profile.ambientVolume * 100),
      )
    : "";

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.profile} avatar="static" />
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!isSeeking}
        // The content runs under the floating tab bar; the indicator stops above it.
        scrollIndicatorInsets={{ bottom: barClearance }}
        contentContainerStyle={{ paddingBottom }}
        refreshControl={
          ready ? (
            <RefreshControl
              refreshing={ready.refreshing}
              onRefresh={() => {
                ready.refresh();
              }}
              tintColor={colors.plum}
              colors={[colors.plum]}
            />
          ) : undefined
        }
      >
        <View className="screen__content gap-6 pt-4">
          <AccountHeader memberSince={memberSince} />

          {state.status === "loading" ? <LoadingSections /> : null}
          {state.status === "error" ? <ErrorCard onRetry={state.retry} /> : null}

          {ready ? (
            <>
              <View className="gap-1">
                <PlanCard
                  usage={ready.usage}
                  trialEligible={ready.trialEligible}
                  onStartTrial={() => navigation.navigate("Paywall", { source: "profile" })}
                  onManage={() => {
                    // The restore line belongs to the last plan-card action, so the next one replaces it.
                    hideNotice("restored", "restoreNone", "restoreError");
                    openLink(() => openManageSubscription(managementUrl), "subscription");
                  }}
                />
                {has("subscription") ? <Notice message={text.errors.subscription} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={text.plan.restore}
                  accessibilityState={{ disabled: restoring, busy: restoring }}
                  disabled={restoring}
                  onPress={restore}
                  style={({ pressed }) => [pressed && styles.pressed, restoring && styles.disabled]}
                >
                  <View className="min-h-11 items-center justify-center">
                    <Text className="btn-text__label btn-text__label--rosewood">{text.plan.restore}</Text>
                  </View>
                </Pressable>
                {has("restored") ? (
                  <Notice message={text.plan.restored} tone="mauve" centered />
                ) : null}
                {has("restoreNone") ? (
                  <Notice message={text.plan.restoreNone} tone="mauve" centered />
                ) : null}
                {has("restoreError") ? <Notice message={text.plan.restoreError} centered /> : null}
              </View>

              <View className="gap-2">
                <SettingsGroup title={text.groups.preferences}>
                  <View>
                    <SettingsRow
                      icon={icons.reminders}
                      title={text.reminders.title}
                      subtitle={text.reminders.summary(reminderTimes)}
                      trailing={
                        <Icon
                          name={remindersOpen ? icons.chevronDown : icons.chevron}
                          size={20}
                          color={colors.mauve}
                        />
                      }
                      onPress={() => setRemindersOpen((open) => !open)}
                      accessibilityLabel={text.rowLabel(
                        text.reminders.title,
                        text.reminders.spoken(reminderTimes),
                      )}
                      accessibilityHint={
                        remindersOpen ? text.reminders.hideHint : text.reminders.showHint
                      }
                      accessibilityState={{ expanded: remindersOpen }}
                    />
                    {remindersOpen ? (
                      <RemindersPanel
                        reminders={reminders}
                        timezone={ready.profile.timezone}
                        onChangeTime={changeTime}
                      />
                    ) : null}
                  </View>
                  <View>
                    <SettingsRow
                      icon={icons.ambient}
                      title={text.ambient.title}
                      subtitle={ambientSummary}
                      trailing={
                        <Icon
                          name={ambientOpen ? icons.chevronDown : icons.chevron}
                          size={20}
                          color={colors.mauve}
                        />
                      }
                      onPress={() => setAmbientOpen((open) => !open)}
                      accessibilityLabel={text.rowLabel(text.ambient.title, ambientSummary)}
                      accessibilityHint={ambientOpen ? text.ambient.hideHint : text.ambient.showHint}
                      accessibilityState={{ expanded: ambientOpen }}
                    />
                    {ambientOpen ? (
                      <AmbientPanel
                        sound={ready.profile.ambientSound}
                        volume={ready.profile.ambientVolume}
                        // A preview that is playing follows a new choice at once (Off stops it).
                        onChangeSound={(ambientSound) => {
                          if (previewing) previewAmbient(ambientSound, ready.profile.ambientVolume);
                          changeAmbient({ ambientSound });
                        }}
                        onChangeVolume={(ambientVolume) => {
                          if (previewing) previewAmbient(ready.profile.ambientSound, ambientVolume);
                          changeAmbient({ ambientVolume });
                        }}
                        onSeekingChange={setIsSeeking}
                        previewing={previewing}
                        previewBlocked={devotionalPlaying}
                        onTogglePreview={() => {
                          if (previewing) stopPreview();
                          else previewAmbient(ready.profile.ambientSound, ready.profile.ambientVolume);
                        }}
                        onDragVolume={(ambientVolume) => {
                          if (previewing) previewAmbient(ready.profile.ambientSound, ambientVolume);
                        }}
                      />
                    ) : null}
                  </View>
                </SettingsGroup>
                {has("saveAmbient") ? <Notice message={text.errors.save} /> : null}
              </View>

              <View className="gap-2">
                <SettingsGroup title={text.groups.notifications}>
                  <SettingsRow
                    icon={icons.affirmations}
                    title={text.affirmations.title}
                    subtitle={text.affirmations.subtitle}
                    trailing={
                      <Switch
                        value={ready.profile.affirmationsEnabled}
                        trackColor={{ false: colors.petal, true: colors.plum }}
                        thumbColor={colors.card}
                        ios_backgroundColor={colors.petal}
                      />
                    }
                    onPress={() => {
                      haptics.selection();
                      changeAffirmations(!ready.profile.affirmationsEnabled);
                    }}
                    accessibilityRole="switch"
                    accessibilityLabel={text.affirmations.title}
                    accessibilityHint={text.affirmations.subtitle}
                    accessibilityState={{ checked: ready.profile.affirmationsEnabled }}
                  />
                  <SettingsRow
                    icon={icons.cloud}
                    title={text.sync.title}
                    subtitle={text.sync.status(ready.syncSummary.synced, ready.syncSummary.pending)}
                    trailing={
                      <Icon
                        name={ready.syncSummary.pending === 0 ? icons.synced : icons.pending}
                        size={22}
                        color={ready.syncSummary.pending === 0 ? colors.sage : colors.mauve}
                      />
                    }
                    accessibilityLabel={text.sync.label(
                      ready.syncSummary.synced,
                      ready.syncSummary.pending,
                    )}
                  />
                </SettingsGroup>
                {ready.profile.affirmationsEnabled ? (
                  <NotificationCard
                    status={ready.notificationStatus}
                    onOpenSettings={openSystemSettings}
                    onAllow={allowNotifications}
                  />
                ) : null}
                {has("saveAffirmations") ? <Notice message={text.errors.save} /> : null}
              </View>

              <View className="gap-2">
                <SettingsGroup title={text.groups.privacy}>
                  <SettingsRow
                    icon={icons.export}
                    title={text.privacy.exportTitle}
                    subtitle={text.privacy.exportSubtitle}
                    trailing={chevron}
                    onPress={() => openDialog("export")}
                    accessibilityLabel={text.rowLabel(
                      text.privacy.exportTitle,
                      text.privacy.exportSubtitle,
                    )}
                  />
                  <SettingsRow
                    icon={icons.delete}
                    iconTone="destructive"
                    title={text.privacy.deleteTitle}
                    titleTone="destructive"
                    subtitle={text.privacy.deleteSubtitle}
                    trailing={<Icon name={icons.warning} size={20} color={colors.crisis} />}
                    onPress={() => openDialog("delete1")}
                    accessibilityLabel={text.rowLabel(
                      text.privacy.deleteTitle,
                      text.privacy.deleteSubtitle,
                    )}
                  />
                </SettingsGroup>
                {has("exportRequested") ? (
                  <Notice message={text.privacy.exportRequested} tone="mauve" />
                ) : null}
              </View>
            </>
          ) : null}

          <View className="gap-2">
            <SettingsGroup title={text.groups.about}>
              <SettingsRow
                icon={icons.support}
                iconTone="bare"
                title={text.about.support}
                trailing={chevron}
                onPress={() => navigation.navigate("CrisisResources", { source: "profile" })}
                accessibilityLabel={text.about.support}
              />
              <SettingsRow
                icon={icons.help}
                iconTone="bare"
                title={text.about.help}
                trailing={chevron}
                onPress={() => openLink(openSupportEmail, "email")}
                accessibilityLabel={text.about.help}
                accessibilityHint={text.about.helpHint}
              />
              <SettingsRow
                icon={icons.lock}
                iconTone="bare"
                title={text.about.privacyPolicy}
                trailing={externalMark}
                onPress={() => openLink(() => openLegalPage(PRIVACY_POLICY_URL), "page")}
                accessibilityLabel={text.about.privacyPolicy}
                accessibilityHint={text.about.pageHint}
              />
              <SettingsRow
                icon={icons.document}
                iconTone="bare"
                title={text.about.terms}
                trailing={externalMark}
                onPress={() => openLink(() => openLegalPage(TERMS_URL), "page")}
                accessibilityLabel={text.about.terms}
                accessibilityHint={text.about.pageHint}
              />
              <SettingsRow
                icon={icons.signOut}
                iconTone="bare"
                title={text.about.signOut}
                titleTone="muted"
                onPress={openSignOut}
                accessibilityLabel={text.about.signOut}
              />
            </SettingsGroup>
            {has("email") ? <Notice message={text.errors.email(SUPPORT_EMAIL)} selectable /> : null}
            {has("page") ? <Notice message={text.errors.link} /> : null}
          </View>

          <Footer />
          <DevToolsPanel />
        </View>
      </ScrollView>

      <ReminderTimePicker
        slot={editingSlot}
        value={reminders[editingSlot ?? "morning"]}
        onChange={changeReminder}
        onClose={() => setEditingSlot(null)}
      />
      <ConfirmDialog
        visible={dialogOpen}
        tone={dialogContent.destructive ? "destructive" : "default"}
        icon={dialogContent.icon}
        title={dialogStrings.title}
        body={dialogStrings.body}
        confirmLabel={dialogStrings.confirm}
        cancelLabel={dialogStrings.cancel}
        loading={busy}
        onConfirm={confirmDialog}
        onCancel={() => setDialogOpen(false)}
      >
        {dialog === "delete1" ? (
          <DeleteFirstExtras
            isPaid={isPaid}
            onExportFirst={() => openDialog("export")}
            onManage={manageFromDialog}
          />
        ) : null}
        {dialogError ? (
          <Text
            accessibilityLiveRegion="polite"
            className="mt-3 text-center text-body-sm text-rosewood"
          >
            {dialogError}
          </Text>
        ) : null}
      </ConfirmDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  photo: { width: 64, height: 64 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
