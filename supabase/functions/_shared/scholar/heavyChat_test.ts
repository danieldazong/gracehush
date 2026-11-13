import { isDeniedPassage } from "../../process-entry/heavy.ts";
import {
  HEAVY_RULE_IF_HURT,
  HEAVY_RULE_NO_PROMISE,
  HEAVY_RULE_NOT_DEATH,
  HEAVY_RULE_NOT_SIN,
  HEAVY_RULE_PASSAGE,
  HEAVY_RULE_WISH,
} from "../../process-entry/heavy.ts";
import { countWords } from "../../process-entry/output.ts";
import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { firstHeavyNeverSay, firstNeverSay, hasQuotation, hasVerseReference } from "../../process-entry/tone.ts";
import { formatReference } from "../bible/reference.ts";
import { ANSWER_WORDS } from "./constants.ts";
import {
  allowedPassageKeys,
  buildHeavyBlock,
  defaultPassageKey,
  type FallbackVariant,
  fallbackVariant,
  HARD_MOMENT_PASSAGES,
  HARD_PASSAGE_KEYS,
  type HardPassageKey,
  HEAVY_CHAT_RULES,
  HEAVY_CHAT_SECTION,
  heavyChatFallback,
  type HeavyFacts,
  localTime,
  plainNamingPhrases,
  SPOKEN_HELP_LINE,
  spokenHelpLine,
  usedPassageKeys,
} from "./heavyChat.ts";
import { hurtProblem } from "./output.ts";

Deno.test("scholar-v2: the heavy section keeps every prohibition and adds the readers' twelve instructions", () => {
  const lines = HEAVY_CHAT_SECTION.split("\n");
  assertEquals(lines[0], "## A heavy moment");
  assert(lines[1].includes("set is_heavy to true") && lines[1].includes("<heavy_moment>"));
  assert(lines[1].includes("These rules come first"));
  // The shared rules of the reflection's section, word for word.
  for (
    const rule of [HEAVY_RULE_WISH, HEAVY_RULE_NOT_DEATH, HEAVY_RULE_NOT_SIN, HEAVY_RULE_IF_HURT, HEAVY_RULE_PASSAGE]
  ) {
    assertEquals(lines.filter((line) => line === rule).length, 1, rule.slice(0, 40));
  }
  // The reflection's approved phrases are not handed to a conversation (the readers found them in nearly every answer).
  assert(!lines.includes(HEAVY_RULE_NO_PROMISE));
  assert(!HEAVY_CHAT_SECTION.includes("You may say that this moment is not the end of their story"));
  // Every prohibition is kept.
  for (
    const kept of [
      "no method, no means, no place, no plan",
      "not sleeping and not waking, wanting it all to stop, disappearing, being gone, the only relief, a way out",
      "Never name an act, a detail or a method.",
      "Never promise that the pain will end soon, that everything will be fine, or when it will ease.",
      "Quote nothing from their messages",
      "Never ask how, when or where, and never work through a list of questions.",
      "Never claim to be a person, a pastor or a counselor.",
      "Never say that anyone has been told, that help is on its way, or that this conversation is confidential.",
      "Never end the conversation, refuse to go on, or say you cannot talk about this. Stay.",
    ]
  ) {
    assertEquals(HEAVY_CHAT_SECTION.split(kept).length - 1, 1, kept);
  }
  // The readers' twelve, one line each, and the line for a person under 18.
  for (
    const added of [
      "Your first sentence responds to the most specific thing they said",
      "at most once in a conversation",
      "Write 50 to 110 words in two or three short paragraphs.",
      "One step, sized to the moment.",
      "Ask at most one question: who they could reach, or whether they will reach out now.",
      "After the first heavy answer, do not repeat it.",
      "If they ask for a prayer, pray. Never answer a request for prayer with advice alone.",
      "say so kindly, then say what you can tell them",
      "do not tell them to leave, to stay, or to act at a particular time",
      "Never use the same passage twice in a conversation.",
      'never continue with "but"',
      "If they say they have already acted, or that danger is at the door",
      "set says_under_18 to true",
      // 2026-11-11, after the evaluation: the help line under the answer begins with this sentence.
      "Never write that sentence, or one close to it.",
    ]
  ) {
    assertEquals(HEAVY_CHAT_RULES.filter((line) => line.includes(added)).length, 1, added);
  }
  assert(HEAVY_CHAT_SECTION.includes("The line under your answer begins “You don’t have to carry this alone.”"));
  // The passages, each by its key and its reference.
  for (const passage of HARD_MOMENT_PASSAGES) {
    assert(HEAVY_CHAT_SECTION.includes(`- ${passage.key} (${formatReference(passage.ref)}): `), passage.key);
  }
});

