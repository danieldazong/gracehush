// Reads the claims of a JWT without checking its signature. Only for telling the developer what a token carries
// (the key check at start-up, the Supabase check in the dev panel): the server is what trusts a token, never the app.
export function readJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (part === undefined || part === "") return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
