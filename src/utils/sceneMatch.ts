import type { JournalEntry } from "@/types";

// Which of the twenty painted scenes interprets a reflection best (2026-11-20, the owner's request: "the image selected for any
// reflection is the nearest image that interprets the reflection"). Pure and on the phone: it reads what the reflection already
// holds (the person's words, the lines the model wrote from them, the feeling it named and the hour it was made) and sends
// nothing anywhere. It never reads the prayer fields: they are there only while the reflection is tracked as a prayer, and a
// card's picture must not change when the person turns that on or off. It never guesses who the person is (no gender or age is read): a scene is chosen for
// the moment it shows, not for its person.
//
// A scene index runs over `playerScenes` (0 is player-scene-1):
//   0 a woman kneeling at her bed at night          10 a mother pausing over the laundry with a child's shirt
//   1 a man on his back steps at first light         11 a man on the morning train
//   2 an older woman in an armchair by a window      12 a mother on a playground bench in the afternoon
//   3 a young man on a park bench in the afternoon   13 a woman waiting for news at a hospital
//   4 a new mother at the dawn feed                  14 a delivery driver on his lunch break
//   5 a shift worker in his truck before his shift   15 a student in the library before an exam
//   6 a woman on the edge of her bed at first light  16 a woman at the kitchen sink after dinner
//   7 a man with a mug by the kettle, early          17 a man in his parked car before going inside, at dusk
//   8 a woman at her home-office desk before work    18 a mother at the dining table with the bills after bedtime
//   9 a bakery owner before opening                  19 an older man with a Bible at the end of the day

export const SCENE_COUNT = 20;

// The scenes that fit any reflection: a person alone in a quiet moment, tied to no role or situation. A heavy moment is shown
// only these, so a picture never names what the person is going through; any other reflection may take them on its feeling,
// its hour or its words.
export const UNIVERSAL_SCENES: readonly number[] = [0, 1, 2, 3, 6, 7, 19];

// A cue is a word or a phrase, written as the matcher normalises text (lowercase, apostrophes dropped, each word made
// singular), with its weight: STRONG names the situation a scene shows; WEAK only leans toward it.
const STRONG = 3;
const WEAK = 1;
type Cue = readonly [term: string, weight: number];

const s = (...terms: string[]): Cue[] => terms.map((term) => [term, STRONG] as const);
const w = (...terms: string[]): Cue[] => terms.map((term) => [term, WEAK] as const);

