// A listening test for the spoken devotional's voice (step 22). By hand: it needs the service account's key, it makes real
// Text-to-Speech calls and spends a little of the monthly free allowance, and it is never deployed.
//
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
//     --allow-net --allow-env --allow-read --allow-write=tts-audition --env-file=supabase/functions/.env.local \
//     supabase/functions/_shared/tts/audition.ts [--voices Aoede,Leda,Sulafat,Achernar] [--rates 0.88,0.95] \
//       [--one en-US-Chirp3-HD-Aoede@0.92]
//
// It needs only GOOGLE_TTS_CREDENTIALS_B64 (the voice is what it helps to choose). It asks Google which Chirp 3 HD voices
// exist, then reads the same made-up devotional in each voice at each speed and writes one WAV per pair to tts-audition/
// (git ignores that folder): a name like Aoede-0.92.wav, which says the voice and the speed. Open them and listen for a warm,
// unhurried voice, clear words, natural pauses between paragraphs, the verse read clearly, "Lord" and "God" said as words
// and not letter by letter, and a plain "Amen." at the end.
//
// --one voice@rate makes a single file (a voice name in full, or just its last word, then @ and the rate). It is what the
// step 22 prompt uses to measure the chosen voice.
//
// It prints no secret: not the key, not the account's address, not a token and not Google's own messages. The text it reads
// is made up for this file. It is never a real person's words.

import type { TtsConfig } from "./config.ts";
import { getAccessToken, parseServiceAccount } from "./googleAuth.ts";
import { wavDurationMs } from "./wavDuration.ts";
import { buildSpeechScript } from "./script.ts";
import { synthesize } from "./synthesize.ts";

const VOICES_URL = "https://texttospeech.googleapis.com/v1/voices?languageCode=en-US";
const VOICE_PREFIX = "en-US-Chirp3-HD-";
const OUTPUT_DIR = "tts-audition";
const DEFAULT_VOICES = ["Aoede", "Leda", "Sulafat", "Achernar"];
const DEFAULT_RATES = [0.88, 0.95];

// A made-up devotional in the style of the model's (about 180 words, warm and validating), a short prayer, and Psalm 127:2
// as the Berean Standard Bible has it. The script is built by the same code the function uses, so what is heard is what a
// real reflection sounds like.
const DEVOTIONAL = [
  "It sounds like this week has asked more of you than you had to give. The deadlines, the late nights, the quiet worry " +
  "that you are letting people down: none of that is small, and you do not have to pretend it is.",
  "Notice that you are tired because you care. That care is not a flaw to be fixed. But somewhere along the way, caring " +
  "started to feel like carrying everything by yourself, and no one was meant to carry a whole week alone.",
  "Tonight, you are allowed to put some of it down. The work will still be there in the morning, and so will God's " +
  "faithfulness. Rest is not laziness. Rest is trust, practiced in small and ordinary ways.",
  "Whatever tomorrow asks, you do not have to answer it tonight. Take one honest breath, then one small step, and let " +
  "that be enough for now. God is not rushing you, and He is not disappointed in you.",
  "So breathe slowly. Let your shoulders drop. You are held, even in the middle of an unfinished list.",
].join("\n\n");
const PRAYER =
  "Lord, you know how tired I am and how much I have been carrying. Teach me to rest in you. Quiet my racing " +
  "thoughts, steady my heart, and remind me that I am loved before I have done a single thing. Help me to sleep, and to " +
  "wake with peace.";
const PASSAGE = {
  reference: "Psalm 127:2",
  text: "In vain you rise early\nand stay up late,\ntoiling for bread to eat—\nfor He gives sleep to His beloved.",
};

const args = Deno.args;
const valueOf = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  Deno.exit(2);
}

const credentials = Deno.env.get("GOOGLE_TTS_CREDENTIALS_B64")?.trim() ?? "";
const account = credentials === "" ? null : parseServiceAccount(credentials);
if (account === null) {
  fail(
    "GOOGLE_TTS_CREDENTIALS_B64 must hold the service account's key file as one line of base64, in " +
      "supabase/functions/.env.local (prompts/22-tts-and-storage.md, step D).",
  );
}

const fullName = (voice: string) => (voice.startsWith(VOICE_PREFIX) ? voice : `${VOICE_PREFIX}${voice}`);
const shortName = (voice: string) => (voice.startsWith(VOICE_PREFIX) ? voice.slice(VOICE_PREFIX.length) : voice);

