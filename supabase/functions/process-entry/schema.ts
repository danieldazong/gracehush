import { EMOTIONS, PRAYER_CATEGORIES, REFLECTION_BOOK_IDS, TIME_SLOTS } from "./constants.ts";

// The response schema for the Gemini call (response_format.schema). It uses only what Google's structured output
// page lists as supported: types, a "null" in a type array for a nullable property, enum, required, items and
// maxItems. minLength and maxLength are ignored by the server, so every limit is checked again in output.ts.
// A nullable enum is not on that list, so prayer.category uses the string "NONE" instead of null.

type JsonSchema = Record<string, unknown>;

const text = (description: string): JsonSchema => ({ type: "string", description });

// Where a passage is: the book as a USFM id from the one list in _shared/bible/books.ts (so the enum and the code that
// checks it cannot disagree), less the Song of Solomon (REFLECTION_BOOK_IDS, step 32), the chapter and the verses. Used
// inside the reflection and alone for a replacement.
const passageProperties = (): Record<string, JsonSchema> => ({
  book_id: {
    type: "string",
    enum: [...REFLECTION_BOOK_IDS],
    description: "The USFM id of the book, such as PHP for Philippians, PSA for Psalms or 1CO for 1 Corinthians.",
  },
  chapter: { type: "integer" },
  verse_start: { type: "integer" },
  verse_end: { type: "integer", description: "Equal to verse_start for a single verse." },
});

const PASSAGE_REQUIRED = ["book_id", "chapter", "verse_start", "verse_end"];

// The small schema for asking for a different passage (the reply to a passage that does not exist).
export function buildScriptureSchema(): JsonSchema {
  return { type: "object", properties: passageProperties(), required: PASSAGE_REQUIRED };
}

// gen-v2.5 (step 37): where an affirmation's verse is. One verse, so verse_end equals verse_start; the Bible code decides
// whether it exists, is short enough and is a whole sentence (verses.ts).
function verseSchema(): JsonSchema {
  return {
    type: "object",
    description:
      "ONE Berean Standard Bible verse (verse_end equal to verse_start), at most 25 words, for this affirmation.",
    properties: passageProperties(),
    required: PASSAGE_REQUIRED,
  };
}

// The small schema for asking for other verses for some affirmations (verses.ts): two verses per affirmation named, best
// first (VERSE_CANDIDATES).
export function buildVersesSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      verses: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: { time_slot: { type: "string", enum: [...TIME_SLOTS] }, ...passageProperties() },
          required: ["time_slot", ...PASSAGE_REQUIRED],
        },
      },
    },
    required: ["verses"],
  };
}

// The reflection's schema. The call only ever sees text (the crisis screening has already transcribed a recording and
// judged it), so there is no transcript and no no_speech here. is_crisis stays: it is the last of the three layers, and since
// gen-v2.4 it marks a heavy moment, whose reflection is still written in full, so no field is nullable any more.
export function buildSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      is_crisis: {
        type: "boolean",
        description:
          "True when the entry suggests suicide or self-harm risk, intent to harm others, or danger now, or a heavy_moment block follows it. Every other field is still written in full.",
      },
      dominant_emotion: { type: "string", enum: [...EMOTIONS], description: "The core feeling in the entry." },
      reflection_title: text("2 to 6 words in Title Case, at most 40 characters."),
      // gen-v2.3 (step 36): right after the title, because Gemini writes the properties in this order.
      validation_line: text("One sentence of 8 to 18 words, second person, written from the entry."),
      scripture: {
        type: "object",
        description: "Where the chosen Berean Standard Bible passage is.",
        properties: passageProperties(),
        required: PASSAGE_REQUIRED,
      },
      devotional_text: text("110 to 150 words in 3 or 4 short paragraphs."),
      closing_prayer: text("5 to 7 sentences, 50 to 75 words, without Amen."),
      prayer: {
        type: "object",
        properties: {
          is_active_prayer: { type: "boolean" },
          title: text("At most 60 characters, or an empty string."),
          summary: text("At most 120 characters, or an empty string."),
          category: { type: "string", enum: [...PRAYER_CATEGORIES, "NONE"] },
        },
        required: ["is_active_prayer", "title", "summary", "category"],
      },
      affirmations: {
        type: "array",
        maxItems: 3,
        description: "One per time of day.",
        items: {
          type: "object",
          // gen-v2.5 (step 37): the verse comes before the headline, because Gemini writes the properties in this order and
          // the headline is written from its verse.
          properties: {
            time_slot: { type: "string", enum: [...TIME_SLOTS] },
            verse: verseSchema(),
            headline: text("2 to 6 words, at most 38 characters, spoken to them: what its verse says to them."),
            text: text("12 to 30 words, second person."),
          },
          required: ["time_slot", "verse", "headline", "text"],
        },
      },
    },
    required: [
      "is_crisis",
      "dominant_emotion",
      "reflection_title",
      "validation_line",
      "scripture",
      "devotional_text",
      "closing_prayer",
      "prayer",
      "affirmations",
    ],
  };
}
