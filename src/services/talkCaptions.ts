// The live talk's captions (2026-11-16): Scholar's words in time with its voice, and the person's own sentence once ElevenLabs has
// heard it. Nothing here is drawn, kept or sent anywhere: the Talk screen reads the state, the talk's saved messages stay the
// record, and the captions are forgotten when the talk ends.
//
// What reaches the phone, measured on the iPhone on 2026-11-16 (a talk over WebRTC):
// - Scholar: ElevenLabs sends the timing of every character it is about to say (the "audio" event's alignment) in small pieces,
//   all of an answer's pieces within about 3.5 seconds of each other and about 0.2 to 0.3 s before the voice starts. So the
//   pieces are queued on a clock of our own: the first starts CAPTION_DELAY_MS after it arrives, and each later one when the one
//   before it ends.
// - The person: their whole sentence, once, when ElevenLabs has finished hearing it ("user_transcript"), which on the phone came
//   about a third of a second before Scholar started answering. ElevenLabs lists an event for the words while they are still being
//   said ("tentative_user_transcript"); the agents ask for it, but it never arrived on the phone or on a PC. If it ever does, the
//   same line fills in as the person speaks.
//
// No React, no ElevenLabs import: the Talk screen hands the events in, and the checks drive it on a virtual clock.

// The voice starts this long after its first piece of timing arrives (measured 0.16 to 0.29 s on the phone).
export const CAPTION_DELAY_MS = 200;
// A word shows dim at most this long before it is said, so the phrase being spoken is on screen and never the whole answer.
export const CAPTION_LEAD_MS = 1_500;
// Scholar's last line stays this long after its last word, then fades.
export const CAPTION_LINGER_MS = 2_000;
// The person's sentence stays this long after Scholar's first word of the answer, or this long at most if Scholar says nothing.
export const CAPTION_PERSON_AFTER_MS = 3_000;
export const CAPTION_PERSON_MAX_MS = 8_000;
// How long a caption takes to fade out before it is removed: a fade, and the faster one when the person interrupts Scholar.
export const CAPTION_FADE_MS = 600;
export const CAPTION_CUT_MS = 200;
// Scholar's block keeps at most this many words: older ones have long scrolled out of sight.
export const CAPTION_MAX_WORDS = 200;
const CAPTION_DROP_WORDS = 60;

export type CaptionWord = { key: number; text: string; lit: boolean };
export type ScholarCaption = { key: number; words: readonly CaptionWord[]; leaving: "fade" | "cut" | null };
export type PersonCaption = { key: number; text: string; final: boolean; leaving: boolean };
export type CaptionState = { person: PersonCaption | null; scholar: ScholarCaption | null };
export type Alignment = { chars: readonly string[]; char_start_times_ms: readonly number[]; char_durations_ms: readonly number[] };

const EMPTY: CaptionState = { person: null, scholar: null };

// Characters a reader cannot see, which our server's holding lines are padded with (HOLD_PAD): each is a space here.
const INVISIBLE = /[​-‍⁠﻿]/g;

export function cleanCaptionText(text: string): string {
  return text.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

// The pieces of timing ElevenLabs sends are checked before they are used: equal lengths, finite times, never negative.
export function readAlignment(value: unknown): Alignment | null {
  if (typeof value !== "object" || value === null) return null;
  const { chars, char_start_times_ms: starts, char_durations_ms: durations } = value as Record<string, unknown>;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(durations)) return null;
  if (chars.length === 0 || chars.length !== starts.length || chars.length !== durations.length) return null;
  const finite = (list: unknown[]) => list.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  if (!chars.every((c) => typeof c === "string") || !finite(starts) || !finite(durations)) return null;
  return { chars, char_start_times_ms: starts, char_durations_ms: durations } as Alignment;
}

type Pending = { at: number; scholarKey: number | null; run: () => void };
// A word of Scholar's still being built from the pieces: a word can run from one piece into the next ("Sch" and "olar").
type OpenWord = { key: number; blockKey: number } | null;