const parseRate = (text: string): number => {
  const rate = Number(text);
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 2) fail(`"${text}" is not a speaking rate from 0.25 to 2.0.`);
  return rate;
};

// What to make: one file, or every voice at every rate.
let jobs: { voice: string; rate: number }[];
const one = valueOf("--one");
if (one !== undefined) {
  const [voice, rate] = one.split("@");
  if (!voice || rate === undefined) fail("--one takes a voice and a rate, like en-US-Chirp3-HD-Aoede@0.92");
  jobs = [{ voice: fullName(voice), rate: parseRate(rate) }];
} else {
  const voices = (valueOf("--voices")?.split(",") ?? DEFAULT_VOICES).map((voice) => voice.trim()).filter(Boolean);
  const rates = (valueOf("--rates")?.split(",") ?? DEFAULT_RATES.map(String)).map((rate) => parseRate(rate.trim()));
  jobs = voices.flatMap((voice) => rates.map((rate) => ({ voice: fullName(voice), rate })));
}

// Google's list of the voices, and whether each one asked for is there.
type Listed = { name?: unknown; ssmlGender?: unknown };
async function chirpVoices(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  try {
    const token = await getAccessToken(account!);
    const response = await fetch(VOICES_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      console.log(`The voice list could not be read (HTTP ${response.status}); trying the voices anyway.`);
      return found;
    }
    const body = await response.json() as { voices?: Listed[] };
    for (const voice of body.voices ?? []) {
      if (typeof voice.name === "string" && voice.name.includes("Chirp3-HD")) {
        found.set(voice.name, typeof voice.ssmlGender === "string" ? voice.ssmlGender : "unknown");
      }
    }
  } catch {
    console.log("The voice list could not be read (the sign-in or the network failed); trying the voices anyway.");
  }
  return found;
}

const listed = await chirpVoices();
if (listed.size > 0) {
  const female = [...listed.values()].filter((gender) => gender === "FEMALE").length;
  console.log(`Chirp 3 HD voices for en-US: ${listed.size} (${female} female, ${listed.size - female} other).`);
}
const asked = [...new Set(jobs.map((job) => job.voice))];
const missing = new Set<string>();
for (const voice of asked) {
  if (listed.size === 0) continue;
  const gender = listed.get(voice);
  if (gender === undefined) {
    missing.add(voice);
    console.log(`  ${shortName(voice)}: not in the list, skipped`);
  } else {
    console.log(`  ${shortName(voice)}: found, ${gender.toLowerCase()}`);
  }
}

const script = buildSpeechScript({ devotional: DEVOTIONAL, scripture: PASSAGE, closingPrayer: PRAYER });
if (script === null) fail("The sample devotional could not be turned into a script (a bug in this file).");
console.log(
  `\nThe script is ${script.chars} characters (${script.bytes} bytes), with the passage and the prayer. ` +
    `One file per voice and speed, in ${OUTPUT_DIR}/:\n`,
);
Deno.mkdirSync(OUTPUT_DIR, { recursive: true });

let made = 0;
for (const { voice, rate } of jobs) {
  const label = `${shortName(voice)} ${rate}`;
  if (missing.has(voice)) continue;
  const config: TtsConfig = {
    account: account!,
    voiceName: voice,
    languageCode: voice.split("-").slice(0, 2).join("-"),
    speakingRate: rate,
  };
  const started = performance.now();
  const result = await synthesize(script.markup, config, Date.now() + 60_000);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (!result.ok) {
    console.log(`${label}: FAILED (${result.reason}) after ${seconds} s, ${result.attempts} attempt(s)`);
    continue;
  }
  const file = `${OUTPUT_DIR}/${shortName(voice)}-${rate}.wav`;
  Deno.writeFileSync(file, result.audio);
  const length = wavDurationMs(result.audio);
  const heard = length === null ? "length unknown" : `${(length / 1000).toFixed(1)} s long`;
  console.log(
    `${label}: ${script.chars} characters, ${result.audio.length} bytes, ${heard}, the call took ${seconds} s, ` +
      `${result.attempts} attempt(s) -> ${file}`,
  );
  made += 1;
}

console.log(
  made === 0
    ? "\nNo file was made. The reason above is Google's short status word: prompts/22-tts-and-storage.md has a table of them."
    : `\n${made} file(s) made. Open them in Windows (double-click), listen, and say which voice and speed you like.`,
);
Deno.exit(made === 0 ? 1 : 0);
