import { isClerkAPIResponseError, useSSO, useSignIn, useSignUp } from "@clerk/expo";
import { useSignInWithApple, type StartAppleAuthenticationFlowReturnType } from "@clerk/expo/apple";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { copy } from "@/constants/copy";
import type { AuthErrorCode, AuthResult } from "@/types";

const messages = copy.auth.errors;

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Expo Go has no native Google module, so @clerk/expo/google must not be loaded there. The hook is
// picked once at module load, which keeps the rules of hooks intact.
function useNoGoogleFlow() {
  return { startGoogleAuthenticationFlow: undefined };
}

const useGoogleFlow = inExpoGo
  ? useNoGoogleFlow
  : // eslint-disable-next-line @typescript-eslint/no-require-imports -- a top-level import would crash Expo Go
    (require("@clerk/expo/google") as typeof import("@clerk/expo/google")).useSignInWithGoogle;

function devLog(message: string) {
  if (__DEV__) {
    console.log(`[auth] ${message}`);
  }
}

function failure(code: AuthErrorCode, message: string): AuthResult {
  return { ok: false, code, message };
}

const OK: AuthResult = { ok: true };
const CANCELLED = failure("CANCELLED", "");
const PROVIDER_UNAVAILABLE = failure("NOT_SUPPORTED", messages.providerUnavailable);

function errorCode(error: unknown): string | undefined {
  if (isClerkAPIResponseError(error)) {
    return error.errors[0]?.code;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
  }
  return undefined;
}

function toFailure(error: unknown): AuthResult {
  const code = errorCode(error);
  const status = isClerkAPIResponseError(error) ? error.status : undefined;

  if (code === "ERR_REQUEST_CANCELED" || code === "SIGN_IN_CANCELLED" || code === "-5") {
    return CANCELLED;
  }
  if (status === 429) {
    return failure("RATE_LIMITED", messages.rateLimited);
  }
  // React Native's fetch rejects with TypeError("Network request failed") when nothing answers.
  if (error instanceof TypeError && /network/i.test(error.message)) {
    return failure("NETWORK", messages.network);
  }

  switch (code) {
    case "form_param_format_invalid":
      return failure("INVALID_EMAIL", messages.invalidEmail);
    case "form_code_incorrect":
      return failure("INVALID_CODE", messages.invalidCode);
    case "verification_expired":
      return failure("INVALID_CODE", messages.codeExpired);
    case "verification_failed":
    case "too_many_requests":
    case "verification_code_too_many_requests":
    case "verification_code_rate_limit_exceeded":
    case "verification_code_too_many_attempts":
      return failure("RATE_LIMITED", messages.rateLimited);
    case "network_error":
    case "clerk_offline":
    case "gateway_timeout":
      return failure("NETWORK", messages.network);
    case "sign_up_if_missing_not_allowed":
    case "sign_up_if_missing_strategy_not_supported":
    case "strategy_for_user_invalid":
      devLog(`instance setting blocks the flow: ${code}`);
      return failure("UNKNOWN", messages.unknown);
    default:
      devLog(`error code: ${code ?? "none"}, status: ${status ?? "none"}`);
      return failure("UNKNOWN", messages.unknown);
  }
}

// Clerk reports most failures as a returned { error }, but a dropped connection can still throw.
async function run(action: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await action();
  } catch (error: unknown) {
    return toFailure(error);
  }
}

// Clerk calls `navigate` just before it sets the session. A session with a pending task counts as
// signed out (treatPendingAsSignedOut), so we only record the task: React Navigation switches screens
// by itself once the session is active.
function trackSessionTask() {
  let pending = false;
  return {
    navigate: ({ session }: { session: { currentTask?: { key: string } } }) => {
      if (session.currentTask) {
        pending = true;
        devLog(`session task pending: ${session.currentTask.key}`);
      }
    },
    outcome: (): AuthResult => (pending ? failure("UNKNOWN", messages.extraVerification) : OK),
  };
}

