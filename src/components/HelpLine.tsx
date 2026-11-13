import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import {
  DV_HOTLINE_NUMBER,
  DV_TEXT_BODY,
  DV_TEXT_NUMBER,
  EMERGENCY_NUMBER,
  HELPLINE_NUMBER,
} from "@/constants/crisisResources";
import { colors } from "@/constants/theme";
import { type LinkResult, openPhoneCall, openTextMessage, openWebPage } from "@/services/externalLinks";
import type { HelpKind } from "@/types";
import { type HelpAction, helpActions } from "@/utils/helpLine";
import { deviceRegion, type Region } from "@/utils/region";

const { help } = copy.reflection;

const icons = {
  call: { android: "call", ios: "phone.fill" },
  text: { android: "chat_bubble_outline", ios: "message.fill" },
  web: { android: "public", ios: "globe" },
} satisfies Record<HelpAction["kind"], SymbolViewProps["name"]>;

// The line itself, for the help line saved with the reflection and the phone's region.
export function helpLineText(kind: HelpKind, region: Region): string {
  if (region === "other") return kind === "emergency" ? help.emergencyElsewhere : help.elsewhere;
  switch (kind) {
    case "abuse":
      return help.abuse(DV_HOTLINE_NUMBER, DV_TEXT_BODY, DV_TEXT_NUMBER, EMERGENCY_NUMBER);
    case "harm_others":
      return help.harmOthers(HELPLINE_NUMBER, EMERGENCY_NUMBER);
    case "emergency":
      return help.emergency(EMERGENCY_NUMBER);
    default:
      return help.crisis(HELPLINE_NUMBER, EMERGENCY_NUMBER);
  }
}

// What a button says, says to a screen reader, and says when the phone cannot open it.
export function helpActionWords(action: HelpAction): { label: string; a11y: string; hint: string; failed: string } {
  switch (action.kind) {
    case "call":
      if (action.service === "hotline") {
        return {
          label: help.callHotline,
          a11y: help.a11y.callHotline(DV_HOTLINE_NUMBER),
          hint: help.hints.call,
          failed: help.failed.call(DV_HOTLINE_NUMBER),
        };
      }
      return {
        label: help.call(action.number),
        a11y: action.service === "emergency" ? help.a11y.callEmergency(action.number) : help.a11y.callLifeline(action.number),
        hint: help.hints.call,
        failed: help.failed.call(action.number),
      };
    case "text":
      return action.body === null
        ? {
          label: help.text(action.number),
          a11y: help.a11y.textLifeline(action.number),
          hint: help.hints.text,
          failed: help.failed.text(action.number, null),
        }
        : {
          label: help.textBody(action.body),
          a11y: help.a11y.textHotline(action.body, action.number),
          hint: help.hints.text,
          failed: help.failed.text(action.number, action.body),
        };
    case "web":
      return { label: help.find, a11y: help.a11y.find, hint: help.hints.web, failed: help.failed.web };
  }
}

function run(action: HelpAction): Promise<LinkResult> {
  if (action.kind === "call") return openPhoneCall(action.number);
  if (action.kind === "text") return openTextMessage(action.number, action.body);
  return openWebPage(action.url);
}

// The one quiet line a heavy moment's reflection carries, under its devotional (2026-11-08, when Support Resources was removed):
// that the person need not carry this alone, the numbers for their situation, and a tap for each way to reach someone (2026-11-11,
// the readers' table: call or text 988, call or text the National Domestic Violence Hotline for a person someone is hurting, call
// 911 in an emergency, and outside the US a directory of help lines). Calm on purpose: mauve and plum, never red, no animation,
// no haptic, and nothing logged (AGENTS.md Crisis Safety Rules). The phone app asks before it dials, and the messages app sends
// nothing by itself.
export function HelpLine({ kind = "crisis" }: { kind?: HelpKind | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const region = deviceRegion();
  const helpKind = kind ?? "crisis";
  const actions = helpActions(helpKind, region);

  async function press(action: HelpAction, words: string) {
    const result = await run(action);
    setFailed(result.ok ? null : words);
  }

  return (
    <View className="items-center gap-1 px-2">
      <Text className="text-center text-body-sm text-mauve">{helpLineText(helpKind, region)}</Text>
      {actions.length > 0 ? (
        <View className="flex-row flex-wrap items-center justify-center">
          {actions.map((action) => {
            const words = helpActionWords(action);
            return (
              <Pressable
                key={`${action.kind}-${action.service}`}
                accessibilityRole="button"
                accessibilityLabel={words.a11y}
                accessibilityHint={words.hint}
                onPress={() => void press(action, words.failed)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="min-h-11 flex-row items-center justify-center gap-1.5 px-3">
                  <Icon name={icons[action.kind]} size={16} color={colors.plum} />
                  <Text className="text-label-md text-plum">{words.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {failed !== null ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
          {failed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
