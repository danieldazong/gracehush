import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "@/constants/copy";
import { colors, radii, shadows } from "@/constants/theme";

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  // Called once the sheet has finished closing. iOS only (React Native reports it when the modal is gone; Android has no such
  // event). A choice made in a sheet that opens another Modal waits for it, because iOS cannot present one Modal while another is
  // still on its way out.
  onDismiss?: () => void;
  children: ReactNode;
};

export function BottomSheet({ visible, onClose, onDismiss, children }: BottomSheetProps) {
  const { top } = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {/* A Modal is presented outside the app's root view on iOS, so a SafeAreaView in it needs a provider of its own. */}
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingTop: top }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.close}
            className="absolute inset-0 bg-ink/40"
            onPress={onClose}
          />
          <SafeAreaView edges={["bottom"]} style={[styles.sheet, shadows.sheet]}>
            <View style={styles.handle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  // flexShrink lets a tall sheet fit the space above the keyboard, so the ScrollView inside scrolls.
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.blush,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderTopWidth: 1,
    borderTopColor: colors.petal,
    padding: 24,
  },
  handle: {
    alignSelf: "center",
    width: 48,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.petal,
    marginBottom: 20,
  },
});