let state: CaptionState = EMPTY;
const listeners = new Set<() => void>();
let nextKey = 1;
let pending: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Infinity;
// When the speech queued so far ends, on the phone's clock (0: nothing queued).
let cursor = 0;
let openWord: OpenWord = null;
// When Scholar's first word of the block lights, for the person's sentence to know when to go.
let firstLitAt: number | null = null;
// The text of a word scheduled but not yet shown, which a later piece can still grow.
const waitingText = new Map<number, string>();

export function getCaptions(): CaptionState {
  return state;
}

export function subscribeCaptions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: CaptionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function schedule(at: number, scholarKey: number | null, run: () => void) {
  pending.push({ at, scholarKey, run });
  arm();
}

function arm() {
  const next = pending.reduce((min, item) => Math.min(min, item.at), Infinity);
  if (next === timerAt) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  timerAt = next;
  if (next === Infinity) return;
  timer = setTimeout(pump, Math.max(0, next - Date.now()));
}

function pump() {
  timer = null;
  timerAt = Infinity;
  const now = Date.now();
  // In the order they are due; one that schedules another is seen on the next round.
  const due = pending.filter((item) => item.at <= now).sort((a, b) => a.at - b.at);
  pending = pending.filter((item) => item.at > now);
  due.forEach((item) => item.run());
  arm();
}

function dropScholarPending(key: number) {
  pending = pending.filter((item) => item.scholarKey !== key);
  arm();
}

// Everything goes: a talk starts or ends.
export function resetCaptions() {
  pending = [];
  arm();
  cursor = 0;
  openWord = null;
  firstLitAt = null;
  waitingText.clear();
  if (state !== EMPTY) set(EMPTY);
}

function personLeaves(key: number) {
  const person = state.person;
  if (person === null || person.key !== key || person.leaving) return;
  set({ ...state, person: { ...person, leaving: true } });
  schedule(Date.now() + CAPTION_FADE_MS, null, () => {
    if (state.person?.key === key) set({ ...state, person: null });
  });
}

function scholarLeaves(how: "fade" | "cut") {
  const scholar = state.scholar;
  if (scholar === null || scholar.leaving !== null) return;
  dropScholarPending(scholar.key);
  cursor = 0;
  openWord = null;
  firstLitAt = null;
  set({ ...state, scholar: { ...scholar, leaving: how } });
  schedule(Date.now() + (how === "cut" ? CAPTION_CUT_MS : CAPTION_FADE_MS), null, () => {
    if (state.scholar?.key === scholar.key) set({ ...state, scholar: null });
  });
}

// The person's words: while they speak (if ElevenLabs ever sends them) and once it has heard the whole sentence.
export function captionsPersonWords(text: string, final: boolean) {
  const words = cleanCaptionText(text);
  if (words === "") return;
  const now = Date.now();
  const current = state.person;
  if (current !== null && !current.final && !current.leaving) {
    // The same turn, heard further or finished.
    set({ ...state, person: { ...current, text: words, final } });
    if (final) schedule(now + CAPTION_PERSON_MAX_MS, null, () => personLeaves(current.key));
    return;
  }
  // A new turn. Scholar's words that have all been said have had their time; an answer already on its way (its timing can come
  // a moment before the person's sentence) stays.
  const answering = state.scholar !== null && state.scholar.leaving === null && cursor > now;
  if (state.scholar !== null && !answering) scholarLeaves("fade");
  const key = nextKey++;
  set({ ...state, person: { key, text: words, final, leaving: false } });
  if (final) schedule(now + CAPTION_PERSON_MAX_MS, null, () => personLeaves(key));
  // The answer has started speaking already: the sentence stays its usual time from now.
  if (answering && firstLitAt !== null) schedule(now + CAPTION_PERSON_AFTER_MS, null, () => personLeaves(key));
}

// The person spoke over Scholar: its words go at once.
export function captionsInterrupt() {
  scholarLeaves("cut");
}