Deno.test("the passage list: thirteen the pastor read, none denied or long; for someone hurt, never one that says do not fear", () => {
  assertEquals(HARD_MOMENT_PASSAGES.length, 13);
  assertEquals(new Set(HARD_PASSAGE_KEYS).size, 13);
  for (const passage of HARD_MOMENT_PASSAGES) {
    assertEquals(isDeniedPassage(passage.ref), false, passage.key);
    assert(passage.ref.verseEnd - passage.ref.verseStart + 1 <= 6, passage.key);
  }
  assertEquals(formatReference(HARD_MOMENT_PASSAGES[0].ref), "Isaiah 41:10");
  const hurt = allowedPassageKeys("abuse", []);
  assert(!hurt.includes("ISA_41_10") && !hurt.includes("DEU_31_8") && hurt.includes("PSA_9_9_10"));
  assertEquals(allowedPassageKeys("crisis", []).length, 13);
  assert(!allowedPassageKeys("crisis", ["PSA_56_8"]).includes("PSA_56_8"));
  assertEquals(usedPassageKeys(["Isaiah 41:10", "Psalm 9:9–10", "John 3:16"]), ["ISA_41_10", "PSA_9_9_10"]);
  assertEquals(defaultPassageKey("abuse", []), "PSA_9_9_10");
  assertEquals(defaultPassageKey("crisis", []), "ISA_41_10");
  assertEquals(defaultPassageKey("crisis", ["ISA_41_10"]), "PSA_46_1");
  assertEquals(defaultPassageKey("crisis", ["ISA_41_10", "PSA_46_1", "DEU_31_8"]), null);
});

// The readers' words of 2026-11-11, as they wrote them (straight apostrophes): the app's texts are these with curly ones.
const READERS: Record<FallbackVariant, string> = {
  general:
    "Thank you for telling me. What you are carrying is real, and you don't have to explain it well or make sense of it yet.\n\nGod is with you in this moment, and he is not letting go of you. Your life matters to him, and it matters to people who would want to know how much you are hurting.\n\nPlease don't carry this alone today. Tell one person you trust what you told me, or call or text the line under this message. If you are in danger, get help right away. I'm still here, and you can keep talking with me.",
  abuse:
    "Thank you for telling me. What is happening to you is not your fault, and you deserve to be safe.\n\nGod sees you right now, and he is not far from you. He is on the side of the one being hurt.\n\nYou don't have to work this out by yourself. The people at the line under this message help with exactly this, day or night, by call or text. If you are in danger right now, call 911. I'm still here, and you can keep talking with me.",
  repeat:
    "I'm still here. I may not have the right words for all of this, and I don't want you to be alone with it.\n\nGod has not moved away from you since you last wrote. He is as near now as he was then.\n\nIf you haven't yet, please tell one person today, or call or text the line under this message. You can keep talking with me too.",
  emergency:
    "Please call 911 right now. If you can't call, text 988 and tell them what has happened. If anyone is near you, go to them now.\n\nGod is with you this minute, and he wants you to live. I'm staying here.",
};

const VARIANTS: FallbackVariant[] = ["general", "abuse", "repeat", "emergency"];

