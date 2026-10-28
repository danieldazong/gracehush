import { useAuth, useUser } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { getLastFunctionCall, type FunctionCall } from "@/api/journalApi";
import { ENTRIES_PAGE_SIZE } from "@/constants/app";
import {
  getLatestAffirmations,
  getProfile,
  getUsage,
  listEntries,
  listPrayers,
  setMockSubscriptionTier,
} from "@/data/journalRepository";
import { runProcessEntryCheck } from "@/components/dev/processEntryCheck";
import { supabaseEnv } from "@/constants/env";
import { getLastEntriesError } from "@/data/entriesRemote";
import {
  countVisibleProfileRows,
  getLastProfileError,
  selectProfileRow,
} from "@/data/profileRemote";
import type {
  DataSource,
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
} from "@/data/mock/scenario";
import {
  getAffirmationForSlot,
  getCurrentSlot,
  getPrayerCounts,
  getReflectionDays,
} from "@/data/selectors";
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
import type { MainTabScreenProps, RootStackParamList } from "@/navigation/types";
import { signOutCleanup } from "@/services/account";
import {
  getAffirmationScheduleSummary,
  rescheduleAffirmationsNow,
  scheduleTestAffirmation,
} from "@/services/affirmationScheduler";
import { countRawUploads, uploadRawRecording } from "@/services/mediaUpload";
import { listRecordings } from "@/services/recordingFiles";
import { resumeAfterUpgrade, subscribe, syncNow } from "@/services/syncEngine";
import {
  checkSessionToken,
  describeSessionToken,
  getSupabaseUserId,
  type SessionTokenCheck,
} from "@/services/supabaseClient";
import { useDevStore } from "@/store/devStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { JournalEntry, OutboxStatus, PermissionResult, SubscriptionTier } from "@/types";
import {
  formatDuration,
  formatEntryTimestamp,
  formatMonthYear,
  formatTime12,
  getDisplayName,
  getInitials,
} from "@/utils/format";

// Developer controls. Never shown to users, so the strings here stay inline (AGENTS.md "Copy & Tone
// Rules"). Later steps add their own controls to this panel as new sections.

const SCENARIOS: MockScenario[] = ["default", "empty", "offline"];
const SUBMIT_OUTCOMES: MockSubmitOutcome[] = ["ready", "crisis", "failed", "limit", "too_short"];
const OUTBOX_STATES: OutboxStatus[] = ["queued", "sending", "needs_action", "limit_reached", "paused_auth"];
const PLANS: SubscriptionTier[] = ["free", "trial", "pro"];
const DATA_SOURCES: DataSource[] = ["supabase", "mock"];
// The Journal's page size: the real one, and a small one that reaches the second page with a few entries.
const PAGE_SIZES: number[] = [ENTRIES_PAGE_SIZE, 5];

// The count of finished recordings kept on this phone (recordings/ in the app's own folder).
function recordingsLine(): string {
  return `recordings on this phone: ${listRecordings().length}`;
}

// How many reflections are in each state of the outbox: numbers only, never a word that was written.
async function outboxLine(): Promise<string> {
  if (!isDatabaseOpen()) return "outbox: the database is not open";
  try {
    const counts = await outbox.countsByStatus();
    return `outbox: ${OUTBOX_STATES.map((name) => `${name} ${counts[name] ?? 0}`).join(", ")}`;
  } catch {
    return "outbox: could not be read";
  }
}
const TOKEN_LABELS: Record<SessionTokenCheck, string> = {
  ok: "has role = authenticated",
  "no-role-claim": "NO role claim: activate the Supabase integration in Clerk",
  "no-session": "none",
  unreadable: "could not read it (offline?)",
};
// What the next mock purchase answers; it goes back to "success" after each one.
const PURCHASE_OUTCOMES: { value: MockPurchaseOutcome; label: string }[] = [
  { value: "success", label: "success" },
  { value: "cancelled", label: "cancelled" },
  { value: "pending", label: "pending" },
  { value: "failed", label: "failed" },
  { value: "not-allowed", label: "not allowed" },
  { value: "already-owned", label: "already owned" },
];
// "real" is the actual notification permission; the others override what Profile reads (see devStore).
const NOTIFICATION_STATUSES: (PermissionResult | "real")[] = [
  "real",
  "granted",
  "denied",
  "undetermined",
];
// An id no entry has, to reach Reflection's not-found view.
const MISSING_ENTRY_ID = "entry-missing-dev";