const CUES: readonly (readonly Cue[])[] = [
  // 0 kneeling at the bed at night
  [
    ...s("cant sleep", "couldnt sleep", "cannot sleep", "insomnia", "lie awake", "lying awake", "lay awake", "awake at night"),
    ...s("middle of the night", "late at night", "midnight", "on my knee", "kneel", "kneeling", "bedside", "nightmare"),
    ...s("cried myself to sleep", "cry myself to sleep", "angry at god", "why would god", "where is god", "god feel far"),
    ...w("tonight", "night", "sleep", "pray", "prayer", "doubt", "church"),
  ],
  // 1 the back steps at first light
  [
    ...s("first light", "sunrise", "new start", "fresh start", "new beginning", "start over", "starting over", "new chapter"),
    ...s("new city", "new home", "new house", "new country", "porch", "back step", "front step"),
    ...w("dawn", "early morning", "moved", "moving", "new season", "outside"),
  ],
  // 2 the armchair by the window
  [
    ...s("lonely", "loneliness", "widow", "widowed", "on my own", "by myself", "eat alone", "quiet house", "empty house"),
    ...s("miss my", "i miss", "grandchild", "grandchildren", "granddaughter", "grandson", "elderly", "old age", "arthritis"),
    ...w("alone", "quiet", "window", "rest", "phone doesnt ring", "nobody call", "no one call"),
  ],
  // 3 the park bench in the afternoon
  [
    ...s("park", "bench", "good news", "went for a walk", "go for a walk", "walk the dog", "fresh air", "wedding", "celebrate"),
    ...w("walk", "walking", "outside", "outdoor", "nature", "sunshine", "sun", "tree", "bird", "dog", "cat", "pet"),
    ...w("celebration", "party", "birthday", "anniversary", "so excited", "afternoon"),
  ],
  // 4 the new mother at the dawn feed
  [
    ...s("baby", "newborn", "infant", "breastfeeding", "breastfeed", "postpartum", "pregnant", "pregnancy"),
    ...s("gave birth", "was born", "were born", "diaper", "nappy", "night feed", "maternity"),
    ...w("tiny hand", "born", "feeding", "nursing"),
  ],
  // 5 the shift worker before his shift
  [
    ...s("shift", "night shift", "early shift", "double shift", "overtime", "warehouse", "factory", "construction"),
    ...s("truck", "mechanic", "plumber", "electrician", "welder", "security guard", "clock in", "building site"),
    ...s("hard labor", "hard labour", "manual labor", "manual labour", "work boot"),
    ...w("site", "labour", "labor", "plant"),
  ],
  // 6 the edge of the bed at first light
  [
    ...s("woke up", "wake up", "waking up", "get out of bed", "out of bed", "start the day", "face the day"),
    ...s("monday morning", "cant get up", "couldnt get up", "this morning i"),
    ...w("this morning", "morning", "alarm", "dread", "another day"),
  ],
  // 7 the kettle, early
  [...s("coffee", "tea", "kettle", "breakfast", "mug"), ...w("cup of", "kitchen")],
  // 8 the home-office desk before work
  [
    ...s("meeting", "interview", "presentation", "deadline", "boss", "manager", "layoff", "laid off", "let me go", "fired"),
    ...s("promotion", "office", "colleague", "coworker", "co worker", "email", "project", "career", "job", "new job"),
    ...s("job offer", "lost my job", "unemployed", "job hunting", "performance review", "resign", "resignation", "client"),
    ...s("laptop", "zoom", "worked late", "oga"),
    ...w("work", "working", "company", "salary", "offer", "applied", "application", "team", "monday"),
  ],
  // 9 the bakery before opening
  [
    ...s("shop", "business", "customer", "bakery", "bake", "baking", "restaurant", "cafe", "sale", "profit"),
    ...s("small business", "entrepreneur", "startup", "start up", "inventory", "supplier", "revenue", "my store"),
    ...w("store", "stock", "market"),
  ],
  // 10 the laundry, with a child's shirt
  [
    ...s("laundry", "chore", "housework", "stay at home", "toddler", "school uniform", "clean the house", "folding"),
    ...s("homeschool", "parenting", "yelled at my", "shouted at my", "my kid", "my children"),
    ...w("kid", "children", "child", "the kid", "cleaning", "mess", "spill", "spilling", "mom", "mum", "my son", "my daughter"),
  ],
  // 11 the morning train
  [
    ...s("commute", "train", "bus", "traffic", "subway", "metro", "rush hour", "flight", "airport"),
    ...s("drive to work", "missed the bus", "on my way to work"),
    // Travel is as often someone else's ("my husband is travelling") as the person's own, so it only leans here.
    ...w("travel", "travelling", "traveling", "journey", "trip", "bridge", "on my way", "road"),
  ],
  // 12 the playground bench
  [
    ...s("playground", "school run", "pick up the kid", "preschool", "kindergarten", "school gate", "after school"),
    ...s("play date", "playdate", "recital"),
    ...w("kid", "child", "children", "football", "swing", "school"),
  ],
  // 13 waiting for news at the hospital
  [
    ...s("hospital", "doctor", "scan", "biopsy", "diagnosis", "diagnosed", "surgery", "operation", "cancer", "tumor"),
    ...s("tumour", "chemo", "chemotherapy", "test result", "scan result", "blood test", "medical", "clinic", "waiting room"),
    ...s("icu", "intensive care", "stroke", "heart attack", "illness", "treatment", "medication", "ambulance", "lump"),
    ...s("emergency room", "mammogram", "checkup", "check up", "my health", "caring for my", "caregiver"),
    ...s("waiting for news"),
    ...w("result", "appointment", "ward", "sick", "ill", "nurse", "pain", "medicine", "test"),
  ],
  // 14 the delivery driver's lunch break
  [
    ...s("delivery", "driver", "van", "courier", "parcel", "lunch break", "uber", "rideshare", "taxi", "on the road", "gig"),
    ...w("lunch", "route", "package", "driving"),
  ],
  // 15 the library before an exam
  [
    ...s("exam", "studying", "study for", "revision", "student", "university", "college", "lecture", "thesis", "dissertation"),
    ...s("assignment", "grade", "gpa", "semester", "final exam", "library", "scholarship", "graduation", "degree"),
    ...s("drop out", "my course", "coursework", "professor", "campus", "board exam", "waec", "jamb", "neco"),
    ...w("study", "school", "class", "homework", "graduate", "test"),
  ],
  // 16 the kitchen sink after dinner
  [
    ...s("dinner", "dish", "washing up", "cooking", "kitchen", "supper", "after dinner", "feed my family", "housewife"),
    ...w("cook", "meal", "food", "grocery", "family", "evening", "my husband"),
  ],
  // 17 the parked car before going inside
  [
    ...s("marriage", "argument", "argue", "argued", "arguing", "fought", "divorce", "separated", "separation"),
    ...s("go inside", "sat in the car", "sitting in the car", "in the driveway", "parked", "drove home"),
    ...s("home from work", "after work", "silent treatment", "tension", "eggshell"),
    // A husband or a wife named in passing ("my husband is travelling") is not a strained marriage, so they only lean here.
    ...w("husband", "wife", "spouse", "my partner", "fight", "car", "long day", "relationship", "brother", "sister", "father"),
    ...w("dad", "married"),
  ],
  // 18 the dining table with the bills
  [
    ...s("bill", "rent", "debt", "money", "loan", "borrow", "borrowed", "mortgage", "budget", "paycheck", "landlord"),
    ...s("school fee", "fee", "tuition", "afford", "cant afford", "expense", "overdue", "late payment", "eviction", "evict"),
    ...s("finance", "financial", "make end meet", "electricity bill", "my saving", "kid are asleep", "after the kid"),
    ...w("salary", "broke", "price", "pay for", "bedtime", "grocery"),
  ],
  // 19 the older man with a Bible at the end of the day
  [
    ...s("bible", "scripture", "read my bible", "reading my bible", "quiet time", "end of the day", "before bed"),
    ...s("going to bed", "retired", "retirement", "retire", "pension", "grandfather", "widower", "my late wife", "grey hair"),
    ...w("tonight", "read", "reading", "verse", "psalm", "proverb", "devotion", "the word", "church", "older", "long day"),
  ],
];

