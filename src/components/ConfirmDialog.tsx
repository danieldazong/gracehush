import type { SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

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
        <View
          accessibilityViewIsModal
          className="items-center rounded-hero bg-card p-6"
          style={styles.card}
        >
          {icon ? (
            <View className="mb-3 size-11 items-center justify-center rounded-full bg-blush">
              <Icon name={icon} size={22} color={colors.plumDeep} />
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 340 },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});
