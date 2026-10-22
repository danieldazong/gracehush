// Turns what Supabase answered into the failure codes a RepoResult carries. Pure: no copy, no logging.

export const NO_SESSION_ERROR_NAME = "NoSessionError";

// Thrown by the Supabase client's token callback when a request would go out without a signed-in user, so an
// anonymous request can never leave the app (supabase-js would otherwise send its API key as the bearer token).
export class NoSessionError extends Error {
  constructor() {
    super("There is no signed-in session.");
    this.name = NO_SESSION_ERROR_NAME;
  }
}

export type SupabaseFailureCode = "NETWORK" | "UNAUTHORIZED" | "UNKNOWN";

type SupabaseErrorLike = { message?: string | null; code?: string | null };

// `status` is the HTTP status of the answer, or 0 when none came back. postgrest-js 2.118 reports a rejected
// fetch as status 0 with the error's name and message, and that includes a token callback that threw: a failed
// Clerk token request (offline) is NETWORK, and our own NoSessionError is UNAUTHORIZED.
export function toFailureCode(status: number, error: SupabaseErrorLike): SupabaseFailureCode {
  const message = error.message ?? "";
  const code = error.code ?? "";
  if (status === 0) {
    return message.startsWith(NO_SESSION_ERROR_NAME) ? "UNAUTHORIZED" : "NETWORK";
  }
  // 401: the token was refused (PGRST301 to PGRST303). 403 and 42501: row level security or a missing grant.
  if (status === 401 || status === 403 || code.startsWith("PGRST30") || code === "42501") {
    return "UNAUTHORIZED";
  }
  return "UNKNOWN";
}

// What a development warning may say: the table and the error code, never a message, a row, a token or an id.
export function describeFailure(table: string, status: number, error: SupabaseErrorLike): string {
  const reason = error.code || (status === 0 ? "no answer" : `HTTP ${status}`);
  return `${table}: ${reason}`;
}