function isNewUserTransfer(error: unknown): boolean {
  return isClerkAPIResponseError(error) && error.errors[0]?.code === "sign_up_if_missing_transfer";
}

// The native Apple and Google flows end the same way: no session id means the prompt was cancelled.
async function activateSession({
  createdSessionId,
  setActive,
}: StartAppleAuthenticationFlowReturnType): Promise<AuthResult> {
  if (!createdSessionId || !setActive) {
    return CANCELLED;
  }
  const task = trackSessionTask();
  await setActive({ session: createdSessionId, navigate: task.navigate });
  return task.outcome();
}

function googleIsConfigured(): boolean {
  const extra = Constants.expoConfig?.extra ?? {};
  const platformClientId =
    Platform.OS === "ios"
      ? "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID"
      : "EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID";
  return ["EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID", platformClientId].every(
    (key) => typeof extra[key] === "string" && extra[key] !== "",
  );
}

export function useAuthActions() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useGoogleFlow();
  const { startSSOFlow } = useSSO();

  const continueWithApple = () =>
    run(async () => {
      if (inExpoGo || Platform.OS !== "ios") {
        return PROVIDER_UNAVAILABLE;
      }
      return activateSession(await startAppleAuthenticationFlow());
    });

  const continueWithGoogle = () =>
    run(async () => {
      // Expo Go has no native Google module, so it signs in through Clerk's browser flow instead.
      if (inExpoGo) {
        return activateSession(await startSSOFlow({ strategy: "oauth_google" }));
      }
      if (!startGoogleAuthenticationFlow) {
        return PROVIDER_UNAVAILABLE;
      }
      if (!googleIsConfigured()) {
        if (__DEV__) {
          console.warn("[auth] Google client IDs are missing: set the EXPO_PUBLIC_CLERK_GOOGLE_* values.");
        }
        return PROVIDER_UNAVAILABLE;
      }
      return activateSession(await startGoogleAuthenticationFlow());
    });

  // Sign-in-or-up: Clerk sends a code whether or not the account exists, so nothing here reveals
  // which emails have accounts. New users are told apart only after the code is verified.
  const sendEmailCode = (email: string) =>
    run(async () => {
      const created = await signIn.create({
        identifier: email.trim().toLowerCase(),
        signUpIfMissing: true,
      });
      if (created.error) {
        return toFailure(created.error);
      }
      const sent = await signIn.emailCode.sendCode();
      return sent.error ? toFailure(sent.error) : OK;
    });

  const verifyEmailCode = (code: string) =>
    run(async () => {
      const task = trackSessionTask();
      const verified = await signIn.emailCode.verifyCode({ code });

      if (verified.error) {
        if (!isNewUserTransfer(verified.error)) {
          return toFailure(verified.error);
        }
        // New user: the code was right, so turn the sign-in attempt into an account.
        const transferred = await signUp.create({ transfer: true });
        if (transferred.error) {
          return toFailure(transferred.error);
        }
        if (signUp.status !== "complete") {
          devLog(`sign-up status: ${signUp.status}`);
          if (signUp.status === "missing_requirements") {
            devLog(`sign-up needs: ${signUp.missingFields.join(", ")}`);
          }
          return failure("UNKNOWN", messages.unknown);
        }
        const created = await signUp.finalize({ navigate: task.navigate });
        return created.error ? toFailure(created.error) : task.outcome();
      }

      if (signIn.status !== "complete") {
        devLog(`sign-in status: ${signIn.status}`);
        const needsMore =
          signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust";
        return failure("UNKNOWN", needsMore ? messages.extraVerification : messages.unknown);
      }
      const finalized = await signIn.finalize({ navigate: task.navigate });
      return finalized.error ? toFailure(finalized.error) : task.outcome();
    });

  const resendEmailCode = () =>
    run(async () => {
      const sent = await signIn.emailCode.sendCode();
      return sent.error ? toFailure(sent.error) : OK;
    });

  return { continueWithApple, continueWithGoogle, sendEmailCode, verifyEmailCode, resendEmailCode };
}
