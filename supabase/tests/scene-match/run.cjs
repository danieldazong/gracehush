// The 2026-11-20 checks: which of the twenty painted scenes a reflection is shown with (src/utils/sceneMatch.ts). The Today
// tab's deck of words, its shared picture, the Now Playing card and the lock screen all take a reflection's scene from here, so
// the scene must interpret what the reflection is about, never name a heavy moment, and never change when the person turns a
// prayer on or off. They run the real matcher on made-up reflections and on the 36 made-up entries of the tone evaluation
// (supabase/functions/process-entry/eval/cases.json), with no devotional, as a reflection reads while its words are all there is.
//
//   node --no-warnings supabase/tests/scene-match/run.cjs          (from the repo root; a second or two)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/scene-match/run.cjs
//
// What it cannot show is how a person reads a picture beside their words: that is the phone's and the owner's. Exit code 0 only
// when every check passes. ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either).
process.env.TZ = "UTC"; // a reflection's hour leans toward the scenes of that part of the day: read it in one zone
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeEnv } = require("../recording/world.cjs");

const REPO = process.env.GRACEHUSH_REPO;
const NL = String.fromCharCode(10);

let passed = 0;
const failures = [];
async function test(name, fn) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}${NL}    ${String(error && error.stack ? error.stack : error).split(NL).slice(0, 6).join(`${NL}    `)}`);
  }
}

const match = () => makeEnv().use("@/utils/sceneMatch");

// Height and width of a JPEG from its frame header, and whether it is progressive and carries an Exif block.
function jpegInfo(bytes) {
  assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, "a JPEG");
  let offset = 2;
  let exif = false;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff, "a marker");
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1) exif = true;
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), progressive: marker === 0xc2, exif };
    }
    offset += 2 + length;
  }
  throw new Error("no frame header");
}
const { rankScenes, deckScenes, SCENE_COUNT, UNIVERSAL_SCENES } = match();

// The scenes, as the matcher's header lists them (0 is player-scene-1).
const NIGHT_BED = 0;
const BACK_STEPS = 1;
const ARMCHAIR = 2;
const PARK = 3;
const NEW_MOTHER = 4;
const SHIFT = 5;
const BED_EDGE = 6;
const KETTLE = 7;
const DESK = 8;
const BAKERY = 9;
const LAUNDRY = 10;
const TRAIN = 11;
const PLAYGROUND = 12;
const HOSPITAL = 13;
const DRIVER = 14;
const LIBRARY = 15;
const SINK = 16;
const PARKED_CAR = 17;
const BILLS = 18;
const BIBLE = 19;
const CHILD_SCENES = [NEW_MOTHER, LAUNDRY, PLAYGROUND];

let made = 0;
// A finished reflection with only the person's words, made at an hour of 2026-11-18 (UTC).
function reflection(words, { hour = 22, id, feeling = null, heavy = false, devotional = null, prayer = null, updatedAt } = {}) {
  made += 1;
  const createdAt = `2026-11-18T${String(hour).padStart(2, "0")}:10:00.000Z`;
  return {
    id: id ?? `entry-${made}`,
    clientEntryId: null,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
    inputType: "text",
    transcript: words,
    dominantEmotion: feeling,
    status: "ready",
    isCrisis: heavy,
    helpLine: heavy ? "crisis" : null,
    scripture: null,
    devotional,
    prayer,
    failureCode: null,
    isLocalOnly: false,
  };
}

function devotional(title, script, validation = null) {
  return { title, validation, script, closingPrayer: null, audioPath: null, durationMs: null };
}

const cases = (() => {
  const data = JSON.parse(fs.readFileSync(path.join(REPO, "supabase/functions/process-entry/eval/cases.json"), "utf8"));
  const list = Array.isArray(data) ? data : data.cases;
  return new Map(list.map((item) => [item.id, item.text]));
})();
const HOURS = [7, 14, 22]; // the morning, the afternoon and the night each lean toward their own scenes
const caseRanks = (id) => {
  const words = cases.get(id);
  assert.ok(typeof words === "string", `the tone evaluation still has the case ${id}`);
  return HOURS.map((hour) => rankScenes(reflection(words, { hour, id: `case-${id}` })));
};

(async () => {
  await test("the list: every reflection is offered at least the seven quiet scenes, each scene once, every one of the twenty", async () => {
    assert.equal(SCENE_COUNT, 20);
    assert.deepEqual([...UNIVERSAL_SCENES], [NIGHT_BED, BACK_STEPS, ARMCHAIR, PARK, BED_EDGE, KETTLE, BIBLE]);
    const samples = [
      reflection(""),
      reflection(null),
      reflection("Thank you God for today."),
      reflection("My boss shouted in the meeting and the rent is overdue and the baby has a fever.", { hour: 3 }),
      ...[...cases.values()].map((words, i) => reflection(words, { hour: i % 24 })),
    ];
    for (const entry of samples) {
      const ranked = rankScenes(entry);
      assert.ok(ranked.length >= UNIVERSAL_SCENES.length, "never fewer than the quiet scenes");
      assert.equal(new Set(ranked).size, ranked.length, "no scene twice");
      for (const scene of ranked) assert.ok(Number.isInteger(scene) && scene >= 0 && scene < SCENE_COUNT, `a real scene: ${scene}`);
      for (const scene of UNIVERSAL_SCENES) assert.ok(ranked.includes(scene), `the quiet scene ${scene} is always offered`);
    }
    // A reflection with no words of its own (a recording not transcribed yet) still has a picture.
    const silent = reflection(null, { hour: 14 });
    silent.devotional = null;
    assert.ok(rankScenes(silent).length > 0);
  });

  await test("every scene: each of the twenty is the first choice for a reflection about its own moment", async () => {
    const moments = [
      [NIGHT_BED, "I couldn’t sleep again, lying awake in the middle of the night."],
      [BACK_STEPS, "We moved to a new city and this feels like a fresh start."],
      [ARMCHAIR, "The house is so quiet since the children left and I feel lonely."],
      [PARK, "We went for a walk in the park and I felt so grateful."],
      [NEW_MOTHER, "Our newborn baby kept me up for the night feed."],
      [SHIFT, "I am working a double shift at the warehouse again."],
      [BED_EDGE, "I woke up and could not face the day."],
      [KETTLE, "Making my coffee and breakfast before anyone else is up."],
      [DESK, "My boss moved the deadline and I have a presentation tomorrow."],
      [BAKERY, "Sales at my small business have been slow and customers stopped coming."],
      [LAUNDRY, "The laundry never ends and my toddler made a mess again."],
      [TRAIN, "The commute was awful, the train was late and the traffic was terrible."],
      [PLAYGROUND, "I sat at the playground after the school run while they played."],
      [HOSPITAL, "I am waiting for the biopsy result from the doctor."],
      [DRIVER, "I am a delivery driver and I ate my lunch in the van."],
      [LIBRARY, "I have a final exam tomorrow and I cannot stop studying."],
      [SINK, "After dinner I washed the dishes in the kitchen and cried."],
      [PARKED_CAR, "My husband and I argued again and I sat in the car before I could go inside."],
      [BILLS, "I can’t afford the rent and the bills are overdue."],
      [BIBLE, "I read my Bible before bed and felt close to God."],
    ];
    assert.deepEqual(moments.map(([scene]) => scene), Array.from({ length: SCENE_COUNT }, (_, i) => i), "one moment for each scene");
    for (const [scene, words] of moments) {
      for (const hour of HOURS) {
        const ranked = rankScenes(reflection(words, { hour }));
        assert.equal(ranked[0], scene, `"${words}" at ${hour}h: ${ranked.slice(0, 4).join(",")}`);
      }
    }
  });

  await test("the tone evaluation's entries: each is shown the scene of what it is about, at any hour", async () => {
    const first = {
      "anxiety-money": BILLS,
      "anxiety-test-result": HOSPITAL,
      "weary-caregiving": HOSPITAL,
      "weary-parenting": LAUNDRY,
      "weary-burnout": DESK,
      "anger-at-god": NIGHT_BED,
      "church-hurt": ARMCHAIR,
      "gratitude-good-report": HOSPITAL,
      "gratitude-answered-prayer": DESK,
      "hope-new-start": BACK_STEPS,
      "joy-new-baby": NEW_MOTHER,
      loneliness: ARMCHAIR,
      "guilt-mistake": PARKED_CAR,
      "long-rambling": LAUNDRY,
      "names-grace": LIBRARY,
      "names-blessing": ARMCHAIR,
      "quotes-psalm": BIBLE,
      "pidgin-work": BILLS,
      "decision-job": DESK,
      "prayer-for-friend": HOSPITAL,
      "voice-rambling": NEW_MOTHER,
      "unclear-marks": HOSPITAL,
      "wedding-joy": PARK,
      "traffic-annoyance": TRAIN,
      "exam-dropout": LIBRARY,
      "job-lost": DESK,
      "give-up-business": BAKERY,
      "grief-parent": ARMCHAIR,
    };
    for (const [id, scene] of Object.entries(first)) {
      caseRanks(id).forEach((ranked, i) => assert.equal(ranked[0], scene, `${id} at ${HOURS[i]}h: ${ranked.slice(0, 4).join(",")}`));
    }
    // Layoffs with the rent and school fees behind them are both the desk's and the bills' moment.
    for (const ranked of caseRanks("anxiety-work")) assert.deepEqual([...ranked.slice(0, 2)].sort((a, b) => a - b), [DESK, BILLS]);
    // A pet that died: the armchair or the park, never a situation the words do not hold.
    for (const ranked of caseRanks("grief-pet")) assert.ok([ARMCHAIR, PARK].includes(ranked[0]), ranked.join(","));
    // Words that name no situation take one of the quiet scenes.
    for (const id of ["short-tired", "short-thanks", "doubt-unanswered", "grief-miscarriage", "decision-anger", "injection"]) {
      for (const ranked of caseRanks(id)) assert.ok(UNIVERSAL_SCENES.includes(ranked[0]), `${id}: ${ranked.join(",")}`);
    }
  });

  await test("wounds: a death, a lost pregnancy or a longing for a child never shows a baby, a child or a playground", async () => {
    for (const id of ["grief-miscarriage", "doubt-unanswered"]) {
      for (const ranked of caseRanks(id)) for (const scene of CHILD_SCENES) assert.ok(!ranked.includes(scene), `${id} offers ${scene}`);
    }
    const lost = rankScenes(reflection("We lost our baby. The nursery is still painted and the laundry is still folded."));
    for (const scene of CHILD_SCENES) assert.ok(!lost.includes(scene), `a lost pregnancy offers ${scene}`);
    const longing = rankScenes(reflection("Another month of trying for a baby. I watched the kids at the playground and wept."));
    for (const scene of CHILD_SCENES) assert.ok(!longing.includes(scene), `a longing for a child offers ${scene}`);
    // A grieving reflection never shows a child, whatever its words.
    const grieving = rankScenes(reflection("The baby smiled at me today.", { feeling: "grieving" }));
    for (const scene of CHILD_SCENES) assert.ok(!grieving.includes(scene), `a grieving reflection offers ${scene}`);
    // Any death keeps the children out, even with no loss of a child named and no feeling given.
    const death = rankScenes(reflection("My father died in the spring. This afternoon I sat at the playground while the kids played.", { hour: 14 }));
    for (const scene of CHILD_SCENES) assert.ok(!death.includes(scene), `a death offers ${scene}`);
  });

  await test("wounds: a death never shows the hospital or the husband or wife in the car", async () => {
    for (const id of ["grief-parent", "grief-miscarriage"]) {
      for (const ranked of caseRanks(id)) {
        for (const scene of [HOSPITAL, PARKED_CAR]) assert.ok(!ranked.includes(scene), `${id} offers ${scene}`);
      }
    }
    const died = rankScenes(reflection("My husband died at the hospital after the surgery and I drove home alone."));
    for (const scene of [HOSPITAL, PARKED_CAR, ...CHILD_SCENES]) assert.ok(!died.includes(scene), `a death offers ${scene}`);
    // The same words with no death show the hospital first.
    assert.equal(rankScenes(reflection("My husband is at the hospital after the surgery and I drove home alone."))[0], HOSPITAL);
  });

  await test("a heavy moment is shown only the quiet scenes, whatever its words, so its picture never names what is happening", async () => {
    const said = [
      "I can’t go on. I sat in the car outside the hospital for an hour.",
      "My husband hit me again and the kids saw it.",
      "I lost my job and I can’t pay the rent and I don’t want to be here anymore.",
    ];
    for (const words of said) {
      for (const hour of [3, 7, 14, 19]) {
        const ranked = rankScenes(reflection(words, { hour, heavy: true }));
        assert.deepEqual([...ranked].sort((a, b) => a - b), [...UNIVERSAL_SCENES], `${hour}h: ${ranked.join(",")}`);
      }
    }
    // Its words do not move the order either: two heavy moments made at the same moment rank alike.
    const a = rankScenes(reflection(said[0], { hour: 14, heavy: true, id: "heavy-1" }));
    const b = rankScenes(reflection(said[1], { hour: 14, heavy: true, id: "heavy-1" }));
    assert.deepEqual([...a], [...b]);
  });

  await test("a prayer turned on or off never changes the scene, and a finished reflection's words do", async () => {
    const words = "I can’t stop crying about my exam results.";
    const off = reflection(words, { id: "prayer-toggle", hour: 9 });
    const prayer = {
      id: "prayer-toggle",
      title: "Healing at the hospital",
      category: null,
      summary: "Pray for the surgery and the doctor and the rent",
      scriptureReference: null,
      createdAt: off.createdAt,
      isAnswered: false,
      answeredAt: null,
      answeredNote: null,
    };
    const on = { ...off, prayer, updatedAt: "2026-11-19T08:00:00.000Z" };
    const answered = { ...on, prayer: { ...prayer, isAnswered: true, answeredNote: "The rent was paid." }, updatedAt: "2026-11-20T08:00:00.000Z" };
    const fresh = match(); // another phone: no cache shared
    for (const rank of [rankScenes, fresh.rankScenes]) {
      assert.deepEqual([...rank(on)], [...rank(off)], "turning the prayer on");
      assert.deepEqual([...rank(answered)], [...rank(off)], "marking it answered with a note");
      assert.equal(rank(on)[0], LIBRARY);
    }
    // A recording whose words arrive later is ranked again from them.
    const pending = reflection(null, { id: "late-words", hour: 14 });
    assert.ok(UNIVERSAL_SCENES.includes(rankScenes(pending)[0]));
    assert.equal(rankScenes({ ...pending, transcript: "My final exam is tomorrow and I failed the last one." })[0], LIBRARY);
  });

  await test("weights: the person's own words count more than the devotional's, and the devotional alone can still choose", async () => {
    // A situation only in the devotional's script still reaches its scene.
    const scriptOnly = reflection("Today was hard.", {
      hour: 22,
      devotional: devotional("Strength for the Waiting Room", "You sat in the waiting room with the doctor’s words in your ears."),
    });
    assert.equal(rankScenes(scriptOnly)[0], HOSPITAL);
    // When the person's words name one situation and the script another, as often, the words win.
    const both = reflection("My exam is tomorrow.", {
      hour: 22,
      devotional: devotional("Peace Before Tomorrow", "Like a night in a hospital, a long night can feel endless."),
    });
    assert.equal(rankScenes(both)[0], LIBRARY);
    // The title and the validation line are the person's moment in other words, and count as theirs.
    const title = reflection("I don’t know.", { hour: 22, devotional: devotional("Rest for the Night Shift", "God sees you.", null) });
    assert.equal(rankScenes(title)[0], SHIFT);
    // One strong cue, even only in the script, leads the quiet scene the hour and the feeling both lean toward.
    for (let n = 0; n < 8; n += 1) {
      const leaned = reflection("I am so tired.", {
        id: `leaned-${n}`,
        hour: 22,
        feeling: "weary",
        devotional: devotional("Strength for Tomorrow", "The exam can wait until morning."),
      });
      assert.equal(rankScenes(leaned)[0], LIBRARY, `leaned-${n}: ${rankScenes(leaned).join(",")}`);
    }
    // A cue counts once, whether it is in the words, the script or both: two situations named alike stay a tie that the
    // reflection decides, and a script that repeats one of them does not break it.
    const firsts = new Set();
    for (let n = 0; n < 8; n += 1) {
      const twice = reflection("My exam and the hospital visit are both tomorrow.", {
        id: `twice-${n}`,
        hour: 14,
        devotional: devotional("Peace for Tomorrow", "Before the exam, breathe."),
      });
      firsts.add(rankScenes(twice)[0]);
    }
    assert.deepEqual([...firsts].sort((a, b) => a - b), [HOSPITAL, LIBRARY], [...firsts].join(","));
  });

  await test("leans: with nothing to go on, the hour and the feeling choose among the quiet scenes", async () => {
    assert.equal(rankScenes(reflection("", { hour: 14 }))[0], PARK, "the afternoon's quiet scene");
    assert.equal(rankScenes(reflection("", { hour: 10 }))[0], ARMCHAIR, "the morning's quiet scene");
    for (const hour of [5, 6, 7, 8]) assert.ok([BACK_STEPS, BED_EDGE, KETTLE].includes(rankScenes(reflection("", { hour }))[0]));
    for (const hour of [21, 23, 0, 3]) assert.ok([NIGHT_BED, BIBLE].includes(rankScenes(reflection("", { hour }))[0]));
    // At an hour that names only the bench, a feeling still pulls its own scene up past the others.
    const feelingFirst = { anxious: [BED_EDGE, NIGHT_BED, KETTLE], weary: [BIBLE, ARMCHAIR, KETTLE], grieving: [ARMCHAIR, BIBLE, NIGHT_BED] };
    for (const [feeling, scenes] of Object.entries(feelingFirst)) {
      const ranked = rankScenes(reflection("", { hour: 14, feeling }));
      assert.ok([PARK, ...scenes].includes(ranked[0]), `${feeling}: ${ranked.join(",")}`);
      assert.ok(scenes.includes(ranked.find((scene) => scene !== PARK)), `${feeling} leans toward its own: ${ranked.join(",")}`);
    }
  });

  await test("reading: capitals, curly apostrophes, plurals and phrases are read as the same words", async () => {
    assert.equal(rankScenes(reflection("I CAN’T SLEEP.", { hour: 14 }))[0], NIGHT_BED);
    assert.equal(rankScenes(reflection("i cant sleep", { hour: 14 }))[0], NIGHT_BED);
    // A word with an apostrophe, curly or straight, is one word: "can’t have kids" is a longing for a child.
    for (const words of ["We can’t have kids. The school gate at pickup hurts.", "We can't have kids. The school gate at pickup hurts."]) {
      const ranked = rankScenes(reflection(words, { hour: 14 }));
      for (const scene of CHILD_SCENES) assert.ok(!ranked.includes(scene), `${words} offers ${scene}`);
    }
    assert.equal(rankScenes(reflection("Two exams this week.", { hour: 7 }))[0], LIBRARY);
    assert.equal(rankScenes(reflection("So many buses and trains.", { hour: 22 }))[0], TRAIN);
    // A cue never matches inside another word ("shift" is not in "shifting", "tea" is not in "team"): only the night leans here.
    const team = rankScenes(reflection("Our team is shifting priorities.", { hour: 22 }));
    assert.ok(!team.includes(SHIFT) && [NIGHT_BED, BIBLE].includes(team[0]), team.join(","));
    // A husband named in passing is not a strained marriage, and someone else's travel is not the person's commute.
    const passing = rankScenes(reflection("My husband is travelling this week and the baby is teething.", { hour: 14 }));
    assert.equal(passing[0], NEW_MOTHER);
    assert.ok(!passing.includes(PARKED_CAR) && !passing.includes(TRAIN), passing.join(","));
  });

  await test("the same reflection gets the same scene on every phone and every time", async () => {
    const other = match();
    for (const [id, words] of cases) {
      const entry = reflection(words, { hour: 11, id: `again-${id}` });
      assert.deepEqual([...other.rankScenes(entry)], [...rankScenes(entry)], id);
      assert.deepEqual([...rankScenes({ ...entry })], [...rankScenes(entry)], id);
    }
  });

  await test("the deck: neighbours never show the same scene, a card the screen does not hold takes the hour's", async () => {
    const exams = Array.from({ length: 4 }, (_, i) => reflection("My exam is tomorrow and I am scared.", { hour: 14, id: `exam-${i}` }));
    const picked = deckScenes(exams, BIBLE);
    assert.equal(picked.length, 4);
    assert.equal(picked[0], LIBRARY);
    assert.notEqual(picked[1], LIBRARY);
    assert.ok(![LIBRARY, picked[1]].includes(picked[2]), picked.join(","));
    assert.equal(picked[3], LIBRARY, "two cards back, the library may come again");
    // Each card's scene is one its own reflection offers.
    picked.forEach((scene, i) => assert.ok(rankScenes(exams[i]).includes(scene)));
    // The whole deck: no card repeats either of the two before it.
    const deck = [...cases.values()].map((words, i) => reflection(words, { hour: (i * 5) % 24, id: `deck-${i}` }));
    const all = deckScenes(deck, BIBLE);
    all.forEach((scene, i) => {
      assert.ok(!all.slice(Math.max(0, i - 2), i).includes(scene), `card ${i} repeats a neighbour: ${all.slice(Math.max(0, i - 2), i + 1)}`);
    });
    // Loading older pages never changes the cards already drawn.
    for (let k = 0; k <= deck.length; k += 1) assert.deepEqual(deckScenes(deck.slice(0, k), BIBLE), all.slice(0, k));
    // A card whose reflection the screen does not hold takes the fallback, and the cards after it still differ from it.
    const withGap = deckScenes([exams[0], null, exams[1]], KETTLE);
    assert.deepEqual(withGap.slice(0, 2), [LIBRARY, KETTLE]);
    assert.ok(![LIBRARY, KETTLE].includes(withGap[2]), withGap.join(","));
    assert.deepEqual(deckScenes([], KETTLE), []);
  });

  await test("wiring: every surface takes the reflection's scene from the matcher, and the matcher reads no prayer field", async () => {
    const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");
    const matcher = read("src/utils/sceneMatch.ts");
    assert.ok(!/entry\.prayer|prayer\?\.|\.prayer\b/.test(matcher), "the matcher never reads the prayer");
    assert.ok(!/from "react-native"|fetch\(|console\./.test(matcher), "pure: no React Native, no network, no log");
    assert.ok(read("src/data/selectors.ts").includes("scenes: rankScenes(entry).slice(0, PLAYER_SCENES_SHOWN)"), "the player's track");
    assert.ok(read("src/screens/journal/JournalFeedScreen.tsx").includes("scenes={deckScenes("), "the deck");
    assert.ok(read("src/services/lockScreen.ts").includes("track.scenes[0] ??"), "the lock screen");
    // Now Playing drifts through the reflection's own scenes, the hour's only when it has none, and SceneStack, which makes its
    // layers once, is drawn again when the scenes change.
    const player = read("src/screens/journal/NowPlayingScreen.tsx");
    assert.ok(player.includes("<Artwork scenes={scenes} "), "the card is given the track's scenes");
    assert.ok(player.includes("const shown = scenes.length > 0 ? scenes : [hourScene];"), "the hour only for a track with none");
    assert.ok(player.includes('key={shown.join(",")}'), "a new stack for new scenes");
  });

  await test("files: twenty scenes in file order, each a 4:3 card crop and a square lock-screen crop, progressive and bare", async () => {
    const images = fs.readFileSync(path.join(REPO, "src/constants/images.ts"), "utf8").replace(/\r\n/g, NL);
    for (const [list, name] of [["playerScenes", "playerScene"], ["playerSceneSquares", "playerSceneSquare"]]) {
      const found = images.match(new RegExp(`export const ${list} = \\[\\n([\\s\\S]*?)\\] as const;`));
      assert.ok(found, `the ${list} list`);
      const names = found[1].split(",").map((item) => item.trim()).filter(Boolean);
      assert.deepEqual(names, Array.from({ length: SCENE_COUNT }, (_, i) => `${name}${i + 1}`), `${list}: the twenty in file order`);
    }
    for (let n = 1; n <= SCENE_COUNT; n += 1) {
      for (const [name, file, width, height] of [
        [`playerScene${n}`, `player-scene-${n}.jpg`, 1290, 968],
        [`playerSceneSquare${n}`, `player-scene-${n}-square.jpg`, 1024, 1024],
      ]) {
        assert.ok(images.includes(`import ${name} from "@/assets/images/${file}";`), `${name} imports ${file}`);
        const info = jpegInfo(fs.readFileSync(path.join(REPO, "assets/images", file)));
        assert.deepEqual([info.width, info.height], [width, height], file);
        assert.ok(info.progressive, `${file}: progressive`);
        assert.ok(!info.exif, `${file}: no metadata`);
      }
    }
  });

  process.stdout.write(failures.length === 0 ? `${passed} checks passed${NL}` : `${passed} checks passed, ${failures.length} FAILED${NL}${NL}${failures.join(NL + NL)}${NL}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
})();
