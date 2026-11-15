// Every line Scholar can say in a live talk that no model wrote (step 39). Each is said by our server, never by ElevenLabs' own
// filler, because only our server knows whether the person is in a hard moment. All of them are drafts for the readers (the voice
// pack), and none makes a claim Scholar may not make: it is never a person, a pastor or a counselor, nothing is confidential,
// and no outcome is promised (lines_test.ts).
export const VOICE_LINES = {
  // The first thing a person hears: it says it is AI.
  opening: "Hi, I’m Scholar, GraceHush’s AI Bible companion. What’s on your heart today?",
  // No answer is ready after voiceTiming.holdMs. The three holding lines go out with a pad after them, so that ElevenLabs
  // speaks them when they are sent and not together with the answer (sse.ts, HOLD_PAD).
  hold: "Give me a moment to think about that.",
  // The same moment in a heavy conversation, and the second one after voiceTiming.secondHoldMs.
  holdHeavy: "I’m here. Give me a moment.",
  secondHoldHeavy: "I’m still here with you.",
  // An everyday answer that could not be written in time. The message is released, as a failed typed message is.
  notReady: "I’m sorry, I couldn’t answer that just now. Could you say it again?",
  // A turn with no word in it (noise, a cough).
  unheard: "Sorry, I didn’t catch that. Could you say it again?",
  // A whole turn that is only a stop word (stop.ts). Nothing is saved. Scholar never goes on by itself (the person may have
  // stepped away), so the line says how to bring it back; a turn after it is answered with a recap (prompt.ts, SPOKEN_RESUME).
  stop: "Okay, I’ll wait. Say “go on” when you’re ready.",
  stopHeavy: "Okay. I’m here.",
  // The talk's own cap, or its 80 turns. Never said in a heavy conversation.
  cap:
    "That’s our time for this talk. Everything we said is saved in your conversation, and you can keep writing to me there.",
  // Voice was switched off while a talk was running. Never said in a heavy conversation.
  off: "I need to stop talking for now. Your conversation is saved, and you can keep writing to me there.",
  // The signed session is not valid any more.
  ended: "This talk has ended. Please start a new one.",
  // ElevenLabs' own 30-minute limit: the agent says this itself (agent_setup.ts, max_conversation_duration_message).
  backstop:
    "We’ve talked for a long while, so this talk will end here. Your conversation is saved, and you can start a new talk or keep writing to me.",
} as const;

export type VoiceLine = keyof typeof VOICE_LINES;

// The holding line for this moment of a turn: the first one, and in a heavy conversation the second.
export function holdLine(heavy: boolean, second: boolean): string | null {
  if (second) return heavy ? VOICE_LINES.secondHoldHeavy : null;
  return heavy ? VOICE_LINES.holdHeavy : VOICE_LINES.hold;
}

// The help numbers as a voice says them: digit by digit, in the words the spoken help line uses (heavyChat.ts). An answer a
// model wrote, and the written answers, can hold "911" or "988", which a voice may read as one number. Only these numbers are
// changed: "Psalm 119" and a year stay as they are.
// A help number stands alone: not inside a longer number ("1911", "5,988"), a reference ("9:11") or a range.
const alone = (digits: string) => new RegExp(String.raw`(?<![\d-]|\d[,.:])${digits}(?![\d-]|[,.:]\d)`, "g");
const SPOKEN_NUMBERS: readonly (readonly [RegExp, string])[] = [
  [alone(String.raw`1[-. ]?800[-. ]?799[-. ]?7233`), "one eight hundred, seven nine nine, seven two three three"],
  [alone("88788"), "eight eight seven eight eight"],
  [alone("9-?1-?1"), "nine one one"],
  [alone("9-?8-?8"), "nine eight eight"],
];

export function sayNumbers(text: string): string {
  return SPOKEN_NUMBERS.reduce((spoken, [number, said]) => spoken.replace(number, said), text);
}

// The answer to a whole turn that is only a stop word.
export function stopLine(heavy: boolean): string {
  return heavy ? VOICE_LINES.stopHeavy : VOICE_LINES.stop;
}