Deno.test("the written answers are the readers' words, pass every heavy check, and fit the situation and the region", () => {
  for (const variant of VARIANTS) {
    const us = heavyChatFallback(variant, { help: "crisis", region: "us", usedPassages: [] }).reply;
    assertEquals(us.replace(/’/g, "'"), READERS[variant], variant);
    for (const region of ["us", "other"] as const) {
      const text = heavyChatFallback(variant, { help: "crisis", region, usedPassages: [] }).reply;
      const label = `${variant}/${region}`;
      assertEquals(firstHeavyNeverSay(text), null, label);
      assertEquals(firstNeverSay(text), null, label);
      assertEquals(hasQuotation(text), false, label);
      assertEquals(hasVerseReference(text), false, label);
      assertEquals(hurtProblem([text]), null, label);
      assert(!text.includes("'"), `${label}: curly apostrophes only`);
      const words = countWords(text);
      assert(words >= ANSWER_WORDS.min && words <= ANSWER_WORDS.askMax, `${label}: ${words} words`);
      for (
        const claim of [/\bI am a\b/i, /\bI’m a\b/i, /confidential/i, /\bbeen told\b/i, /will contact/i, /on its way/i]
      ) {
        assert(!claim.test(text), `${label}: ${claim}`);
      }
      // It stays: the person may keep talking (the emergency one says so in its own words).
      assert(/keep talking with me|I’m staying here/.test(text), label);
      // Outside the US no US number is named, and the link under the message is a directory, not a line to call or text.
      if (region === "other") assert(!/\b(?:911|988)\b/.test(text) && !text.includes("call or text"), label);
    }
  }
  assert(
    heavyChatFallback("emergency", { help: "emergency", region: "us", usedPassages: [] }).reply
      .startsWith("Please call 911 right now."),
  );
  assert(
    heavyChatFallback("emergency", { help: "emergency", region: "other", usedPassages: [] }).reply
      .startsWith("Please call your local emergency number right now."),
  );
});

Deno.test("which written answer, and its card: emergency first, the shorter one the second time, the one for someone hurt", () => {
  assertEquals(fallbackVariant("emergency", false), "emergency");
  assertEquals(fallbackVariant("emergency", true), "emergency");
  assertEquals(fallbackVariant("crisis", true), "repeat");
  assertEquals(fallbackVariant("abuse", false), "abuse");
  assertEquals(fallbackVariant("abuse", true), "repeat");
  assertEquals(fallbackVariant("harm_others", false), "general");
  const card = (variant: FallbackVariant, help: "crisis" | "abuse" | "emergency", used: HardPassageKey[] = []) =>
    heavyChatFallback(variant, { help, region: "us", usedPassages: used }).passageKey;
  assertEquals(card("general", "crisis"), "ISA_41_10");
  assertEquals(card("abuse", "abuse"), "PSA_9_9_10");
  assertEquals(card("repeat", "crisis"), "DEU_31_8");
  assertEquals(card("repeat", "abuse"), "PSA_46_1");
  assertEquals(card("general", "crisis", ["ISA_41_10"]), "PSA_46_1");
  assertEquals(card("general", "crisis", ["ISA_41_10", "PSA_46_1", "DEU_31_8"]), null);
  assertEquals(card("emergency", "emergency"), null);
});

const FACTS: HeavyFacts = {
  help: "crisis",
  region: "us",
  firstAnswer: true,
  answersBefore: 0,
  plainNaming: null,
  usedPassages: [],
  time: null,
};

Deno.test("the block: the help line for the situation and region, what to do in danger, the time, a later turn, naming, passages", () => {
  const crisis = buildHeavyBlock(FACTS);
  assert(crisis.startsWith("<heavy_moment>\n") && crisis.endsWith("\n</heavy_moment>"));
  assert(crisis.includes("the 988 Suicide & Crisis Lifeline, by call or text, any time"));
  assert(crisis.includes("If they are in danger right now: 911."));
  assert(crisis.includes("This is the first heavy answer in this conversation."));
  assert(crisis.includes("Plain naming: not allowed."));
  assert(!crisis.includes("Passages you may not use"));
  const hurt = buildHeavyBlock({ ...FACTS, help: "abuse", usedPassages: ["PSA_56_8"] });
  assert(hurt.includes("National Domestic Violence Hotline"));
  assert(hurt.includes("never tell them not to be afraid"));
  assert(hurt.includes("Passages you may not use now: ISA_41_10, DEU_31_8, PSA_56_8."));
  const abroad = buildHeavyBlock({ ...FACTS, region: "other" });
  assert(abroad.includes("a link to a directory of help lines in their country"));
  assert(abroad.includes("their local emergency number (never name a number)"));
  assert(!/\b(?:911|988)\b/.test(abroad));
  assertEquals(
    buildHeavyBlock({ ...FACTS, help: "emergency" }).includes("The help line under your answer: 911."),
    true,
  );
  const later = buildHeavyBlock({ ...FACTS, firstAnswer: false, answersBefore: 3 });
  assert(later.includes("You have answered 3 messages in this conversation already"));
  assert(buildHeavyBlock({ ...FACTS, plainNaming: "life" }).includes("only as thoughts of ending your life."));
  assert(
    buildHeavyBlock({ ...FACTS, plainNaming: "suicide" }).includes(
      "only as thoughts of suicide or as thoughts of ending your life.",
    ),
  );
  const timed = buildHeavyBlock({ ...FACTS, time: { label: "3:12 AM", part: "night" } });
  assert(timed.includes("Their local time: 3:12 AM (night)."));
});