type ReflectionTarget = { label: string; entryId: string | null };

// The first entry of each kind in the current scenario, for the "Open reflection" row. A kind the
// scenario has no entry for (the empty one has none) gets null, and its button is disabled.
function getReflectionTargets(entries: JournalEntry[]): ReflectionTarget[] {
  const find = (match: (entry: JournalEntry) => boolean) =>
    entries.find(match)?.id ?? null;
  const isReady = (entry: JournalEntry) =>
    entry.status === "ready" && !entry.isCrisis && entry.devotional !== null;
  const hasAudio = (entry: JournalEntry) => Boolean(entry.devotional?.audioPath);

  return [
    { label: "Ready", entryId: find((entry) => isReady(entry) && hasAudio(entry)) },
    { label: "No audio", entryId: find((entry) => isReady(entry) && !hasAudio(entry)) },
    { label: "Typed", entryId: find((entry) => isReady(entry) && entry.inputType === "text") },
    { label: "Processing", entryId: find((entry) => entry.status === "processing") },
    { label: "Pending", entryId: find((entry) => entry.status === "pending") },
    { label: "Failed", entryId: find((entry) => entry.status === "failed") },
    { label: "Crisis", entryId: find((entry) => entry.isCrisis) },
    { label: "Not found", entryId: MISSING_ENTRY_ID },
  ];
}

async function loadDataCheck(
  scenario: MockScenario,
): Promise<{ lines: string[]; targets: ReflectionTarget[]; tier: SubscriptionTier }> {
  const now = new Date();
  const [profile, usage, entries, prayers, affirmations] = await Promise.all([
    getProfile().catch(() => null), // a failure here is shown by the Supabase check, not by this list
    getUsage(),
    listEntries(),
    listPrayers(),
    getLatestAffirmations(),
  ]);
  const ready = entries.filter((entry) => entry.status === "ready" && !entry.isCrisis);
  const countStatus = (status: string) => entries.filter((entry) => entry.status === status).length;
  const scriptures = entries.flatMap((entry) => (entry.scripture ? [entry.scripture] : []));
  const prayerCounts = getPrayerCounts(prayers);
  const slot = getCurrentSlot(now, profile?.reminders ?? useOnboardingStore.getState().reminders);
  const affirmation = getAffirmationForSlot(affirmations, slot);
  const first = ready[0];
  const name = (email: string | null) => getDisplayName({ firstName: null, email }) ?? "none";

  const lines = [
    `scenario: ${scenario}`,
    `entries: ${entries.length} (ready ${ready.length}, processing ${countStatus("processing")}, pending ${countStatus("pending")}, failed ${countStatus("failed")}, crisis ${entries.filter((entry) => entry.isCrisis).length})`,
    `reflection days: ${getReflectionDays(entries, now)}`,
    `prayers: active ${prayerCounts.active} · answered ${prayerCounts.answered} · total ${prayerCounts.total}`,
    `current slot: ${slot} → ${affirmation ? `"${affirmation.headline}"` : "none"}`,
    `plan: ${usage.used} of ${usage.limit ?? "unlimited"} (${usage.tier})`,
    `scripture verified: ${scriptures.filter((scripture) => scripture.verified).length}/${scriptures.length}`,
    `first card: ${
      first
        ? [
            formatEntryTimestamp(first.createdAt, now),
            first.dominantEmotion,
            first.scripture?.reference,
            formatDuration(first.devotional?.durationMs ?? 0),
          ].join(" · ")
        : "none"
    }`,
    `format: ${formatDuration(75000)} · ${formatDuration(58000)} · ${formatTime12("08:00")} · ${formatTime12("13:00")} · ${profile ? formatMonthYear(profile.createdAt) : "no profile"}`,
    `names: ${getDisplayName({ firstName: "Sarah", email: null })} | ${getInitials({ firstName: "Sarah", lastName: "Johnson", email: null })}, ${name("sarah.j92@example.com")} (from sarah.j92@example.com), ${name("x92@example.com")} (from x92@example.com)`,
  ];
  return { lines, targets: getReflectionTargets(entries), tier: usage.tier };
}

