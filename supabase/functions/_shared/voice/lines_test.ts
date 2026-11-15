import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { spokenHelpLine } from "../scholar/heavyChat.ts";
import { holdLine, sayNumbers, stopLine, VOICE_LINES } from "./lines.ts";

// The fixed lines of a live talk (step 39): what each says, and what none of them may say.

Deno.test("lines: the twelve lines a talk can say with no model, word for word", () => {
  assertEquals(VOICE_LINES, {
    opening: "Hi, I’m Scholar, GraceHush’s AI Bible companion. What’s on your heart today?",
    hold: "Give me a moment to think about that.",
    holdHeavy: "I’m here. Give me a moment.",
    secondHoldHeavy: "I’m still here with you.",
    notReady: "I’m sorry, I couldn’t answer that just now. Could you say it again?",
    unheard: "Sorry, I didn’t catch that. Could you say it again?",
    stop: "Okay, I’ll wait. Say “go on” when you’re ready.",
    stopHeavy: "Okay. I’m here.",
    cap:
      "That’s our time for this talk. Everything we said is saved in your conversation, and you can keep writing to me there.",
    off: "I need to stop talking for now. Your conversation is saved, and you can keep writing to me there.",
    ended: "This talk has ended. Please start a new one.",
    backstop:
      "We’ve talked for a long while, so this talk will end here. Your conversation is saved, and you can start a new talk or keep writing to me.",
  });
});

Deno.test("lines: none claims to be a person, a pastor or a counselor, calls anything confidential, or promises an outcome", () => {
  const forbidden = [
    /\bpastor\b/i,
    /\bcounsel+ors?\b/i,
    /\btherapist\b/i,
    /\bdoctor\b/i,
    /\bhuman\b/i,
    /\bperson\b/i,
    /\bconfidential/i,
    /\bprivate/i,
    /\bsecret/i,
    /\bpromise/i,
    /\bguarantee/i,
    /\bwill be (?:okay|ok|fine|all right|alright|healed|better)\b/i,
    /\beverything (?:will|is going to)\b/i,
    /\bsomeone (?:was|has been|will be) (?:told|notified|called)\b/i,
    /\bhelp is (?:coming|on (?:its|the) way)\b/i,
  ];
  for (const [name, line] of Object.entries(VOICE_LINES)) {
    for (const pattern of forbidden) {
      assert(!pattern.test(line), `${name} says something a fixed line may not: ${pattern}`);
    }
  }
});

Deno.test("lines: typographic punctuation, whole sentences, and the app's name spelled GraceHush", () => {
  for (const [name, line] of Object.entries(VOICE_LINES)) {
    assert(!/['"]/.test(line), `${name} has a straight quote or apostrophe`);
    assert(!line.includes("..."), `${name} has three dots`);
    assert(!/\s{2,}|^\s|\s$/.test(line), `${name} has stray spaces`);
    assert(/^[A-Z]/.test(line) && /[.?]$/.test(line), `${name} is not a whole sentence`);
    assert(!/gracehush/i.test(line) || line.includes("GraceHush"), `${name} misspells the app's name`);
    // A line is spoken: nothing a voice cannot say (a link, an address, a digit, a bracket).
    assert(!/[<>\[\]{}@/\\#*_]|\d|https?:/.test(line), `${name} holds something that cannot be spoken`);
  }
});

Deno.test("lines: the opening says it is AI, and the lines that end a talk say the conversation is saved", () => {
  assert(/\bAI\b/.test(VOICE_LINES.opening), "the opening names AI");
  for (const name of ["cap", "off", "backstop"] as const) {
    assert(/saved/.test(VOICE_LINES[name]), `${name} says the conversation is saved`);
    assert(/keep writing to me/.test(VOICE_LINES[name]), `${name} says the person can keep writing`);
  }
});

Deno.test("lines: the holding lines by conversation and moment, and the stop lines", () => {
  assertEquals(holdLine(false, false), VOICE_LINES.hold);
  assertEquals(holdLine(true, false), VOICE_LINES.holdHeavy);
  assertEquals(holdLine(true, true), VOICE_LINES.secondHoldHeavy);
  // An everyday turn has no second holding line: it has ended by then.
  assertEquals(holdLine(false, true), null);
  assertEquals(stopLine(false), "Okay, I’ll wait. Say “go on” when you’re ready.");
  assertEquals(stopLine(true), "Okay. I’m here.");
  // A heavy conversation never hears the everyday holding line's "think about that".
  assert(!/think about/.test(VOICE_LINES.holdHeavy) && !/think about/.test(VOICE_LINES.secondHoldHeavy));
});

Deno.test("numbers: the app's help numbers are said digit by digit, in the spoken help line's own words", async () => {
  const root = new URL("../../../../", import.meta.url);
  const resources = await Deno.readTextFile(new URL("src/constants/crisisResources.ts", root));
  const constant = (name: string) => {
    const found = resources.match(new RegExp(`export const ${name} = "([^"]+)";`))?.[1];
    assert(found !== undefined, `${name} is where the app keeps it`);
    return found;
  };
  const said: [string, string][] = [
    [constant("EMERGENCY_NUMBER"), "nine one one"],
    [constant("HELPLINE_NUMBER"), "nine eight eight"],
    [constant("DV_HOTLINE_NUMBER"), "one eight hundred, seven nine nine, seven two three three"],
    [constant("DV_HOTLINE_DIAL"), "one eight hundred, seven nine nine, seven two three three"],
    [constant("DV_TEXT_NUMBER"), "eight eight seven eight eight"],
  ];
  // The words are the spoken help lines' own, so an answer and the line after it never say a number two ways.
  const lines = (["crisis", "abuse", "harm_others", "emergency"] as const).map((help) => spokenHelpLine(help, "us"))
    .join(" ");
  for (const [number, words] of said) {
    assertEquals(sayNumbers(`Please call ${number} right now.`), `Please call ${words} right now.`);
    assertEquals(sayNumbers(`Call ${number}.`), `Call ${words}.`);
    assert(lines.includes(words), `the spoken help lines say "${words}"`);
    // Nothing a voice would read as one large number is left.
    assert(!/\d/.test(sayNumbers(`Call ${number}, or text ${number}.`)));
  }
  assertEquals(
    sayNumbers("Please call 911 right now. If you can’t call, text 988 and tell them what has happened."),
    "Please call nine one one right now. If you can’t call, text nine eight eight and tell them what has happened.",
  );
  assertEquals(sayNumbers("Call 9-1-1, or 9-8-8."), "Call nine one one, or nine eight eight.");
});

Deno.test("numbers: a chapter, a verse, a year and any other number stay as they are", () => {
  const untouched = [
    "Psalm 119 is the longest psalm.",
    "Turn to Isaiah 41:10 and Psalm 91:1.",
    "That hymn was written in 1911.",
    "Luke 9:11 says he welcomed them.",
    "Room 2988 and bus 9110.",
    "John 9:8-11 tells it.",
    "There were 5,988 of them.",
    "Give me a moment to think about that.",
  ];
  for (const text of untouched) assertEquals(sayNumbers(text), text);
  // The spoken help lines hold no digit, so they pass through unchanged.
  for (const region of ["us", "other"] as const) {
    for (const help of ["crisis", "abuse", "harm_others", "emergency"] as const) {
      const line = spokenHelpLine(help, region);
      assertEquals(sayNumbers(line), line);
    }
  }
});