// A reflection about a death, a loss of a pregnancy, or a longing for a child never shows a baby, a child or a playground, and
// one about a death never shows the hospital or a husband or wife in the car, so the picture never reopens the wound.
const DEATH_CUES = [
  "died", "dead", "death", "passed away", "passed on", "funeral", "burial", "buried", "grief", "grieving", "mourn",
  "mourning", "widow", "widowed", "widower", "memorial", "rest in peace", "late husband", "late wife", "late father",
  "late mother", "lost my mother", "lost my father", "lost my mum", "lost my mom", "lost my dad", "lost my husband",
  "lost my wife", "lost my son", "lost my daughter", "lost my child", "lost my brother", "lost my sister", "lost my friend",
  "lost him", "lost her", "lost my baby", "lost our baby", "lost the baby", "miscarriage", "miscarried", "stillborn",
  "still birth",
];
const CHILD_LOSS_CUES = [
  "lost my baby", "lost our baby", "lost the baby", "miscarriage", "miscarried", "stillborn", "still birth", "infertility",
  "infertile", "ivf", "trying for a baby", "trying to conceive", "for a child", "for a baby", "cant have kid",
  "cant have children", "barren",
];
const CHILD_SCENES = [4, 10, 12];
const HOSPITAL_SCENE = 13;
const PARKED_CAR_SCENE = 17;

// The hour a reflection was made leans toward the scenes of that part of the day.
function hourScenes(hour: number): readonly number[] {
  if (hour >= 5 && hour <= 8) return [1, 6, 7, 4];
  if (hour >= 9 && hour <= 11) return [2, 8, 9, 10, 11];
  if (hour >= 12 && hour <= 16) return [3, 12, 13, 14, 15];
  if (hour >= 17 && hour <= 20) return [16, 17, 18, 19, 0];
  return [0, 19];
}

// The feeling the model named leans toward the universal scenes that carry it.
const FEELING_SCENES: Readonly<Record<string, readonly number[]>> = {
  anxious: [6, 0, 7],
  weary: [19, 2, 7],
  grateful: [3, 1],
  grieving: [2, 19, 0],
  hopeful: [1, 3, 6],
};

const WORDS_FACTOR = 2; // a cue in the person's words or a line written from them (the title, the validation line)
const SCRIPT_FACTOR = 1; // a cue only in the devotional's script
const CONTENT_CAP = 12;
const ELIGIBLE = STRONG; // a situation's scene is offered only when what the reflection says reaches one strong cue
const MATCH_BONUS = 2;
const HOUR_WEIGHT = 1.5;
const FEELING_WEIGHT = 1.5;
const TIE_WEIGHT = 0.5;

type Text = { words: ReadonlySet<string>; joined: string };

