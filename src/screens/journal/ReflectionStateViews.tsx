import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { Skeleton } from "@/components/Skeleton";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const { states, footer } = copy.reflection;

// A calm message in the middle of the screen. A ScrollView, so it still scrolls at large text sizes.
function CenteredScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.centered}>
      <View className="screen__content">{children}</View>
    </ScrollView>
  );
}

type MessageViewProps = {
  title: string;
  body?: string;
  busy?: boolean;
  // The buttons.
  children: ReactNode;
};

// "Still preparing", "failed", "not found" and "error" differ only in their strings and buttons.
export function MessageView({ title, body, busy = false, children }: MessageViewProps) {
  return (
    <CenteredScroll>
      <View className="items-center gap-3">
        {busy ? <ActivityIndicator size="small" color={colors.plum} /> : null}
        <Text accessibilityRole="header" className="text-center text-headline text-plum-deep">
          {title}
        </Text>
        {body ? <Text className="text-center text-body text-mauve">{body}</Text> : null}
        <View className="mt-3 w-full max-w-[320px] gap-2">{children}</View>
      </View>
    </CenteredScroll>
  );
}

// The skeleton of the ready view: headline and subline, the player card, the scripture card and the carousel.
export function ReflectionLoading() {
  return (
    <View
      accessible
      accessibilityLabel={states.loading}
      accessibilityState={{ busy: true }}
      className="screen__content pt-4"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-4"
      >
        <View className="gap-2 pt-1">
          <Skeleton width="90%" height={30} radius={8} />
          <Skeleton width="65%" height={30} radius={8} />
          <Skeleton width="55%" height={14} radius={8} />
        </View>
        <Skeleton height={126} />
        <Skeleton height={200} />
        <Skeleton height={280} />
      </View>
    </View>
  );
}

// Pending, uploading and processing entries. Nothing polls yet (step 25).
export function ReflectionPreparing({ onReturn }: { onReturn: () => void }) {
  return (
    <MessageView title={states.preparing.title} body={states.preparing.body} busy>
      <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
    </MessageView>
  );
}

// A failed entry, and a finished one without a devotional (which real data cannot produce).
export function ReflectionFailed({ onReturn }: { onReturn: () => void }) {
  return (
    <MessageView title={states.failed.title} body={states.failed.body}>
      {/* TODO(25): "Try again" on this view */}
      <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
    </MessageView>
  );
}

export function ReflectionNotFound({ onReturn }: { onReturn: () => void }) {
  return (
    <MessageView title={states.notFound}>
      <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
    </MessageView>
  );
}

type ReflectionErrorProps = {
  onRetry: () => void;
  onReturn: () => void;
};

export function ReflectionError({ onRetry, onReturn }: ReflectionErrorProps) {
  return (
    <MessageView title={states.error.message}>
      <PrimaryButton label={states.error.retry} onPress={onRetry} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={footer.returnToJournal}
        className="min-h-11 items-center justify-center"
        onPress={onReturn}
      >
        <Text className="btn-text__label">{footer.returnToJournal}</Text>
      </Pressable>
    </MessageView>
  );
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: "center", paddingVertical: 24 },
});
