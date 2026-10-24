import { parseServiceAccount, type ServiceAccount } from "./googleAuth.ts";

// The speech settings (step 22), read from the function's secrets by the caller (nothing in _shared reads the
// environment). Speech is optional on purpose: with no credentials and no voice set it is simply off, and a reflection
// is still made and saved as text. The function therefore keeps working while the Google Cloud account is not ready, and
// speech switches on, with no new deploy, the moment the secrets are set. Something set but wrong or half-set is a
// different answer ("bad"), so that a typo does not look like "not switched on".
//
//   GOOGLE_TTS_CREDENTIALS_B64  the service account's JSON key file, base64 on one line (see googleAuth.ts)
//   TTS_VOICE_NAME              a Chirp 3 HD voice such as en-US-Chirp3-HD-<Name>: no voice name is written in code
//   TTS_SPEAKING_RATE           optional, 0.25 to 2.0; DEFAULT_SPEAKING_RATE when it is empty

// A little under normal speed, which suits a quiet devotional. The audition (audition.ts) is where it is chosen.
export const DEFAULT_SPEAKING_RATE = 0.92;

// Only Chirp 3 HD voices: they take the `markup` field and its pause tags, which script.ts writes. The language code is
// the voice name's first two parts, so the two cannot disagree.
const VOICE_NAME = /^[a-z]{2,3}-[A-Z]{2}-Chirp3-HD-[A-Za-z]{3,30}$/;

export type TtsConfig = {
  account: ServiceAccount;
  voiceName: string;
  languageCode: string;
  speakingRate: number;
};

export type TtsSetup =
  | { state: "ready"; config: TtsConfig }
  | { state: "off" }
  | { state: "bad"; name: string }; // the secret to look at

export function readTtsConfig(read: (name: string) => string | undefined): TtsSetup {
  const value = (name: string) => read(name)?.trim() || undefined;
  const credentials = value("GOOGLE_TTS_CREDENTIALS_B64");
  const voiceName = value("TTS_VOICE_NAME");
  const rateText = value("TTS_SPEAKING_RATE");

  if (credentials === undefined && voiceName === undefined) return { state: "off" };
  if (credentials === undefined) return { state: "bad", name: "GOOGLE_TTS_CREDENTIALS_B64" };
  if (voiceName === undefined) return { state: "bad", name: "TTS_VOICE_NAME" };

  const account = parseServiceAccount(credentials);
  if (account === null) return { state: "bad", name: "GOOGLE_TTS_CREDENTIALS_B64" };
  if (!VOICE_NAME.test(voiceName)) return { state: "bad", name: "TTS_VOICE_NAME" };

  let speakingRate = DEFAULT_SPEAKING_RATE;
  if (rateText !== undefined) {
    const rate = Number(rateText);
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 2) return { state: "bad", name: "TTS_SPEAKING_RATE" };
    speakingRate = rate;
  }
  return {
    state: "ready",
    config: { account, voiceName, languageCode: voiceName.split("-").slice(0, 2).join("-"), speakingRate },
  };
}