// The last Edge Function call as one line: its name, what came back and how long it took. No body, no id.
function describeFunctionCall(call: FunctionCall | null): string {
  if (call === null) return "none";
  const answer = call.status === 0 ? "no answer" : String(call.status);
  return `${call.name} ${answer}${call.code === null ? "" : ` ${call.code}`}, ${Math.round(call.ms / 100) / 10} s`;
}

// What the Supabase check shows on screen: yes or no and a code, never an id, a token or a row.
async function runSupabaseCheck(source: DataSource): Promise<string[]> {
  const signedIn = getSupabaseUserId() !== null;
  const lines = [
    `Supabase keys in .env.local: ${supabaseEnv.status === "ok" ? "yes" : "no"}`,
    `data source: ${source}`,
    `signed in: ${signedIn ? "yes" : "no"}`,
  ];
  if (supabaseEnv.status !== "ok" || !signedIn) return lines;
  lines.push(`Clerk token: ${TOKEN_LABELS[await checkSessionToken()]}`);
  // The issuer shown here is what the Edge Function's CLERK_ISSUER secret must be (step 19).
  const facts = await describeSessionToken();
  if (facts) {
    const yes = (value: boolean) => (value ? "yes" : "no");
    lines.push(
      `token issuer: ${facts.issuerHost ?? "none"} | sid ${yes(facts.sid)} | azp ${yes(facts.azp)} | sts ${facts.sts ?? "none"}`,
    );
  }
  const found = await selectProfileRow();
  lines.push(
    `profile row: ${found.ok ? (found.data === null ? "not found" : "found") : `error ${found.code}`}`,
  );
  // The columns step 18 added: a database without them has not had the v1 migration applied.
  if (found.ok && found.data !== null) {
    lines.push(`settings columns: ${"ambient_sound" in found.data ? "yes" : "NO: apply the step 18 migration"}`);
  }
  // Row level security: this must say 1 (or 0 before the row exists) even when the table holds other accounts.
  const visible = await countVisibleProfileRows();
  lines.push(`rows this user can see: ${visible.ok ? visible.data : `error ${visible.code}`}`);
  // Settings changed on this device that the server has not confirmed yet (names only, never values).
  const userId = getSupabaseUserId();
  const unsent = userId === null ? [] : Object.keys(useProfilePrefsStore.getState().byUser[userId]?.unsent ?? {});
  lines.push(`unsent settings: ${unsent.length === 0 ? "none" : unsent.join(", ")}`);
  lines.push(`last error: ${getLastProfileError() ?? "none"}`);
  lines.push(`last entries error: ${getLastEntriesError() ?? "none"}`);
  lines.push(`last function call: ${describeFunctionCall(getLastFunctionCall())}`);
  return lines;
}

type DevButtonProps = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
};

function DevButton({
  label,
  accessibilityLabel = label,
  onPress,
  selected,
  disabled = false,
}: DevButtonProps) {
  const className = ["btn-ghost", selected && "border-plum", disabled && "opacity-50"]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <View className={className}>
        <Text className="btn-ghost__label">{label}</Text>
      </View>
    </Pressable>
  );
}

