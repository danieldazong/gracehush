import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useAuthActions } from "@/hooks/useAuthActions";

const { sheet } = copy.auth;

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;
const FOCUS_DELAY_MS = 300;

type EmailSheetProps = {
  visible: boolean;
  onClose: () => void;
};

function boxClassName(isActive: boolean, hasError: boolean): string {
  const border = hasError
    ? "border border-rosewood"
    : isActive
      ? "border-[1.5px] border-plum"
      : "border border-petal";
  return `h-14 max-w-12 flex-1 items-center justify-center rounded-input bg-card ${border}`;
}

export function EmailSheet({ visible, onClose }: EmailSheetProps) {
  const { sendEmailCode, verifyEmailCode, resendEmailCode } = useAuthActions();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const emailInput = useRef<TextInput>(null);
  const codeInput = useRef<TextInput>(null);
  // Bumped whenever the flow is abandoned, so a request that finishes late is ignored.
  const session = useRef(0);

  useAnnounce(error);

  // Not autoFocus: inside a Modal on Android it focuses the field before the window has focus, which
  // leaves the keyboard closed, and React Native then ignores a second focus() on that field.
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const timer = setTimeout(() => {
      (step === "email" ? emailInput : codeInput).current?.focus();
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, step]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const trimmedEmail = email.trim();
  // A loose check on purpose: Clerk decides what is a valid address.
  const canSend = trimmedEmail.includes("@");

  function close() {
    session.current += 1;
    setStep("email");
    setEmail("");
    setCode("");
    setError(null);
    setSending(false);
    setVerifying(false);
    setSecondsLeft(0);
    onClose();
  }

  async function sendCode() {
    if (!canSend || sending) {
      return;
    }
    const id = session.current;
    setError(null);
    setSending(true);
    const result = await sendEmailCode(trimmedEmail);
    if (id !== session.current) {
      return;
    }
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEmail(trimmedEmail);
    setCode("");
    setSecondsLeft(RESEND_SECONDS);
    setStep("code");
  }

  async function verify(value: string) {
    const id = session.current;
    setError(null);
    setVerifying(true);
    const result = await verifyEmailCode(value);
    if (id !== session.current) {
      return;
    }
    setVerifying(false);
    // The navigator swaps this screen for the main tabs by itself once the session is active.
    if (result.ok) {
      close();
      return;
    }
    setCode("");
    setError(result.message);
    codeInput.current?.focus();
  }

  function changeCode(text: string) {
    if (verifying) {
      return;
    }
    const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH) {
      verify(digits);
    }
  }

  async function resend() {
    const id = session.current;
    setError(null);
    setCode("");
    setSecondsLeft(RESEND_SECONDS);
    const result = await resendEmailCode();
    if (id !== session.current) {
      return;
    }
    if (!result.ok) {
      setSecondsLeft(0);
      setError(result.message);
    }
    codeInput.current?.focus();
  }

  function changeEmail() {
    session.current += 1;
    setStep("email");
    setCode("");
    setError(null);
    setSecondsLeft(0);
  }

  const resendLabel = secondsLeft > 0 ? sheet.resendIn(secondsLeft) : sheet.resend;

  return (
    <BottomSheet visible={visible} onClose={close}>
      {step === "email" ? (
        <>
          <Text className="text-headline text-ink">{sheet.emailTitle}</Text>
          <Text className="mt-2 text-body text-mauve">{sheet.emailBody}</Text>
          <TextInput
            ref={emailInput}
            accessibilityLabel={sheet.emailLabel}
            className="input mt-6"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError(null);
            }}
            onSubmitEditing={sendCode}
            placeholder={sheet.emailPlaceholder}
            placeholderTextColor={colors.mauve}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            keyboardAppearance="light"
          />
          {error ? (
            <Text accessibilityLiveRegion="polite" className="mt-2 text-body-sm text-rosewood">
              {error}
            </Text>
          ) : null}
          <View className="mt-6">
            <PrimaryButton
              label={sheet.send}
              onPress={sendCode}
              disabled={!canSend}
              loading={sending}
            />
          </View>
        </>
      ) : (
        <>
          <Text className="text-headline text-ink">{sheet.codeTitle}</Text>
          <Text className="mt-2 text-body text-mauve">
            {sheet.codeBodyBefore}
            <Text className="font-dm-medium text-ink">{email}</Text>
            {sheet.codeBodyAfter}
          </Text>

          <View className="mt-6 h-14">
            <View className="h-14 flex-row justify-center gap-2">
              {Array.from({ length: CODE_LENGTH }, (_, index) => (
                <View
                  key={index}
                  className={boxClassName(!verifying && index === code.length, error !== null)}
                >
                  <Text
                    className="font-dm-semibold text-[22px] leading-[28px] text-ink"
                    style={styles.digit}
                  >
                    {code[index] ?? ""}
                  </Text>
                </View>
              ))}
            </View>
            <TextInput
              ref={codeInput}
              accessibilityLabel={sheet.codeLabel}
              style={styles.codeInput}
              value={code}
              onChangeText={changeCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              keyboardAppearance="light"
            />
          </View>

          <View className="mt-3 min-h-6 flex-row items-center justify-center gap-2">
            {verifying ? (
              <>
                <ActivityIndicator size="small" color={colors.plum} />
                <Text className="text-body-sm text-mauve">{sheet.verifying}</Text>
              </>
            ) : null}
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-center text-body-sm text-rosewood"
              >
                {error}
              </Text>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resendLabel}
            accessibilityState={{ disabled: verifying || secondsLeft > 0 }}
            disabled={verifying || secondsLeft > 0}
            className="mt-2 min-h-11 items-center justify-center"
            onPress={resend}
          >
            {/* plum, not rosewood: a text link on a blush surface is plum (AGENTS.md, colors) */}
            <Text className={secondsLeft > 0 ? "text-label-md text-mauve" : "text-label-md text-plum"}>
              {resendLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sheet.changeEmail}
            accessibilityState={{ disabled: verifying }}
            disabled={verifying}
            className="min-h-11 items-center justify-center"
            onPress={changeEmail}
          >
            <Text className="text-label-md text-mauve">{sheet.changeEmail}</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Laid over the boxes so a tap anywhere on the row focuses it. Not 0: Android hides a fully
  // transparent view from screen readers, and it ignores a transparent text color.
  codeInput: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.01 },
  digit: { fontVariant: ["tabular-nums"] },
});
