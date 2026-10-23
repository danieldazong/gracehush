// One error format for every Edge Function: { error: { code, message, requestId } }.
// Each function's contract (process-entry/contracts.ts) lists the codes that function can answer with, and the app's
// copy of that list must match (src/types/contractParity.ts checks it). process-entry never answers NOT_FOUND;
// confirm-scripture does.

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
  | "CONTENT_BLOCKED"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE";

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
  CONTENT_BLOCKED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AI_UNAVAILABLE: 503,
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
  CONTENT_BLOCKED: "We couldn’t prepare a reflection for that entry.",
  RATE_LIMITED: "You’re going a little fast. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
  AI_UNAVAILABLE: "We couldn’t prepare your reflection right now. Please try again.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  // A short category for the log line. It is never sent to the client and never holds user content,
  // a token, a provider's message or SQL.
  readonly reason: string;

  constructor(code: ErrorCode, reason: string = code.toLowerCase()) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.reason = reason;
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
    { error: { code: error.code, message: MESSAGE_BY_CODE[error.code], requestId } },
    headers,
  );
}
