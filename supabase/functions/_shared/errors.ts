// One error format for every Edge Function: { error: { code, message, requestId } }. The 402 (LIMIT_REACHED) also carries
// the saved entry's id and the week's usage beside `error` (step 22, AppError.details).
// Each function's contract (process-entry/contracts.ts) lists the codes that function can answer with, and the app's
// copy of that list must match (src/types/contractParity.ts checks it). process-entry never answers NOT_FOUND;
// confirm-scripture does, and so does delete-entry (which also answers ALREADY_PROCESSING, for a reflection that is still
// being made). sync-subscription (step 30) answers NOT_FOUND for a caller with no profile and BILLING_UNAVAILABLE when
// RevenueCat cannot be read. delete-account (step 31) answers DELETE_INCOMPLETE when a step of the deletion failed: what was done
// stays done, and the same request sent again continues.

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "LIMIT_REACHED"
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_SHORT"
  | "AUDIO_NOT_FOUND"
  | "NO_SPEECH"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE"
  | "BILLING_UNAVAILABLE"
  | "DELETE_INCOMPLETE";

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  LIMIT_REACHED: 402,
  METHOD_NOT_ALLOWED: 405,
  ALREADY_PROCESSING: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_SHORT: 422,
  AUDIO_NOT_FOUND: 422,
  NO_SPEECH: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AI_UNAVAILABLE: 503,
  BILLING_UNAVAILABLE: 503,
  DELETE_INCOMPLETE: 500,
};

// The only text a response ever carries about a failure: calm, user-safe, and never built from a provider's words.
export const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  INVALID_REQUEST: "We couldn’t read that request. Please try again.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "We couldn’t find this reflection.",
  LIMIT_REACHED: "You’ve reached this week’s free limit.",
  METHOD_NOT_ALLOWED: "That isn’t supported.",
  ALREADY_PROCESSING: "This reflection is still being prepared.",
  PAYLOAD_TOO_LARGE: "That’s too long to send. Please shorten it and try again.",
  TOO_SHORT: "Please share a little more and try again.",
  AUDIO_NOT_FOUND: "We couldn’t find your recording. Please try again.",
  NO_SPEECH: "We couldn’t hear any words in that recording.",
  RATE_LIMITED: "You’re going a little fast. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
  AI_UNAVAILABLE: "We couldn’t prepare your reflection right now. Please try again.",
  // Never shown in the app, which treats sync-subscription as best effort (step 30).
  BILLING_UNAVAILABLE: "We couldn’t check your subscription right now. Please try again in a moment.",
  DELETE_INCOMPLETE: "We couldn’t finish deleting your account. Please try again.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  // A short category for the log line. It is never sent to the client and never holds user content,
  // a token, a provider's message or SQL.
  readonly reason: string;
  // Values the function built itself (never the person's words, a provider's message or SQL), which errorResponse puts beside
  // `error` in the body. Only the 402 uses it (the entry that was saved and the week's usage). It is never logged.
  readonly details: Record<string, unknown> | null;

  constructor(code: ErrorCode, reason: string = code.toLowerCase(), details: Record<string, unknown> | null = null) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.reason = reason;
    this.details = details;
  }
}

export function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(error: AppError, requestId: string, headers: HeadersInit = {}): Response {
  return jsonResponse(
    error.status,
    { error: { code: error.code, message: MESSAGE_BY_CODE[error.code], requestId }, ...(error.details ?? {}) },
    headers,
  );
}
