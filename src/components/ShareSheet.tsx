import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { MODAL_HANDOFF_FALLBACK_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
import { openSystemShare, shareToApp } from "@/services/externalLinks";

const icons = {
  more: { android: "more_horiz", ios: "ellipsis" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ShareSheetProps = {
  // The message to share, or null while the panel is closed.
  text: string | null;
  // Whether the phone has WhatsApp (useShareSheet).
  whatsApp: boolean;
  onClose: () => void;
};

type Tile = {
  key: string;
  label: string;
  accessibilityLabel: string;
  hint: string;
  // A bundled tile (images.ts), or null for More, which draws its own circle.
  source: typeof images.shareWhatsApp | null;
  send: (message: string) => Promise<void>;
};

// GraceHush's share panel (2026-11-16, the owner's request: after sharing, the person ends up in the chat they chose), laid out
// as TikTok's and Instagram's are: one row of app tiles. WhatsApp and Messages open the app itself with the message typed in,
// so the person picks the chat there, taps Send and stays in it; More is the iPhone's share menu, for Copy and every other app,
// each of which closes back into GraceHush after Send, as iOS does. A choice goes on after the panel has gone: iOS cannot open
// the share menu while another sheet is leaving, so on iOS it waits for the dismissal (or the fallback timer, once); Android
// goes on at once. No haptic, no event, nothing logged.
export function ShareSheet({ text, whatsApp, onClose }: ShareSheetProps) {
  const after = useRef<(() => void) | null>(null);

  function runAfter() {
    const run = after.current;
    after.current = null;
    run?.();
  }

  function choose(send: (message: string) => Promise<void>) {
    if (text === null) return;
    const message = text;
    after.current = () => void send(message);
    onClose();
    if (Platform.OS === "ios") setTimeout(runAfter, MODAL_HANDOFF_FALLBACK_MS);
    else runAfter();
  }

  const tiles: Tile[] = [
    ...(whatsApp
      ? [
          {
            key: "whatsApp",
            label: copy.share.whatsApp,
            accessibilityLabel: copy.share.whatsApp,
            hint: copy.share.whatsAppHint,
            source: images.shareWhatsApp,
            send: (message: string) => shareToApp("whatsApp", message),
          },
        ]
      : []),
    {
      key: "messages",
      label: copy.share.messages,
      accessibilityLabel: copy.share.messages,
      hint: copy.share.messagesHint,
      source: images.shareMessages,
      send: (message: string) => shareToApp("messages", message),
    },
    {
      key: "more",
      label: copy.share.more,
      accessibilityLabel: copy.share.moreLabel,
      hint: copy.share.moreHint,
      source: null,
      send: openSystemShare,
    },
  ];

  return (
    <BottomSheet visible={text !== null} onClose={onClose} onDismiss={runAfter}>
      <Text accessibilityRole="header" className="text-section text-plum-deep">
        {copy.share.title}
      </Text>
      <View className="mt-4 flex-row">
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.accessibilityLabel}
            accessibilityHint={tile.hint}
            onPress={() => choose(tile.send)}
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
          >
            <View className="items-center gap-2">
              {tile.source !== null ? (
                <Image source={tile.source} contentFit="contain" style={styles.tile} />
              ) : (
                <View className="size-14 items-center justify-center rounded-full border border-petal bg-card">
                  <Icon name={icons.more} size={24} color={colors.plum} />
                </View>
              )}
              <Text numberOfLines={1} maxFontSizeMultiplier={1.3} className="text-body-sm text-ink">
                {tile.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

// expo-image and the Pressable's pressed state take a style, not a className (Style Exception Rules).
const styles = StyleSheet.create({
  // Four tiles to a row at most, as the big apps' share panels: a quarter of the panel each, left-aligned.
  cell: { width: "25%" },
  tile: { width: 56, height: 56 },
  pressed: { opacity: 0.6 },
});