function DevToolsContent() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const navigation = useNavigation<MainTabScreenProps<"Profile">["navigation"]>();
  const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding);
  const scenario = useDevStore((state) => state.scenario);
  const setScenario = useDevStore((state) => state.setScenario);
  const nextHomeLoadFails = useDevStore((state) => state.nextHomeLoadFails);
  const setNextHomeLoadFails = useDevStore((state) => state.setNextHomeLoadFails);
  const nextSubmitOutcome = useDevStore((state) => state.nextSubmitOutcome);
  const setNextSubmitOutcome = useDevStore((state) => state.setNextSubmitOutcome);
  const nextReflectionLoadFails = useDevStore((state) => state.nextReflectionLoadFails);
  const setNextReflectionLoadFails = useDevStore((state) => state.setNextReflectionLoadFails);
  const nextCrisisLinkFails = useDevStore((state) => state.nextCrisisLinkFails);
  const setNextCrisisLinkFails = useDevStore((state) => state.setNextCrisisLinkFails);
  const nextPrayerMutationFails = useDevStore((state) => state.nextPrayerMutationFails);
  const setNextPrayerMutationFails = useDevStore((state) => state.setNextPrayerMutationFails);
  const nextNetworkFails = useDevStore((state) => state.nextNetworkFails);
  const setNextNetworkFails = useDevStore((state) => state.setNextNetworkFails);
  const mockProfileVersion = useDevStore((state) => state.mockProfileVersion);
  const bumpMockProfileVersion = useDevStore((state) => state.bumpMockProfileVersion);
  const notificationStatusOverride = useDevStore((state) => state.notificationStatusOverride);
  const setNotificationStatusOverride = useDevStore((state) => state.setNotificationStatusOverride);
  const nextPurchaseOutcome = useDevStore((state) => state.nextPurchaseOutcome);
  const setNextPurchaseOutcome = useDevStore((state) => state.setNextPurchaseOutcome);
  const trialEligible = useDevStore((state) => state.trialEligible);
  const setTrialEligible = useDevStore((state) => state.setTrialEligible);
  const restoreFindsPurchase = useDevStore((state) => state.restoreFindsPurchase);
  const setRestoreFindsPurchase = useDevStore((state) => state.setRestoreFindsPurchase);
  const offeringUnavailable = useDevStore((state) => state.offeringUnavailable);
  const setOfferingUnavailable = useDevStore((state) => state.setOfferingUnavailable);
  const chosenDataSource = useDevStore((state) => state.dataSource);
  const setDataSource = useDevStore((state) => state.setDataSource);
  const pageSize = useDevStore((state) => state.pageSize);
  const setPageSize = useDevStore((state) => state.setPageSize);
  // Without a Supabase address in .env.local the mock is what the app really uses (getDataSource).
  const dataSource: DataSource = supabaseEnv.status === "ok" ? chosenDataSource : "mock";
  const [lines, setLines] = useState<string[]>([]);
  const [targets, setTargets] = useState<ReflectionTarget[]>([]);
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [supabaseLines, setSupabaseLines] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [processLines, setProcessLines] = useState<string[]>([]);
  const [processChecking, setProcessChecking] = useState(false);
  const [recordingLines, setRecordingLines] = useState<string[]>(() => [recordingsLine()]);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [affirmationLines, setAffirmationLines] = useState<string[]>(["affirmations: …"]);
  const [affirmationBusy, setAffirmationBusy] = useState(false);
  const [outboxText, setOutboxText] = useState("outbox: …");
  // The entries behind the paywall's "Limit + entry" and "Crisis entry" buttons.
  const readyEntryId = targets.find((target) => target.label === "Ready")?.entryId ?? null;
  const crisisEntryId = targets.find((target) => target.label === "Crisis")?.entryId ?? null;

  // Reloads when the mock plan changes too, so the "plan:" line and the selected plan button follow.
  useEffect(() => {
    let cancelled = false;
    loadDataCheck(scenario).then((next) => {
      if (!cancelled) {
        setLines(next.lines);
        setTargets(next.targets);
        setTier(next.tier);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scenario, mockProfileVersion]);

  // The outbox counts follow the sync engine: every change it makes to the queue refreshes them.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      outboxLine().then((line) => {
        if (!cancelled) setOutboxText(line);
      });
    };
    read();
    const stopFollowing = subscribe(read);
    return () => {
      cancelled = true;
      stopFollowing();
    };
  }, []);

  function changePlan(next: SubscriptionTier) {
    setMockSubscriptionTier(next);
    bumpMockProfileVersion();
    // What the free limit held back goes as soon as the plan is paid (a no-op on the free plan).
    void resumeAfterUpgrade();
  }

  // Profile and this panel reload through the mock profile version, as for a mock plan change. Journal Home follows the
  // data source itself.
  function changeDataSource(next: DataSource) {
    setDataSource(next);
    setSupabaseLines([]);
    bumpMockProfileVersion();
  }

  async function checkSupabase() {
    setChecking(true);
    setSupabaseLines(await runSupabaseCheck(dataSource));
    setChecking(false);
  }

  // Calls the deployed process-entry function with made-up text; each line appears as its case finishes.
  async function checkProcessEntry() {
    setProcessChecking(true);
    setProcessLines([]);
    await runProcessEntryCheck((line) => setProcessLines((current) => [...current, line]));
    setProcessChecking(false);
  }

  // The newest finished recording on this phone goes to the real bucket, under the signed-in user's raw/ folder.
  // The lines say ok or a code and a count, never a path, an id or a size.
  async function uploadLastRecording() {
    setRecordingBusy(true);
    const userId = getSupabaseUserId();
    const latest = listRecordings().sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    let result = "upload: no recording on this phone";
    if (userId === null) {
      result = "upload: not signed in";
    } else if (latest) {
      const uploaded = await uploadRawRecording(latest, userId);
      result = uploaded.ok ? "upload: ok" : `upload: ${uploaded.code}`;
    }
    setRecordingLines([recordingsLine(), result]);
    setRecordingBusy(false);
  }

  async function countUploads() {
    setRecordingBusy(true);
    const userId = getSupabaseUserId();
    const counted = userId === null ? null : await countRawUploads(userId);
    let result = "uploads: not signed in";
    if (counted?.ok) result = `uploads in your raw folder: ${counted.count}`;
    else if (counted) result = `uploads: ${counted.code}`;
    setRecordingLines([recordingsLine(), result]);
    setRecordingBusy(false);
  }

  // Step 28: how many affirmation notifications are scheduled and the next one's local day and time. Never a title or a
  // headline. "Reschedule" plans now; "Test in 10 s" sends one with the next planned title, headline and tap.
  async function showAffirmations(result: string | null) {
    const summary = await getAffirmationScheduleSummary().catch(() => null);
    const line =
      summary === null
        ? "affirmations: could not read"
        : `affirmations scheduled: ${summary.count}, next: ${summary.next ?? "none"}`;
    setAffirmationLines(result === null ? [line] : [line, result]);
  }

  async function rescheduleAffirmations() {
    setAffirmationBusy(true);
    await rescheduleAffirmationsNow();
    await showAffirmations("rescheduled");
    setAffirmationBusy(false);
  }

  async function testAffirmation() {
    setAffirmationBusy(true);
    const sent = await scheduleTestAffirmation(10_000);
    await showAffirmations(sent ? "test: in 10 s" : "test: nothing to send (switch, permission or reflection)");
    setAffirmationBusy(false);
  }

  // The session goes first, and the cleanup before it, as in Profile's own Sign out.
  async function signOutDev() {
    await signOutCleanup();
    await signOut();
  }

  function openReflection(entryId: string | null) {
    if (entryId) navigation.navigate("Reflection", { entryId });
  }

  function openPlayer(entryId: string | null) {
    if (entryId) navigation.navigate("NowPlaying", { entryId });
  }

  function openPaywall(params: RootStackParamList["Paywall"]) {
    navigation.navigate("Paywall", params);
  }

  // A paywall toggle also tells Profile to reload, so its plan card's button label follows.
  function setPaywallFlag(set: (value: boolean) => void, value: boolean) {
    set(value);
    bumpMockProfileVersion();
  }

  // The session goes first: while it is live, RootNavigator marks onboarding completed again.
  // clearStorage removes only the onboarding key, never AsyncStorage as a whole.
  async function resetOnboardingDev() {
    await signOutDev();
    resetOnboarding();
    useOnboardingStore.persist.clearStorage();
  }

  return (
    <View className="card gap-4">
      <Text className="eyebrow">Developer</Text>
      <Text className="text-body-sm text-mauve">{user?.primaryEmailAddress?.emailAddress}</Text>
      <View className="gap-2">
        {lines.length === 0 ? (
          <Text className="text-body-sm text-mauve">Loading…</Text>
        ) : (
          lines.map((line) => (
            <Text key={line} className="text-body-sm text-ink">
              {line}
            </Text>
          ))
        )}
      </View>
      <View className="flex-row flex-wrap justify-center gap-2">
        {SCENARIOS.map((name) => (
          <DevButton
            key={name}
            label={name}
            accessibilityLabel={`Mock scenario ${name} (dev)`}
            selected={name === scenario}
            onPress={() => setScenario(name)}
          />
        ))}
      </View>
      <View className="gap-2">
        <Text className="text-center text-body-sm text-mauve">
          Next submit (back to ready after each one)
        </Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {SUBMIT_OUTCOMES.map((name) => (
            <DevButton
              key={name}
              label={name}
              accessibilityLabel={`Next submit ${name} (dev)`}
              selected={name === nextSubmitOutcome}
              onPress={() => setNextSubmitOutcome(name)}
            />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-center text-body-sm text-mauve">Open reflection (dev)</Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {targets.map((target) => (
            <DevButton
              key={target.label}
              label={target.label}
              accessibilityLabel={`Open reflection ${target.label} (dev)`}
              disabled={target.entryId === null}
              onPress={() => openReflection(target.entryId)}
            />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-center text-body-sm text-mauve">Open player (dev)</Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {targets.map((target) => (
            <DevButton
              key={target.label}
              label={target.label}
              accessibilityLabel={`Open player ${target.label} (dev)`}
              disabled={target.entryId === null}
              onPress={() => openPlayer(target.entryId)}
            />
          ))}
        </View>
      </View>
      <View className="items-center gap-3">
        <DevButton
          label="Fail next Journal load (dev)"
          selected={nextHomeLoadFails}
          onPress={() => setNextHomeLoadFails(true)}
        />
        <DevButton
          label="Fail next Reflection load (dev)"
          selected={nextReflectionLoadFails}
          onPress={() => setNextReflectionLoadFails(true)}
        />
        <DevButton
          label="Fail next crisis link (dev)"
          selected={nextCrisisLinkFails}
          onPress={() => setNextCrisisLinkFails(true)}
        />
        {/* One flag for every mock write: a prayer change, a profile save, a data export and an account deletion. */}
        <DevButton
          label="Fail next save (dev)"
          selected={nextPrayerMutationFails}
          onPress={() => setNextPrayerMutationFails(true)}
        />
        {/* The next call the sync engine makes gets no answer, so its retries (5 s, 15 s, 60 s) can be watched. */}
        <DevButton
          label="Fail next network call (dev)"
          selected={nextNetworkFails}
          onPress={() => setNextNetworkFails(true)}
        />
        <View className="items-center gap-2">
          <Text className="text-center text-body-sm text-mauve">Outbox (dev)</Text>
          <Text className="text-center text-body-sm text-ink">{outboxText}</Text>
          <DevButton label="Sync now (dev)" onPress={() => void syncNow("manual")} />
        </View>
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Data source (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {DATA_SOURCES.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Data source ${name} (dev)`}
                selected={name === dataSource}
                onPress={() => changeDataSource(name)}
              />
            ))}
          </View>
          <Text className="text-center text-body-sm text-mauve">
            supabase: the real profile, entries and processing. mock: the step 06 data and the outcomes above.
          </Text>
          {supabaseEnv.status !== "ok" ? (
            <Text className="text-center text-body-sm text-mauve">
              No Supabase address in .env.local, so the app uses the mock.
            </Text>
          ) : null}
          <Text className="text-center text-body-sm text-mauve">Page size (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PAGE_SIZES.map((size) => (
              <DevButton
                key={size}
                label={String(size)}
                accessibilityLabel={`Page size ${size} (dev)`}
                selected={size === pageSize}
                onPress={() => setPageSize(size)}
              />
            ))}
          </View>
          <View className="items-center gap-2">
            <DevButton label="Supabase check (dev)" disabled={checking} onPress={checkSupabase} />
            {supabaseLines.map((line) => (
              <Text key={line} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
          </View>
          <View className="items-center gap-2">
            <DevButton
              label="Process-entry check (dev)"
              disabled={processChecking}
              onPress={checkProcessEntry}
            />
            {processLines.map((line, index) => (
              <Text key={`${index}-${line}`} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
          </View>
          <View className="items-center gap-2">
            <Text className="text-center text-body-sm text-mauve">Recordings (dev)</Text>
            {recordingLines.map((line) => (
              <Text key={line} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
            <View className="flex-row flex-wrap justify-center gap-2">
              <DevButton
                label="Upload last recording (dev)"
                disabled={recordingBusy}
                onPress={uploadLastRecording}
              />
              <DevButton label="Count my uploads (dev)" disabled={recordingBusy} onPress={countUploads} />
            </View>
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Mock plan (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PLANS.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Mock plan ${name} (dev)`}
                selected={name === tier}
                onPress={() => changePlan(name)}
              />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Notifications (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {NOTIFICATION_STATUSES.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Notification status ${name} (dev)`}
                selected={(notificationStatusOverride ?? "real") === name}
                onPress={() => setNotificationStatusOverride(name === "real" ? null : name)}
              />
            ))}
          </View>
        </View>
        <View className="items-center gap-2">
          <Text className="text-center text-body-sm text-mauve">Affirmation notifications (dev)</Text>
          {affirmationLines.map((line) => (
            <Text key={line} className="text-center text-body-sm text-ink">
              {line}
            </Text>
          ))}
          <View className="flex-row flex-wrap justify-center gap-2">
            <DevButton label="Show (dev)" disabled={affirmationBusy} onPress={() => void showAffirmations(null)} />
            <DevButton label="Reschedule now (dev)" disabled={affirmationBusy} onPress={rescheduleAffirmations} />
            <DevButton label="Test in 10 s (dev)" disabled={affirmationBusy} onPress={testAffirmation} />
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Paywall (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            <DevButton
              label="Profile"
              accessibilityLabel="Open paywall from Profile (dev)"
              onPress={() => openPaywall({ source: "profile" })}
            />
            <DevButton
              label="Limit"
              accessibilityLabel="Open paywall from the limit (dev)"
              onPress={() => openPaywall({ source: "limit" })}
            />
            <DevButton
              label="Limit + entry"
              accessibilityLabel="Open paywall from the limit with an entry (dev)"
              disabled={readyEntryId === null}
              onPress={() => {
                if (readyEntryId) openPaywall({ source: "limit", entryId: readyEntryId });
              }}
            />
            <DevButton
              label="Crisis entry"
              accessibilityLabel="Open paywall for a crisis entry (dev)"
              disabled={crisisEntryId === null}
              onPress={() => {
                if (crisisEntryId) openPaywall({ source: "limit", entryId: crisisEntryId });
              }}
            />
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Next purchase (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PURCHASE_OUTCOMES.map(({ value, label }) => (
              <DevButton
                key={value}
                label={label}
                accessibilityLabel={`Next purchase ${label} (dev)`}
                selected={value === nextPurchaseOutcome}
                onPress={() => setNextPurchaseOutcome(value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row flex-wrap justify-center gap-2">
          <DevButton
            label="Trial eligible (dev)"
            selected={trialEligible}
            onPress={() => setPaywallFlag(setTrialEligible, !trialEligible)}
          />
          <DevButton
            label="Restore finds purchase (dev)"
            selected={restoreFindsPurchase}
            onPress={() => setPaywallFlag(setRestoreFindsPurchase, !restoreFindsPurchase)}
          />
          <DevButton
            label="Plans unavailable (dev)"
            selected={offeringUnavailable}
            onPress={() => setPaywallFlag(setOfferingUnavailable, !offeringUnavailable)}
          />
        </View>
        <DevButton label="Sign out (dev)" onPress={signOutDev} />
        <DevButton label="Reset onboarding (dev)" onPress={resetOnboardingDev} />
        <Text className="text-center text-body-sm text-mauve">
          To re-test permission prompts, delete the app or reset permissions in device settings.
        </Text>
      </View>
    </View>
  );
}

// Development builds only. Release builds render nothing.
export function DevToolsPanel() {
  return __DEV__ ? <DevToolsContent /> : null;
}
