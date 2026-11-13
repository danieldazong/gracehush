// The phone's region (2026-11-11), which chooses the help line a heavy moment shows: the US and its territories use 988, 911 and
// the National Domestic Violence Hotline; anywhere else gets a directory of help lines and "your local emergency number", never
// a US number. It is the region subtag of the locale the system gives JavaScript ("en-US", "es-MX", "en-NG"), which Hermes has on
// both platforms; a region that cannot be read is the US, the app's market. The server reads the same two letters with the same
// rule (supabase/functions/_shared/safety/helpKind.ts regionOf).
export type Region = "us" | "other";

const US_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

// The two-letter region of a BCP 47 tag, or null: a language, an optional script, then the region ("zh-Hant-TW").
export function regionCode(locale: string | null | undefined): string | null {
  if (typeof locale !== "string") return null;
  const match = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(locale.replace(/_/g, "-"));
  return match === null ? null : match[1].toUpperCase();
}

export function regionOf(code: string | null): Region {
  return code === null || US_REGIONS.has(code) ? "us" : "other";
}

export function deviceRegionCode(): string | null {
  try {
    return regionCode(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

export function deviceRegion(): Region {
  return regionOf(deviceRegionCode());
}
