import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState, type RefObject } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { MAX_TEXT_LENGTH, TEXT_COUNTER_FROM } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { countWords } from "@/utils/format";

const icons = {
  pen: { android: "edit_note", ios: "square.and.pencil" },
} satisfies Record<string, SymbolViewProps["name"]>;

type WriteSectionProps = {
  text: string;
  onChangeText: (text: string) => void;
  // Owned by the screen, which focuses the field after the modal has opened.
  inputRef: RefObject<TextInputInstance | null>;
};

// The text lives in the screen's state until it is submitted, and nowhere else.
export function WriteSection({ text, onChangeText, inputRef }: WriteSectionProps) {
  const { write } = copy.newEntry;
  const reduceMotion = useReduceMotion();
  // True while the keyboard is up. The heading steps aside and the card shrinks to the space above the
  // footer, so the card stays whole: its rounded bottom and the word count are never behind the footer.
  const [typing, setTyping] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const ios = Platform.OS === "ios";

    function change(next: boolean, duration: number) {
      // On iOS the layout moves with the keyboard, on its curve, the way KeyboardAvoidingView does. Android
      // has no "will" events, so the layout follows once the keyboard has moved.
      if (ios && !reduceMotion) {
        const length = duration > 10 ? duration : 250;
        LayoutAnimation.configureNext({ duration: length, update: { duration: length, type: "keyboard" } });
      }
      setTyping(next);
    }

    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (event) =>
      change(true, event.duration),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (event) =>
      change(false, event.duration),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reduceMotion]);

  return (
    <View className="flex-1">
      {typing ? null : (
        <View className="mb-2 items-center">
          <Text accessibilityRole="header" className="text-center text-headline text-plum-deep">
            {write.title}
          </Text>
          <Text className="mt-1 text-center text-body-sm text-ink/80">{write.helper}</Text>
        </View>
      )}

      {/* The card fills the space down to the footer and the field scrolls inside it, so the caret stays in view as the text grows. */}
      <View
        className="card card--hero flex-1 p-6"
        style={[typing ? styles.cardTyping : styles.card, shadows.card]}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel={write.inputLabel}
          className="flex-1 p-0 text-body-lg text-ink"
          style={typing ? styles.inputTyping : styles.input}
          value={text}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          autoCapitalize="sentences"
          autoCorrect
          maxLength={MAX_TEXT_LENGTH}
          placeholder={write.placeholder}
          placeholderTextColor={colors.mauve}
          keyboardAppearance="light"
          underlineColorAndroid="transparent"
        />
        <View className="mt-3 flex-row items-center justify-between border-t border-petal pt-3">
          <View className="flex-row items-center gap-1.5">
            <Icon name={icons.pen} size={16} color={colors.mauve} />
            <Text className="text-label-md text-mauve">{write.words(countWords(text))}</Text>
          </View>
          {text.length >= TEXT_COUNTER_FROM ? (
            <Text className="text-body-sm text-mauve">{write.limit(text.length, MAX_TEXT_LENGTH)}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 260 },
  input: { minHeight: 200 },
  // With the keyboard up the card takes what is left above the footer, and the field scrolls inside it.
  // The input keeps three lines (26 each) so a very short screen scrolls the page before it squeezes them.
  cardTyping: { minHeight: 0 },
  inputTyping: { minHeight: 78 },
});
