import { AppError } from "./errors.ts";

// A missing secret fails fast with a log line that names the variable and nothing else (never its value).
export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new AppError("INTERNAL", `missing_config:${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}