function singular(word: string): string {
  if (word.length <= 3 || word === "news") return word;
  if (word === "buses") return "bus";
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function readText(raw: string): Text {
  const list = raw
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0)
    .map(singular);
  return { words: new Set(list), joined: ` ${list.join(" ")} ` };
}

function has(text: Text, term: string): boolean {
  return term.includes(" ") ? text.joined.includes(` ${term} `) : text.words.has(term);
}

function anyOf(text: Text, terms: readonly string[]): boolean {
  return terms.some((term) => has(text, term));
}

// FNV-1a, so two scenes that score the same are ordered the same way for the same reflection on every phone.
function fnv(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash(value: string): number {
  return fnv(value) / 0xffffffff;
}

const cache = new Map<string, readonly number[]>();
const CACHE_LIMIT = 400;

// Every scene the reflection may show, best first. A heavy moment is offered only the universal scenes; any other reflection
// is offered the universal scenes and each situation its words reach. The list is never empty.
export function rankScenes(entry: JournalEntry): readonly number[] {
  const { devotional } = entry;
  const wordsRaw = [entry.transcript, devotional?.title, devotional?.validation]
    .filter((part): part is string => typeof part === "string")
    .join(" \n ");
  const scriptRaw = [devotional?.script, devotional?.closingPrayer].filter(Boolean).join(" \n ");
  const feeling = (entry.dominantEmotion ?? "").trim().toLowerCase();
  // The key holds everything the ranking reads and nothing else, so a prayer turned on or off never changes a card's scene.
  const key = `${entry.id}|${entry.createdAt}|${entry.isCrisis}|${feeling}|${fnv(`${wordsRaw}\u0000${scriptRaw}`)}`;
  const kept = cache.get(key);
  if (kept) return kept;

  const words = readText(wordsRaw);
  const script = readText(scriptRaw);
  const both: Text = { words: new Set([...words.words, ...script.words]), joined: `${words.joined} ${script.joined}` };

  const excluded = new Set<number>();
  if (anyOf(both, DEATH_CUES)) {
    for (const scene of CHILD_SCENES) excluded.add(scene);
    excluded.add(HOSPITAL_SCENE);
    excluded.add(PARKED_CAR_SCENE);
  }
  if (anyOf(both, CHILD_LOSS_CUES)) for (const scene of CHILD_SCENES) excluded.add(scene);

  if (feeling === "grieving") for (const scene of CHILD_SCENES) excluded.add(scene);

  const created = new Date(entry.createdAt);
  const hourLean = Number.isNaN(created.getTime()) ? [] : hourScenes(created.getHours());
  const feelingLean = FEELING_SCENES[feeling] ?? [];

  const scored: { scene: number; score: number }[] = [];
  for (let scene = 0; scene < SCENE_COUNT; scene += 1) {
    const universal = UNIVERSAL_SCENES.includes(scene);
    if (entry.isCrisis && !universal) continue;
    if (excluded.has(scene)) continue;

    let content = 0;
    if (!entry.isCrisis) {
      for (const [term, weight] of CUES[scene] ?? []) {
        if (has(words, term)) content += weight * WORDS_FACTOR;
        else if (has(script, term)) content += weight * SCRIPT_FACTOR;
      }
    }
    content = Math.min(content, CONTENT_CAP);
    if (!universal && content < ELIGIBLE) continue;

    let score = content;
    if (content >= ELIGIBLE) score += MATCH_BONUS;
    if (hourLean.includes(scene)) score += HOUR_WEIGHT;
    if (feelingLean.includes(scene)) score += FEELING_WEIGHT;
    score += hash(`${entry.id}:${scene}`) * TIE_WEIGHT;
    scored.push({ scene, score });
  }

  const ranked = scored.sort((a, b) => b.score - a.score || a.scene - b.scene).map((item) => item.scene);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, ranked);
  return ranked;
}

// The scene of each card of the Today deck, in the deck's order: a card's reflection's best scene that neither of the two
// cards before it shows, so neighbours in the pile never look alike; a card whose reflection the screen does not hold takes
// `fallback` (the scene of the hour). Each card depends only on the cards before it, so loading older pages never changes
// the cards already drawn.
export function deckScenes(entries: readonly (JournalEntry | null)[], fallback: number): number[] {
  const picked: number[] = [];
  for (const entry of entries) {
    if (entry === null) {
      picked.push(fallback);
      continue;
    }
    const recent = picked.slice(-2);
    const ranked = rankScenes(entry);
    picked.push(ranked.find((scene) => !recent.includes(scene)) ?? ranked[0] ?? fallback);
  }
  return picked;
}