Deno.test("the person's local time, from the profile's zone; a zone Intl does not know is no time at all", () => {
  const at = new Date("2026-11-11T02:30:00Z");
  assertEquals(localTime(at, "Africa/Lagos"), { label: "3:30 AM", part: "night" });
  assertEquals(localTime(at, "America/New_York"), { label: "9:30 PM", part: "night" });
  assertEquals(localTime(new Date("2026-11-11T15:00:00Z"), "UTC"), { label: "3:00 PM", part: "afternoon" });
  assertEquals(localTime(new Date("2026-11-11T08:00:00Z"), "UTC")?.part, "morning");
  assertEquals(localTime(new Date("2026-11-11T18:00:00Z"), "UTC")?.part, "evening");
  assertEquals(localTime(at, "Not/AZone"), null);
});

Deno.test("plain naming: none, ending their life, or both phrases when they used the word", () => {
  assertEquals(plainNamingPhrases(null), []);
  assertEquals(plainNamingPhrases("life"), ["thoughts of ending your life"]);
  assertEquals(plainNamingPhrases("suicide"), ["thoughts of suicide", "thoughts of ending your life"]);
});

Deno.test("the spoken help lines are the app's own lines, with the app's numbers spelled out as a voice reads them", async () => {
  const root = new URL("../../../../", import.meta.url);
  const resources = await Deno.readTextFile(new URL("src/constants/crisisResources.ts", root));
  const constant = (name: string) => resources.match(new RegExp(`export const ${name} = "([^"]+)";`))?.[1];
  const helpline = constant("HELPLINE_NUMBER");
  const emergency = constant("EMERGENCY_NUMBER");
  const hotline = constant("DV_HOTLINE_NUMBER");
  const textBody = constant("DV_TEXT_BODY");
  const textNumber = constant("DV_TEXT_NUMBER");
  assert(helpline && emergency && hotline && textBody && textNumber, "the numbers are where the app keeps them");

  const copy = (await Deno.readTextFile(new URL("src/constants/copy.ts", root))).replace(/\r\n/g, "\n");
  const template = (pattern: RegExp) => {
    const found = copy.match(pattern)?.[1];
    assert(found !== undefined, String(pattern));
    return found;
  };
  const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const spell = (number: string) =>
    number === "1-800-799-7233"
      ? "one eight hundred, seven nine nine, seven two three three"
      : [...number].map((digit) => DIGITS[Number(digit)]).join(" ");

  const crisis = template(/\bcrisis: \(helpline: string, emergency: string\) =>\s*`([^`]+)`/)
    .replace("${helpline}", spell(helpline)).replace("${emergency}", spell(emergency));
  const harm = template(/\bharmOthers: \(helpline: string, emergency: string\) =>\s*`([^`]+)`/)
    .replace("${helpline}", spell(helpline)).replace("${emergency}", spell(emergency));
  const abuse = template(
    /\babuse: \(hotline: string, textBody: string, textNumber: string, emergency: string\) =>\s*`([^`]+)`/,
  )
    .replace("${hotline}", spell(hotline)).replace("${textBody}", textBody)
    .replace("${textNumber}", spell(textNumber)).replace("${emergency}", spell(emergency));
  const now = template(/\bemergency: \(emergency: string\) =>\s*`([^`]+)`/).replace("${emergency}", spell(emergency));
  const elsewhere = template(/\belsewhere:\s*"([^"]+)"/).replace("findahelpline.com", "find a helpline dot com");
  const nowElsewhere = template(/\bemergencyElsewhere:\s*"([^"]+)"/);

  assertEquals(spokenHelpLine("crisis", "us"), crisis);
  assertEquals(SPOKEN_HELP_LINE, crisis);
  assertEquals(spokenHelpLine("harm_others", "us"), harm);
  assertEquals(spokenHelpLine("abuse", "us"), abuse);
  assertEquals(spokenHelpLine("emergency", "us"), now);
  for (const help of ["crisis", "harm_others", "abuse"] as const) {
    assertEquals(spokenHelpLine(help, "other"), elsewhere);
  }
  assertEquals(spokenHelpLine("emergency", "other"), nowElsewhere);
  assertEquals(spell(helpline), "nine eight eight");
});