function updateWord(blockKey: number, wordKey: number, change: (word: CaptionWord) => CaptionWord) {
  const scholar = state.scholar;
  if (scholar === null || scholar.key !== blockKey) return;
  const index = scholar.words.findIndex((word) => word.key === wordKey);
  if (index < 0) return;
  const words = scholar.words.slice();
  words[index] = change(words[index]);
  set({ ...state, scholar: { ...scholar, words } });
}

function showWord(blockKey: number, word: CaptionWord) {
  const scholar = state.scholar;
  if (scholar === null || scholar.key !== blockKey || scholar.words.some((shown) => shown.key === word.key)) return;
  let words = [...scholar.words, word];
  if (words.length > CAPTION_MAX_WORDS) words = words.slice(CAPTION_DROP_WORDS);
  set({ ...state, scholar: { ...scholar, words } });
}

function lightWord(blockKey: number, wordKey: number) {
  // A word of a block that has gone (cut, faded or reset) says nothing about the answer on screen now.
  if (state.scholar?.key !== blockKey) return;
  updateWord(blockKey, wordKey, (word) => ({ ...word, lit: true }));
  if (firstLitAt === null) {
    firstLitAt = Date.now();
    const person = state.person;
    if (person !== null && !person.leaving) {
      schedule(firstLitAt + CAPTION_PERSON_AFTER_MS, null, () => personLeaves(person.key));
    }
  }
}

// One piece of the timing of what Scholar is about to say.
export function captionsScholarAlignment(value: unknown) {
  const alignment = readAlignment(value);
  if (alignment === null) return;
  const now = Date.now();
  let scholar = state.scholar;
  if (scholar === null || scholar.leaving !== null) {
    scholar = { key: nextKey++, words: [], leaving: null };
    cursor = 0;
    openWord = null;
    firstLitAt = null;
    set({ ...state, scholar });
  }
  const blockKey = scholar.key;
  const start = cursor > now ? cursor : now + CAPTION_DELAY_MS;
  const { chars, char_start_times_ms: starts, char_durations_ms: durations } = alignment;
  // The words of this piece, each with the moment its first character is said; text joins a word left open by the last piece.
  const grown = new Map<number, string>();
  const fresh: { key: number; text: string; litAt: number }[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index].replace(INVISIBLE, " ");
    if (/^\s*$/.test(char)) {
      openWord = null;
      continue;
    }
    if (openWord !== null && openWord.blockKey === blockKey) {
      const key = openWord.key;
      const inPiece = fresh.find((word) => word.key === key);
      if (inPiece !== undefined) inPiece.text += char;
      else grown.set(key, (grown.get(key) ?? "") + char);
      continue;
    }
    const key = nextKey++;
    openWord = { key, blockKey };
    fresh.push({ key, text: char, litAt: start + starts[index] });
  }
  const last = chars.length - 1;
  cursor = start + starts[last] + durations[last];
  // A word left open by the last piece grows in place, whether it is on screen yet or still waiting.
  grown.forEach((more, key) => {
    updateWord(blockKey, key, (word) => ({ ...word, text: word.text + more }));
    const waiting = waitingText.get(key);
    if (waiting !== undefined) waitingText.set(key, waiting + more);
  });
  for (const word of fresh) {
    waitingText.set(word.key, word.text);
    const appearAt = Math.max(start, word.litAt - CAPTION_LEAD_MS);
    schedule(appearAt, blockKey, () => {
      const text = waitingText.get(word.key) ?? word.text;
      waitingText.delete(word.key);
      showWord(blockKey, { key: word.key, text, lit: Date.now() >= word.litAt });
    });
    schedule(word.litAt, blockKey, () => lightWord(blockKey, word.key));
  }
  // The block goes a little after its last word. A later piece moves the end on, and this one then finds it is not yet time.
  schedule(cursor + CAPTION_LINGER_MS, blockKey, () => {
    if (state.scholar?.key === blockKey && cursor + CAPTION_LINGER_MS <= Date.now()) scholarLeaves("fade");
  });
}
