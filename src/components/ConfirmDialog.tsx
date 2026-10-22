import type { SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { colors } from "@/constants/theme";

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  // "destructive" makes the confirm button crisis red, for deleting something.
  tone?: "default" | "destructive";
  icon?: SymbolViewProps["name"];
  // While true both buttons are off and the scrim and Android back do nothing.
  loading?: boolean;
  // A slot between the body and the buttons.
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

// The card never gets taller than this share of the window. Below it nothing changes; above it (a small
// phone at large text, or the Profile delete dialog with its subscription warning) the content scrolls
// instead of running off the screen.
const MAX_HEIGHT_SHARE = 0.9;

// A centered confirmation. The buttons are stacked because side by side they need more room than the
// card has at large text sizes.
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = "default",
  icon,
  loading = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const destructive = tone === "destructive";
  const { height } = useWindowDimensions();

  function cancel() {
    if (!loading) onCancel();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <View className="screen__content flex-1 items-center justify-center">
        {/* The cancel button does the same as the scrim, so the scrim is not a second control. */}
        <Pressable accessible={false} className="absolute inset-0 bg-ink/40" onPress={cancel} />
        {/* The card clips its scrolling content to its rounded corners. */}
        <View
          accessibilityViewIsModal
          className="overflow-hidden rounded-hero bg-card"
          style={[styles.card, { maxHeight: height * MAX_HEIGHT_SHARE }]}
        >
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {icon ? (
              // A destructive dialog with an icon gets the crisis-red tile (the Profile delete dialogs); the
              // others keep the blush tile.
              <View
                className={
                  destructive
                    ? "mb-3 size-11 items-center justify-center rounded-full bg-crisis/12"
                    : "mb-3 size-11 items-center justify-center rounded-full bg-blush"
                }
              >
                <Icon name={icon} size={22} color={destructive ? colors.crisis : colors.plumDeep} />
              </View>
            ) : null}
            <Text accessibilityRole="header" className="text-center text-section text-plum-deep">
              {title}
            </Text>
            <Text className="mt-2 text-center text-body text-ink/80">{body}</Text>
            {children}
            <View className="mt-6 w-full gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                accessibilityState={{ disabled: loading, busy: loading }}
                disabled={loading}
                onPress={onConfirm}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className={destructive ? "btn-critical" : "btn-primary"}>
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className={destructive ? "btn-critical__label" : "btn-primary__label"}>
                      {confirmLabel}
                    </Text>
                  )}
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                accessibilityState={{ disabled: loading }}
                disabled={loading}
                onPress={onCancel}
                style={({ pressed }) => [pressed && styles.pressed, loading && styles.disabled]}
              >
                <View className="btn-ghost">
                  <Text className="btn-ghost__label">{cancelLabel}</Text>
                </View>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 340 },
  // The card's padding (p-6), centered like before: it scrolls with the content.
  content: { alignItems: "center", padding: 24 },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});
