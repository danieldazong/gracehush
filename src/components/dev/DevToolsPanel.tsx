import { useAuth, useUser } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  getUsage,
  listEntries,
  listPrayers,
} from "@/data/journalRepository";
import type { MockScenario, MockSubmitOutcome } from "@/data/mock/scenario";
import {
  getAffirmationForSlot,
  getCurrentSlot,
  getPrayerCounts,
  getReflectionDays,
} from "@/data/selectors";
import type { MainTabScreenProps } from "@/navigation/types";
import { useDevStore } from "@/store/devStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import type { JournalEntry } from "@/types";
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
const SUBMIT_OUTCOMES: MockSubmitOutcome[] = ["ready", "crisis", "failed", "limit"];
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
): Promise<{ lines: string[]; targets: ReflectionTarget[] }> {
  const now = new Date();
  const [profile, usage, entries, prayers, affirmations] = await Promise.all([
    getProfile(),
    getUsage(),
    listEntries(),
    listPrayers(),
    getLatestAffirmations(),
  ]);
  const ready = entries.filter((entry) => entry.status === "ready" && !entry.isCrisis);
  const countStatus = (status: string) => entries.filter((entry) => entry.status === status).length;
  const scriptures = entries.flatMap((entry) => (entry.scripture ? [entry.scripture] : []));
  const prayerCounts = getPrayerCounts(prayers);
  const slot = getCurrentSlot(now, profile.reminders);
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
    `format: ${formatDuration(75000)} · ${formatDuration(58000)} · ${formatTime12("08:00")} · ${formatTime12("13:00")} · ${formatMonthYear(profile.createdAt)}`,
    `names: ${getDisplayName({ firstName: "Sarah", email: null })} | ${getInitials({ firstName: "Sarah", lastName: "Johnson", email: null })}, ${name("sarah.j92@example.com")} (from sarah.j92@example.com), ${name("x92@example.com")} (from x92@example.com)`,
  ];
  return { lines, targets: getReflectionTargets(entries) };
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
  const [lines, setLines] = useState<string[]>([]);
  const [targets, setTargets] = useState<ReflectionTarget[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadDataCheck(scenario).then((next) => {
      if (!cancelled) {
        setLines(next.lines);
        setTargets(next.targets);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  function openReflection(entryId: string | null) {
    if (entryId) navigation.navigate("Reflection", { entryId });
  }

  function openPlayer(entryId: string | null) {
    if (entryId) navigation.navigate("NowPlaying", { entryId });
  }

  // The session goes first: while it is live, RootNavigator marks onboarding completed again.
  // clearStorage removes only the onboarding key, never AsyncStorage as a whole.
  async function resetOnboardingDev() {
    await signOut();
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
          label="Open paywall (dev)"
          onPress={() => navigation.navigate("Paywall", { source: "profile" })}
        />
        {/* TODO(31): full sign-out cleanup */}
        <DevButton label="Sign out (dev)" onPress={() => signOut()} />
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
