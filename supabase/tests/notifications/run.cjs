// The step 28 checks: the daily affirmation notifications. They run the app's real zoned time, planner, scheduler, tap routing
// and notifications service in Node, on a fake of expo-notifications 58 shaped like iOS and Android (world.cjs) and a virtual
// clock, so a week of notifications takes no real time. The repository's two new reads run on the step 25 world (the real
// SQLite cache), and the last checks read the shipped files.
//
//   node --no-warnings supabase/tests/notifications/run.cjs          (from the repo root; a few seconds)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/notifications/run.cjs
//
// What it cannot show is the phone: whether iOS shows the banner at the time, what the lock screen shows, and what a tap does
// in Expo Go when the app was closed. Those are the phone checks in the step 28 prompt. Exit code 0 only when every check passes.
//   ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either);
//   FAILFAST=1 stops at the first failure; TIMINGS=1 prints how long each check took.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// The step 25 world first: it hands zustand its small React when zustand first loads, which the Journal check needs.
const J = require("../journal-data/world.cjs");
const W = require("./world.cjs");

const REPO = process.env.GRACEHUSH_REPO;
let passed = 0;
const failures = [];
const output = []; // everything the app wrote to the console during the current check
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => void output.push(args.map(String).join(" "));
}
let running = null;
let finished = false;
let stopped = false;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20_000;
process.on("exit", () => {
  if (finished) return;
  fs.writeSync(1, `${passed} passed, stopped while running: ${running}${String.fromCharCode(10)}`);
  process.exitCode = 1;
});

// What must never reach the development log: a headline, an affirmation's words, an entry id, a user id or its hash, an
// identifier or a time.
const FORBIDDEN_IN_LOGS = ["You are held", "longer words", "entry-", "user_a", "user_b", W.sha16("user_a"), "aff-", "2026"];

async function test(name, fn) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  output.length = 0;
  running = name;
  let limit;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished: a promise was never settled")), CHECK_LIMIT_MS);
      }),
    ]);
    for (const line of output) {
      for (const word of FORBIDDEN_IN_LOGS) assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    W.uninstallClock();
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const HASH_A = W.sha16("user_a");
const HASH_B = W.sha16("user_b");
// Wednesday 28 October 2026, 06:00 in New York (EDT, UTC-4). New York's clocks go back on Sunday 1 November.
const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const REMINDERS = { morning: "08:00", afternoon: "13:00", evening: "20:00" };

// The wall clock of `zone` at an instant, written independently of the app's code.
function wallOf(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function zoned() {
  return W.world().use("@/utils/zonedTime");
}
function planner() {
  return W.world().use("@/services/affirmationPlanner");
}

function source(entryId = "entry-1", headlines) {
  return { entryId, affirmations: W.affirmationsFor(entryId, headlines) };
}

// The Word Deck is pure and has no clock of its own: one copy serves every check.
let deckCache = null;
function deck() {
  deckCache ??= W.world().use("@/utils/wordDeck");
  return deckCache;
}

// One reflection of the pool, from the old shape ({ entryId, affirmations }): its words as the app deals them.
function reflectionOf(src, tier = "week") {
  return { entryId: src.entryId, tier, words: deck().deckWordsOf(src.affirmations) };
}

// A reflection with headlines of its own, so a notification says which reflection and which word it came from.
function made(entryId, tier = "week") {
  return reflectionOf(
    source(entryId, { morning: `${entryId} morning`, afternoon: `${entryId} afternoon`, evening: `${entryId} evening` }),
    tier,
  );
}

// What dealWords gives for a pool: the old plan checks pass `source`, the new ones `reflections` and a `history`.
function dealFor(overrides = {}) {
  const { source: src = source(), reflections, history = [], now = new Date(T0), timeZone = "America/New_York", days, reminders } = overrides;
  return deck().dealWords({
    now,
    timeZone,
    reminders: reminders ?? { ...REMINDERS },
    reflections: reflections ?? (src === null ? [] : [reflectionOf(src)]),
    history,
    ...(days === undefined ? {} : { days }),
  });
}

function planInput(overrides = {}) {
  const { enabled = true, permission = "granted", userHash = HASH_A } = overrides;
  return { enabled, permission, deal: dealFor(overrides), userHash };
}

const planned = (w) => w.notifications.ours().filter((id) => /^aff-(morning|afternoon|evening)-/.test(id));
const scheduledAt = (w, id) => w.notifications.scheduled.get(id).at;

async function signedIn(options = {}) {
  const w = W.world(options);
  W.clock.now = options.now ?? T0;
  await w.signIn(options.userId ?? "user_a", options);
  return w;
}

// ================================================================== zoned time
async function zoneChecks() {
  await test("zone: a reminder time is the instant the local clock shows it, in zones east and west of UTC and half-hour ones", async () => {
    const z = zoned();
    const day = { year: 2026, month: 10, day: 28 };
    const cases = [
      ["America/New_York", "2026-10-28T12:00:00.000Z"],
      ["Europe/London", "2026-10-28T08:00:00.000Z"],
      ["Asia/Kolkata", "2026-10-28T02:30:00.000Z"],
      ["Pacific/Auckland", "2026-10-27T19:00:00.000Z"],
      ["Africa/Lagos", "2026-10-28T07:00:00.000Z"],
      ["UTC", "2026-10-28T08:00:00.000Z"],
    ];
    for (const [zone, expected] of cases) assert.equal(z.instantAt(day, "08:00", zone).toISOString(), expected, zone);
  });

  await test("zone: a time the spring change skips becomes the first minute after it, and one the autumn change repeats is the first", async () => {
    const z = zoned();
    // New York jumps from 02:00 to 03:00 on 8 March 2026 (07:00Z); London from 01:00 to 02:00 on 29 March (01:00Z).
    assert.equal(z.instantAt({ year: 2026, month: 3, day: 8 }, "02:30", "America/New_York").toISOString(), "2026-03-08T07:00:00.000Z");
    assert.equal(z.instantAt({ year: 2026, month: 3, day: 29 }, "01:30", "Europe/London").toISOString(), "2026-03-29T01:00:00.000Z");
    // New York reads 01:30 twice on 1 November (05:30Z and 06:30Z); London twice on 25 October (00:30Z and 01:30Z).
    assert.equal(z.instantAt({ year: 2026, month: 11, day: 1 }, "01:30", "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
    assert.equal(z.instantAt({ year: 2026, month: 10, day: 25 }, "01:30", "Europe/London").toISOString(), "2026-10-25T00:30:00.000Z");
  });

  await test("zone: every day of 2026 in four zones gives the exact local time, the first of two, or the first minute after a gap", async () => {
    const z = zoned();
    for (const zone of ["America/New_York", "Europe/London", "Pacific/Auckland", "Australia/Lord_Howe"]) {
      for (let offset = 0; offset < 365; offset += 1) {
        const day = z.addDays({ year: 2026, month: 1, day: 1 }, offset);
        const date = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
        for (const time of ["00:30", "01:30", "02:30", "08:00"]) {
          const at = z.instantAt(day, time, zone).getTime();
          const target = `${date} ${time}`;
          const got = wallOf(at, zone);
          if (got === target) {
            // The first time the clock reads it: an hour or half an hour earlier it did not read the same.
            assert.notEqual(wallOf(at - 3_600_000, zone), target, `${zone} ${target} is a second occurrence`);
            assert.notEqual(wallOf(at - 1_800_000, zone), target, `${zone} ${target} is a second occurrence`);
          } else {
            // A gap: the clock jumped over the target here, from before it to after it.
            assert.ok(got > target && wallOf(at - 60_000, zone) < target, `${zone} ${target} gave ${got}`);
          }
        }
      }
    }
  });

  await test("zone: calendar days follow the zone, cross month and year ends and leap days, and a zone that does not exist is known", async () => {
    const z = zoned();
    // 03:00Z on 1 January 2027 is still 31 December in New York and already 1 January in Auckland.
    assert.deepEqual(z.calendarDayIn(new Date(Date.UTC(2027, 0, 1, 3)), "America/New_York"), { year: 2026, month: 12, day: 31 });
    assert.deepEqual(z.calendarDayIn(new Date(Date.UTC(2027, 0, 1, 3)), "Pacific/Auckland"), { year: 2027, month: 1, day: 1 });
    assert.deepEqual(z.addDays({ year: 2026, month: 12, day: 30 }, 3), { year: 2027, month: 1, day: 2 });
    assert.deepEqual(z.addDays({ year: 2028, month: 2, day: 28 }, 1), { year: 2028, month: 2, day: 29 });
    assert.deepEqual(z.addDays({ year: 2026, month: 3, day: 1 }, -1), { year: 2026, month: 2, day: 28 });
    assert.equal(z.isTimeZone("America/New_York"), true);
    assert.equal(z.isTimeZone("Not/AZone"), false);
  });
}

// ================================================================== the plan
async function planChecks() {
  await test("plan: nothing while the switch is off, the phone will not show it, or no reflection has a word to send", async () => {
    const p = planner();
    assert.equal(p.planAffirmations(planInput({ enabled: false })).length, 0);
    assert.equal(p.planAffirmations(planInput({ permission: "denied" })).length, 0);
    assert.equal(p.planAffirmations(planInput({ permission: "undetermined" })).length, 0);
    assert.equal(p.planAffirmations(planInput({ source: null })).length, 0);
    // A reflection with no affirmations has no word: nothing is dealt from it.
    assert.equal(p.planAffirmations(planInput({ source: { entryId: "entry-2", affirmations: [] } })).length, 0);
    // A heavy moment since 2026-11-08 has its three, written to speak hope: they are planned like any other reflection's.
    assert.equal(p.planAffirmations(planInput({ source: source("entry-2") })).length, 21);
    assert.equal(p.planAffirmations(planInput()).length, 21);
  });

  await test("plan: a blank headline leaves its word out and a reflection with fewer words still fills every reminder; a bad account hash plans nothing", async () => {
    const p = planner();
    // Two words (the evening one is gone): the 21 reminders are still all planned, from those two, and never the missing one.
    const two = source();
    two.affirmations = two.affirmations.filter((item) => item.slot !== "evening");
    const fromTwo = p.planAffirmations(planInput({ source: two }));
    assert.equal(fromTwo.length, 21);
    assert.deepEqual([...new Set(fromTwo.map((item) => item.body))].sort(), ["You are held this afternoon", "You are held this morning"]);
    // A blank headline is no word: the other two go on.
    const blank = p.planAffirmations(planInput({ source: source("entry-1", { afternoon: "   " }) }));
    assert.equal(blank.length, 21);
    assert.ok(blank.every((item) => item.body.trim() !== "" && item.body !== "You are held this afternoon"));
    // Three blank headlines leave nothing to send.
    assert.equal(p.planAffirmations(planInput({ source: source("entry-1", { morning: " ", afternoon: " ", evening: " " }) })).length, 0);
    assert.equal(p.planAffirmations(planInput({ userHash: "user_a" })).length, 0);
  });

  await test("plan: a fresh morning gives 21 notifications over 7 days at the reminder times, newest last, under iOS's 64", async () => {
    const p = planner();
    const plan = p.planAffirmations(planInput());
    assert.equal(plan.length, 21);
    assert.ok(plan.length < 64);
    for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].fireAt > plan[i - 1].fireAt, "sorted by time");
    assert.equal(plan[0].fireAt.toISOString(), "2026-10-28T12:00:00.000Z");
    const walls = plan.map((item) => wallOf(item.fireAt.getTime(), "America/New_York"));
    assert.equal(walls[0], "2026-10-28 08:00");
    assert.equal(walls[20], "2026-11-03 20:00");
    // Across New York's autumn change (1 November) every one is still at its local time.
    for (const [i, item] of plan.entries()) assert.equal(walls[i].slice(11), REMINDERS[item.data.slot]);
    assert.equal(new Set(plan.map((item) => item.identifier)).size, 21);
    for (const item of plan) assert.ok(p.isPlannedAffirmationId(item.identifier), item.identifier);
    // Reminder times out of slot order are still planned soonest first (the test notification copies the first).
    const late = p.planAffirmations(planInput({ reminders: { morning: "21:30", afternoon: "13:00", evening: "07:00" } }));
    for (let i = 1; i < late.length; i += 1) assert.ok(late[i].fireAt > late[i - 1].fireAt, "sorted by time");
  });

  await test("plan: the title names the slot and the body is the headline alone, never the affirmation's words; the tap knows the entry", async () => {
    const p = planner();
    const plan = p.planAffirmations(planInput());
    const first = plan.slice(0, 3);
    assert.deepEqual(first.map((item) => item.title), ["Morning affirmation", "Afternoon affirmation", "Evening affirmation"]);
    assert.deepEqual(first.map((item) => item.body), ["You are held this morning", "You are held this afternoon", "You are held this evening"]);
    for (const item of plan) {
      assert.ok(!JSON.stringify(item).includes("longer words"), "the affirmation's text never goes into a notification");
      assert.deepEqual(item.data, { kind: "affirmation", entryId: "entry-1", slot: item.data.slot, userHash: HASH_A });
    }
  });

  await test("plan: a time that has passed today is left out, and so is a time that is now", async () => {
    const p = planner();
    // 14:00 in New York: today's morning and afternoon have passed.
    assert.equal(p.planAffirmations(planInput({ now: new Date(Date.UTC(2026, 9, 28, 18, 0)) })).length, 19);
    // Exactly 08:00: the morning one is not planned (it would be now).
    assert.equal(p.planAffirmations(planInput({ now: new Date(Date.UTC(2026, 9, 28, 12, 0)) })).length, 20);
    assert.equal(p.planAffirmations(planInput({ days: 1 })).length, 3);
  });

  await test("plan: the same input gives the same identifiers, and each change changes exactly the identifiers it touches", async () => {
    const p = planner();
    const base = p.planAffirmations(planInput()).map((item) => item.identifier);
    assert.deepEqual(p.planAffirmations(planInput()).map((item) => item.identifier), base);
    const ids = (input) => p.planAffirmations(planInput(input)).map((item) => item.identifier);
    const changed = (other) => other.filter((id) => !base.includes(id)).length;
    // A new morning time: the 7 morning notifications change and the 14 others stay.
    const morning = ids({ reminders: { ...REMINDERS, morning: "07:30" } });
    assert.equal(changed(morning), 7);
    assert.ok(morning.filter((id) => !base.includes(id)).every((id) => id.startsWith("aff-morning-")));
    // A new afternoon headline: the 7 afternoon notifications change.
    assert.equal(changed(ids({ source: source("entry-1", { afternoon: "Peace at noon" }) })), 7);
    // Another reflection, another account or another time zone: all 21.
    assert.equal(changed(ids({ source: source("entry-2") })), 21);
    assert.equal(changed(ids({ userHash: HASH_B })), 21);
    assert.equal(changed(ids({ timeZone: "America/Chicago" })), 21);
  });

  await test("plan: a reminder the spring change skips fires at the first minute after it, a repeated one at its first time", async () => {
    const p = planner();
    // Saturday 7 March 2026, 06:00 in New York: Sunday's 02:30 does not exist and becomes 03:00.
    const spring = p.planAffirmations(planInput({ now: new Date(Date.UTC(2026, 2, 7, 11)), reminders: { ...REMINDERS, morning: "02:30" } }));
    const sunday = spring.find((item) => item.identifier.startsWith("aff-morning-20260308-0230-"));
    assert.equal(sunday.fireAt.toISOString(), "2026-03-08T07:00:00.000Z");
    // Saturday 31 October: Sunday's 01:30 happens twice and fires at the first (05:30Z, still EDT).
    const autumn = p.planAffirmations(planInput({ now: new Date(Date.UTC(2026, 9, 31, 10)), reminders: { ...REMINDERS, morning: "01:30" } }));
    assert.equal(autumn.find((item) => item.identifier.startsWith("aff-morning-20261101-0130-")).fireAt.toISOString(), "2026-11-01T05:30:00.000Z");
  });

  await test("plan: a zone the phone does not know is read as UTC, and a malformed reminder time leaves its slot out", async () => {
    const p = planner();
    const utc = p.planAffirmations(planInput({ timeZone: "Not/AZone" }));
    assert.equal(utc[0].fireAt.toISOString(), "2026-10-28T13:00:00.000Z"); // 08:00 UTC has passed at 10:00Z: 13:00 is first
    const odd = p.planAffirmations(planInput({ reminders: { ...REMINDERS, evening: "8:00" } }));
    assert.equal(odd.length, 14);
    assert.ok(odd.every((item) => item.data.slot !== "evening"));
  });

  await test("plan: tap data is read back only when it is ours, Expo Go's own keys included, and identifiers are told apart", async () => {
    const p = planner();
    const ours = { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: HASH_A };
    assert.deepEqual(p.readTapData({ ...ours, experienceId: "@x/gracehush", scopeKey: "@x/gracehush" }), ours);
    for (const bad of [null, "x", {}, { ...ours, kind: "other" }, { ...ours, slot: "midday" }, { ...ours, entryId: "" }, { ...ours, userHash: "user_a" }]) {
      assert.equal(p.readTapData(bad), null, JSON.stringify(bad));
    }
    assert.equal(p.isPlannedAffirmationId(p.planAffirmations(planInput())[0].identifier), true);
    assert.equal(p.isPlannedAffirmationId(p.testAffirmationId(T0)), false);
    assert.ok(p.testAffirmationId(T0).startsWith(p.AFFIRMATION_ID_PREFIX));
    assert.equal(p.isPlannedAffirmationId("daily-reminder"), false);
  });

  // Step 37: an affirmation with a verse is its headline in bold over the verse and its reference.
  const VERSES = {
    morning: { reference: "Psalm 46:1", text: "God is our refuge and strength,\nan ever-present help in times of trouble." },
    afternoon: {
      reference: "Psalm 46:10",
      text: "“Be still and know that I am God;\nI will be exalted among the nations,\nI will be exalted over the earth.”",
    },
    evening: { reference: "Psalm 23:1", text: "The LORD is my shepherd;\nI shall not want." },
  };
  const versed = (slots = ["morning", "afternoon", "evening"]) => ({
    entryId: "entry-1",
    affirmations: W.affirmationsFor("entry-1").map((item) => ({ ...item, verse: slots.includes(item.slot) ? VERSES[item.slot] : null })),
  });

  await test("plan (step 37): with a verse the headline is the title and the body is the verse as one line, quoted, with its reference", async () => {
    const p = planner();
    const first = p.planAffirmations(planInput({ source: versed() })).slice(0, 3);
    assert.deepEqual(first.map((item) => item.title), ["You are held this morning", "You are held this afternoon", "You are held this evening"]);
    assert.deepEqual(first.map((item) => item.body), [
      "“God is our refuge and strength, an ever-present help in times of trouble.” — Psalm 46:1 BSB",
      // A verse that is already a speech keeps its own marks: never doubled.
      "“Be still and know that I am God; I will be exalted among the nations, I will be exalted over the earth.” — Psalm 46:10 BSB",
      "“The LORD is my shepherd; I shall not want.” — Psalm 23:1 BSB",
    ]);
    // A line that ends in an em dash joins the next with none, as the BSB closes its dashes.
    const dashed = versed(["morning"]);
    dashed.affirmations[0].verse = {
      reference: "Psalm 27:1",
      text: "The LORD is my light and my salvation—\nwhom shall I fear?\nThe LORD is the stronghold of my life—\nwhom shall I dread?",
    };
    assert.equal(
      p.planAffirmations(planInput({ source: dashed }))[0].body,
      "“The LORD is my light and my salvation—whom shall I fear? The LORD is the stronghold of my life—whom shall I dread?” — Psalm 27:1 BSB",
    );
    for (const item of p.planAffirmations(planInput({ source: versed() }))) {
      assert.ok(!item.body.includes("\n") && !item.title.includes("\n"), "one line each");
      assert.ok(!JSON.stringify(item).includes("longer words"), "the affirmation's text never goes into a notification");
      assert.deepEqual(item.data, { kind: "affirmation", entryId: "entry-1", slot: item.data.slot, userHash: HASH_A });
    }
  });

  await test("plan (step 37): an affirmation without a verse keeps the older form, and a verse changes the identifiers", async () => {
    const p = planner();
    const mixed = p.planAffirmations(planInput({ source: versed(["morning", "evening"]) })).slice(0, 3);
    assert.deepEqual(mixed.map((item) => item.title), ["You are held this morning", "Afternoon affirmation", "You are held this evening"]);
    assert.equal(mixed[1].body, "You are held this afternoon");
    // A half verse, or an empty one, is no verse.
    const half = versed();
    half.affirmations[0].verse = { reference: "Psalm 46:1", text: "   " };
    assert.equal(p.planAffirmations(planInput({ source: half }))[0].title, "Morning affirmation");
    // The verse is part of what an identifier hashes, so a reflection that gains its verses replaces its notifications.
    const plain = p.planAffirmations(planInput()).map((item) => item.identifier);
    const withVerses = p.planAffirmations(planInput({ source: versed() })).map((item) => item.identifier);
    assert.equal(withVerses.filter((id) => plain.includes(id)).length, 0);
    assert.ok(withVerses.every((id) => p.isPlannedAffirmationId(id)));
  });

  await test("mock data (step 37): the sample affirmations' verses are the Berean Standard Bible's own words", async () => {
    const w = W.world();
    const { ANXIOUS_ENTRY_ID } = w.use("@/data/mock/entries");
    const rows = w.use("@/data/mock/affirmations").buildAffirmations([
      { id: ANXIOUS_ENTRY_ID, user_id: "user_mock", created_at: "2026-10-27T08:00:00.000Z" },
    ]);
    assert.equal(rows.length, 3);
    const books = { Psalm: "PSA", Philippians: "PHP" };
    const root = REPO ?? path.resolve(__dirname, "..", "..", "..");
    // The onboarding sample (copy.onboarding.rhythm.sample) is checked the same way.
    const sample = w.use("@/constants/copy").copy.onboarding.rhythm.sample;
    rows.push({ headline: sample.headline, verse_reference: sample.verse.reference, verse_text: sample.verse.text });
    for (const row of rows) {
      const match = /^(Psalm|Philippians) (\d+):(\d+)$/.exec(row.verse_reference);
      assert.ok(match, row.verse_reference);
      const file = path.join(root, "supabase", "functions", "_shared", "bible", "fixtures", `${books[match[1]]}_${match[2]}.simple.json`);
      const chapter = JSON.parse(fs.readFileSync(file, "utf8"));
      const verse = chapter.chapter.content.find((item) => item.type === "verse" && item.number === Number(match[3]));
      assert.equal(row.verse_text, verse.text.trim(), row.verse_reference);
      assert.ok(row.headline.length <= 38, row.headline);
    }
  });
}

// ================================================================== the Word Deck
async function deckChecks() {
  const walls = (deal) => deal.map((item) => wallOf(item.fireAt.getTime(), "America/New_York"));
  const entriesOf = (deal) => deal.map((item) => item.word.entryId);
  const wordsOf = (deal) => deal.map((item) => item.word.id);
  const rowsOf = (deal) => deal.map((item) => deck().toHistoryRow(item));
  const H = 3_600_000;
  const DAY = 24 * H;

  await test("deck: a lone reflection with its three best words is the old plan exactly: each reminder carries its own slot's word, for 21 reminders", async () => {
    const deal = dealFor();
    assert.equal(deal.length, 21);
    assert.equal(walls(deal)[0], "2026-10-28 08:00");
    assert.equal(walls(deal)[20], "2026-11-03 20:00");
    for (const item of deal) {
      assert.equal(item.word.entryId, "entry-1");
      assert.equal(item.word.slot, item.slot, "its own slot's word");
      assert.equal(item.word.id, `entry-1-${item.slot}`);
    }
    for (let i = 1; i < deal.length; i += 1) assert.ok(deal[i].fireAt > deal[i - 1].fireAt, "in time order");
  });

  await test("deck: the reflections of the week take turns newest first, three a day, and each word of a reflection is heard before one repeats", async () => {
    const deal = dealFor({ reflections: [made("entry-a"), made("entry-b"), made("entry-c")] });
    assert.equal(deal.length, 21);
    assert.deepEqual(entriesOf(deal).slice(0, 6), ["entry-a", "entry-b", "entry-c", "entry-a", "entry-b", "entry-c"]);
    for (const id of ["entry-a", "entry-b", "entry-c"]) {
      const mine = deal.filter((item) => item.word.entryId === id);
      assert.equal(mine.length, 7);
      // Inside a reflection the words cycle: any three turns in a row are three different words.
      const ids = mine.map((item) => item.word.id);
      for (let i = 0; i + 3 <= ids.length; i += 3) assert.equal(new Set(ids.slice(i, i + 3)).size, 3, `${id} ${ids.slice(i, i + 3)}`);
    }
    // The first turn of the first reflection is its morning word, because it is a morning reminder.
    assert.equal(deal[0].word.id, "entry-a-morning");
    assert.equal(deal[1].word.id, "entry-b-afternoon");
    assert.equal(deal[2].word.id, "entry-c-evening");
  });

  await test("deck: a word is never dealt twice in a row, and no reflection has two turns running, whatever the size of the week", async () => {
    for (const size of [2, 3, 4, 7, 14]) {
      const pool = Array.from({ length: size }, (_, i) => made(`entry-${String.fromCharCode(97 + i)}`));
      const deal = dealFor({ reflections: pool });
      for (let i = 1; i < deal.length; i += 1) {
        assert.notEqual(deal[i].word.entryId, deal[i - 1].word.entryId, `${size} reflections, reminder ${i}`);
        assert.notEqual(deal[i].word.id, deal[i - 1].word.id);
      }
    }
    // A week of seven reflections gives each of them three turns in 21 reminders and no word twice.
    const seven = dealFor({ reflections: Array.from({ length: 7 }, (_, i) => made(`entry-${i}`)) });
    for (let i = 0; i < 7; i += 1) assert.equal(seven.filter((item) => item.word.entryId === `entry-${i}`).length, 3);
    assert.equal(new Set(wordsOf(seven)).size, 21, "a week of seven reflections hears 21 different words");
  });

  await test("deck: a new reflection plays at the very next reminder, and the others keep their places in line", async () => {
    // Yesterday A played in the morning and evening, B in the afternoon.
    const at = (day, hour) => Date.UTC(2026, 9, day, hour);
    const history = [
      { day: 20261027, slot: "morning", fireAt: at(27, 12), entryId: "entry-a", affirmationId: "entry-a-morning" },
      { day: 20261027, slot: "afternoon", fireAt: at(27, 17), entryId: "entry-b", affirmationId: "entry-b-afternoon" },
      { day: 20261027, slot: "evening", fireAt: at(28, 0), entryId: "entry-a", affirmationId: "entry-a-evening" },
    ];
    const before = dealFor({ reflections: [made("entry-a"), made("entry-b")], history });
    assert.deepEqual(entriesOf(before).slice(0, 4), ["entry-b", "entry-a", "entry-b", "entry-a"], "B has waited longest");
    const after = dealFor({ reflections: [made("entry-n"), made("entry-a"), made("entry-b")], history });
    assert.deepEqual(entriesOf(after).slice(0, 4), ["entry-n", "entry-b", "entry-a", "entry-n"]);
    assert.equal(after[0].word.id, "entry-n-morning");
  });

  await test("deck: the rotation goes on across days from what the calendar says was sent, and a plan made again with nothing new gives the same words", async () => {
    const pool = [made("entry-a"), made("entry-b"), made("entry-c")];
    const first = dealFor({ reflections: pool });
    // Two days later: the reminders that have passed are the history.
    const later = T0 + 2 * DAY;
    const history = rowsOf(first).filter((row) => row.fireAt <= later);
    assert.equal(history.length, 6);
    const second = dealFor({ reflections: pool, history, now: new Date(later) });
    for (const item of second) {
      const same = first.find((candidate) => candidate.fireAt.getTime() === item.fireAt.getTime());
      if (same !== undefined) assert.equal(item.word.id, same.word.id, `${wallOf(item.fireAt.getTime(), "America/New_York")}`);
    }
    assert.ok(second.length > 0 && second.length <= 21);
    // The same deal again: byte for byte the same.
    assert.deepEqual(rowsOf(dealFor({ reflections: pool, history, now: new Date(later) })), rowsOf(second));
    // A reminder the calendar says already fired is never dealt again; rows ahead of now are ignored (they are dealt afresh).
    const ahead = rowsOf(first).map((row) => ({ ...row, entryId: "entry-c", affirmationId: "entry-c-evening" }));
    const ignored = dealFor({ reflections: pool, history: ahead.filter((row) => row.fireAt > T0), now: new Date(T0) });
    assert.deepEqual(rowsOf(ignored), rowsOf(first), "history from the future changes nothing");
  });

  await test("deck: the best three are heard first, then the words the person added in the order they were made; a slot's own word is the tie-break", async () => {
    const extras = [4, 5].map((position) => ({
      ...W.affirmationsFor("entry-1")[0],
      id: `entry-1-extra-${position}`,
      slot: null,
      position,
      headline: `An added word ${position}`,
    }));
    // The order of the array is not the order the words are dealt: the extras come first here, and one best word is out of place.
    const base = W.affirmationsFor("entry-1");
    const reflection = reflectionOf({ entryId: "entry-1", affirmations: [...extras.reverse(), base[2], base[0], base[1]] });
    assert.deepEqual(reflection.words.map((word) => word.id), [
      "entry-1-morning",
      "entry-1-afternoon",
      "entry-1-evening",
      "entry-1-extra-4",
      "entry-1-extra-5",
    ]);
    const deal = dealFor({ reflections: [reflection] });
    assert.deepEqual(wordsOf(deal).slice(0, 8), [
      "entry-1-morning",
      "entry-1-afternoon",
      "entry-1-evening",
      "entry-1-extra-4",
      "entry-1-extra-5",
      "entry-1-morning",
      "entry-1-afternoon",
      "entry-1-evening",
    ]);
    // Never dealt, a word of the part of the day comes first: an evening reminder whose reflection has not been heard picks its
    // evening word, a morning reminder its morning word, whatever the order (a reminder time that moves the order of the day).
    const odd = dealFor({ reflections: [reflection], reminders: { morning: "21:30", afternoon: "13:00", evening: "07:00" } });
    assert.deepEqual(odd.slice(0, 3).map((item) => [item.slot, item.word.slot]), [["evening", "evening"], ["afternoon", "afternoon"], ["morning", "morning"]]);
  });

  await test("deck: the week and its top-up: seven reflections in all when the week has fewer, the week's before older ones, at most fourteen from the week", async () => {
    const d = deck();
    const mk = (id, iso) => ({ id, createdAt: iso });
    const now = new Date(T0); // Wednesday 28 October, 06:00 in New York: the week is 22 to 28 October there
    const entries = [
      mk("e1", "2026-10-28T08:00:00.000Z"),
      mk("e2", "2026-10-26T15:00:00.000Z"),
      mk("e3", "2026-10-22T05:00:00.000Z"), // 01:00 on the 22nd in New York: the first day of the week
      mk("e4", "2026-10-22T03:00:00.000Z"), // 23:00 on the 21st: one day too old
      mk("e5", "2026-10-15T12:00:00.000Z"),
      mk("e6", "2026-10-10T12:00:00.000Z"),
      mk("e7", "2026-10-05T12:00:00.000Z"),
      mk("e8", "2026-10-01T12:00:00.000Z"),
      mk("e9", "2026-09-20T12:00:00.000Z"),
    ];
    const picked = d.selectPoolEntries(entries, now, "America/New_York");
    assert.deepEqual(picked.map((item) => [item.entry.id, item.tier]), [
      ["e1", "week"], ["e2", "week"], ["e3", "week"], ["e4", "older"], ["e5", "older"], ["e6", "older"], ["e7", "older"],
    ]);
    // The same instants in UTC: the 22nd at 03:00 is already in the week.
    assert.deepEqual(d.selectPoolEntries(entries, now, "UTC").map((item) => item.entry.id), ["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    assert.equal(d.selectPoolEntries(entries, now, "UTC").filter((item) => item.tier === "week").length, 4);
    // A week with seven or more reflections takes no older one; with more than fourteen only the newest fourteen.
    const many = Array.from({ length: 20 }, (_, i) => mk(`m${i}`, "2026-10-27T12:00:00.000Z"));
    assert.deepEqual(d.selectPoolEntries(many.slice(0, 9), now, "America/New_York").map((item) => item.tier), Array(9).fill("week"));
    const capped = d.selectPoolEntries(many, now, "America/New_York");
    assert.equal(capped.length, 14);
    assert.deepEqual(capped.map((item) => item.entry.id), many.slice(0, 14).map((item) => item.id));
    // A time that cannot be read is not this week's, and a zone that does not exist is read as UTC.
    assert.equal(d.selectPoolEntries([mk("x", "not a date")], now, "America/New_York")[0].tier, "older");
    assert.equal(d.selectPoolEntries([mk("y", "2026-10-28T08:00:00.000Z")], now, "Not/AZone")[0].tier, "week");
    assert.deepEqual(d.selectPoolEntries([], now, "UTC"), []);
  });

  await test("deck: a never-played older reflection waits behind a never-played one of this week", async () => {
    const deal = dealFor({ reflections: [made("entry-w"), made("entry-o", "older")] });
    assert.deepEqual(entriesOf(deal).slice(0, 4), ["entry-w", "entry-o", "entry-w", "entry-o"]);
    const flipped = dealFor({ reflections: [made("entry-o", "older"), made("entry-w")] });
    assert.equal(flipped[0].word.entryId, "entry-w", "the tier decides before the order of the list");
  });

  await test("deck: a word is only its headline and verse; blank headlines and half verses are cleaned, and a reflection with no word is skipped", async () => {
    const base = W.affirmationsFor("entry-1");
    const words = deck().deckWordsOf([
      { ...base[0], headline: "   " },
      { ...base[1], verse: { reference: "  ", text: "x" } },
      { ...base[2], headline: "  Rest  ", verse: { reference: " Psalm 4:8 ", text: "In peace" } },
    ]);
    assert.deepEqual(words.map((word) => word.id), ["entry-1-afternoon", "entry-1-evening"]);
    assert.equal(words[0].verse, null);
    assert.deepEqual(words[1].verse, { reference: "Psalm 4:8", text: "In peace" });
    assert.equal(words[1].headline, "Rest");
    for (const word of words) assert.deepEqual(Object.keys(word).sort(), ["entryId", "headline", "id", "slot", "verse"], "nothing of the person's words");
    const skipped = dealFor({ reflections: [{ entryId: "empty", tier: "week", words: [] }, made("entry-a")] });
    assert.ok(entriesOf(skipped).every((id) => id === "entry-a"));
    assert.deepEqual(dealFor({ reflections: [{ entryId: "empty", tier: "week", words: [] }] }), []);
  });

  await test("deck: a word without a verse is titled by the slot it is delivered at, and its tap opens its own reflection", async () => {
    const p = planner();
    // A holds only a morning word, with no verse, and B only an evening one: A's word reaches the evening reminder too.
    const a = reflectionOf({ entryId: "entry-a", affirmations: W.affirmationsFor("entry-a").filter((item) => item.slot === "morning") });
    const b = reflectionOf({ entryId: "entry-b", affirmations: W.affirmationsFor("entry-b").filter((item) => item.slot === "evening") });
    const plan = p.planAffirmations({ enabled: true, permission: "granted", deal: dealFor({ reflections: [a, b] }), userHash: HASH_A });
    const first = plan.slice(0, 3);
    assert.deepEqual(first.map((item) => item.data.entryId), ["entry-a", "entry-b", "entry-a"]);
    assert.deepEqual(first.map((item) => item.title), ["Morning affirmation", "Afternoon affirmation", "Evening affirmation"]);
    assert.deepEqual(first.map((item) => item.data.slot), ["morning", "afternoon", "evening"], "the slot it is delivered at");
    assert.deepEqual(first.map((item) => item.body), ["You are held this morning", "You are held this evening", "You are held this morning"]);
    // The identifier follows the slot of the delivery, so a word dealt to another slot is another notification.
    assert.ok(first[2].identifier.startsWith("aff-evening-"));
  });

  await test("deck: rows for the calendar are the whole deal: one per reminder, the slot it is delivered at, the entry and the word", async () => {
    const deal = dealFor({ reflections: [made("entry-a"), made("entry-b")] });
    const rows = rowsOf(deal);
    assert.equal(rows.length, 21);
    assert.equal(new Set(rows.map((row) => `${row.day}-${row.slot}`)).size, 21, "one row for each day and slot");
    assert.deepEqual(rows[0], { day: 20261028, slot: "morning", fireAt: Date.UTC(2026, 9, 28, 12), entryId: "entry-a", affirmationId: "entry-a-morning" });
    assert.deepEqual(Object.keys(rows[0]).sort(), ["affirmationId", "day", "entryId", "fireAt", "slot"]);
  });
}

// ================================================================== the scheduler
async function scheduleChecks() {
  // A reflection of the week as the repository's fake takes it: its affirmations carry headlines of their own.
  const pooled = (id, tier = "week") => ({
    entryId: id,
    tier,
    affirmations: W.affirmationsFor(id, { morning: `${id} morning`, afternoon: `${id} afternoon`, evening: `${id} evening` }),
  });
  const bodies = (w) =>
    planned(w)
      .map((id) => ({ at: scheduledAt(w, id), content: w.notifications.scheduled.get(id).content }))
      .sort((a, b) => a.at - b.at);
  async function withWeek(reflections, options = {}) {
    const w = W.world(options);
    W.clock.now = options.now ?? T0;
    w.repository.state.reflections = reflections;
    await w.signIn(options.userId ?? "user_a", options);
    return w;
  }

  await test("schedule (Word Deck): the reflections of the week take turns on the lock screen, and the notification carries its own reflection's id", async () => {
    const w = await withWeek([pooled("entry-a"), pooled("entry-b"), pooled("entry-c")]);
    const list = bodies(w);
    assert.equal(list.length, 21);
    assert.deepEqual(list.slice(0, 6).map((item) => item.content.data.entryId), ["entry-a", "entry-b", "entry-c", "entry-a", "entry-b", "entry-c"]);
    assert.deepEqual(list.slice(0, 3).map((item) => item.content.body), ["entry-a morning", "entry-b afternoon", "entry-c evening"]);
    assert.deepEqual(list.slice(0, 3).map((item) => item.content.title), ["Morning affirmation", "Afternoon affirmation", "Evening affirmation"]);
    // The calendar holds the deal, one row for each reminder.
    assert.equal(w.repository.state.calendar.length, 21);
    assert.deepEqual(w.repository.state.calendar.slice(0, 3).map((row) => row.entryId), ["entry-a", "entry-b", "entry-c"]);
  });

  await test("schedule (Word Deck): a new reflection plays at the next reminder, and the rest of the week is dealt around it", async () => {
    const w = await withWeek([pooled("entry-a"), pooled("entry-b")]);
    w.repository.state.reflections = [pooled("entry-n"), pooled("entry-a"), pooled("entry-b")];
    w.sync.finished("entry-n");
    await W.advance(1_000);
    const list = bodies(w);
    assert.equal(list.length, 21);
    assert.equal(list[0].content.data.entryId, "entry-n");
    assert.equal(list[0].content.body, "entry-n morning");
    assert.deepEqual(list.slice(0, 4).map((item) => item.content.data.entryId), ["entry-n", "entry-a", "entry-b", "entry-n"]);
    // What was waiting before is replaced, never doubled.
    assert.equal(planned(w).length, 21);
  });

  await test("schedule (Word Deck): a day later the rotation goes on from what the calendar says arrived, and nothing already scheduled is touched", async () => {
    const w = await withWeek([pooled("entry-a"), pooled("entry-b"), pooled("entry-c")]);
    W.clock.now = T0 + 86_400_000;
    w.notifications.deliverDue();
    assert.equal(w.notifications.presented.length, 3);
    const scheduledBefore = w.notifications.calls.schedule.length;
    w.appState.emit("active");
    await W.advance(1_000);
    // Yesterday's three reminders are history in the calendar; today's first goes to A again, with the word A has not yet played.
    const history = w.repository.state.calendar.filter((row) => row.fireAt <= W.clock.now);
    assert.deepEqual(history.map((row) => row.entryId), ["entry-a", "entry-b", "entry-c"]);
    const list = bodies(w);
    assert.equal(list.length, 21);
    assert.equal(list[0].content.data.entryId, "entry-a");
    assert.equal(list[0].content.body, "entry-a afternoon");
    assert.equal(w.notifications.calls.schedule.length - scheduledBefore, 3, "only the new day's three");
    assert.equal(w.notifications.calls.cancel.length, 0, "the deal did not change what was already planned");
  });

  await test("schedule (Word Deck): a reflection that is deleted leaves the week, and the others fill its turns at the next plan", async () => {
    const w = await withWeek([pooled("entry-a"), pooled("entry-b"), pooled("entry-c")]);
    w.repository.state.reflections = [pooled("entry-a"), pooled("entry-c")];
    w.scheduler().requestAffirmationReschedule();
    await W.advance(1_000);
    const list = bodies(w);
    assert.equal(list.length, 21);
    assert.ok(list.every((item) => item.content.data.entryId !== "entry-b"));
    assert.deepEqual(list.slice(0, 4).map((item) => item.content.data.entryId), ["entry-a", "entry-c", "entry-a", "entry-c"]);
    assert.ok(w.repository.state.calendar.every((row) => row.entryId !== "entry-b"), "its rows ahead went from the calendar");
  });

  await test("schedule (Word Deck): the calendar is written whatever the notifications do: switch off, no permission, or a build with none; an unknown switch writes nothing", async () => {
    const off = await withWeek([pooled("entry-a"), pooled("entry-b")]);
    off.stores().prefs.getState().saveUnsent("user_a", { affirmationsEnabled: false });
    await W.advance(1_000);
    assert.equal(planned(off).length, 0);
    assert.equal(off.repository.state.calendar.length, 21, "Today's card still has its word of the day");
    const denied = await withWeek([pooled("entry-a")]);
    denied.notifications.state.permission = { granted: false, status: "denied", canAskAgain: false, ios: { status: 1 } };
    denied.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(denied).length, 0);
    assert.equal(denied.repository.state.calendar.length, 21);
    // The profile has never been read on this phone: nothing is dealt, nothing is written, nothing is cancelled.
    const unknown = W.world();
    W.clock.now = T0;
    await unknown.hydrate();
    unknown.stores().offline.getState().setDatabase("ready");
    unknown.scheduler().startAffirmationSchedule("user_a");
    await W.advance(2_000);
    assert.equal(unknown.repository.state.saves.length, 0);
    assert.equal(unknown.repository.state.calendar.length, 0);
  });

  await test("schedule (Word Deck): a calendar that cannot be written does not stop the notifications, and one that cannot be read changes nothing", async () => {
    const w = W.world();
    W.clock.now = T0;
    w.repository.state.calendarFails = true;
    await w.signIn("user_a");
    assert.equal(planned(w).length, 21);
    assert.ok(output.some((line) => line === "[affirmations] calendar_failed"));
    w.repository.state.calendarFails = false;
    w.repository.state.readFails = true;
    w.repository.state.reflections = [pooled("entry-z")];
    const before = w.notifications.calls.schedule.length;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
    assert.equal(w.notifications.calls.cancel.length, 0);
    assert.equal(w.notifications.calls.schedule.length, before);
  });

  await test("schedule (Word Deck): a reminder time that changes re-deals what is ahead and leaves what has passed in the calendar", async () => {
    const w = await withWeek([pooled("entry-a"), pooled("entry-b")]);
    W.clock.now = T0 + 86_400_000;
    w.notifications.deliverDue();
    w.appState.emit("active");
    await W.advance(1_000);
    const history = w.repository.state.calendar.filter((row) => row.fireAt <= W.clock.now).map((row) => ({ ...row }));
    assert.equal(history.length, 3);
    w.stores().onboarding.getState().setReminder("morning", "07:30");
    await W.advance(1_000);
    assert.deepEqual(w.repository.state.calendar.filter((row) => row.fireAt <= W.clock.now), history, "what already arrived is untouched");
    const mornings = w.repository.state.calendar.filter((row) => row.slot === "morning" && row.fireAt > W.clock.now);
    assert.equal(mornings.length, 7, "Thursday 07:30 is still ahead at six in the morning");
    for (const row of mornings) assert.equal(wallOf(row.fireAt, "America/New_York").slice(11), "07:30");
    assert.equal(planned(w).length, 21);
  });

  await test("schedule (Word Deck): subscribers hear of each deal, and a failing listener does not stop the others or the run", async () => {
    const w = await withWeek([pooled("entry-a")]);
    let heard = 0;
    const stop = w.scheduler().subscribeWordCalendar(() => void (heard += 1));
    const stopBad = w.scheduler().subscribeWordCalendar(() => {
      throw new Error("a listener broke");
    });
    w.scheduler().requestAffirmationReschedule();
    await W.advance(1_000);
    assert.equal(heard, 1);
    stop();
    stopBad();
    w.scheduler().requestAffirmationReschedule();
    await W.advance(1_000);
    assert.equal(heard, 1, "no longer listening");
    assert.equal(planned(w).length, 21);
  });

  for (const platform of ["ios", "android"]) {
    await test(`schedule (${platform}): signing in schedules the week, each a date trigger with its title, headline, sound and channel`, async () => {
      const w = await signedIn({ platform });
      const ids = planned(w);
      assert.equal(ids.length, 21);
      const first = w.notifications.calls.schedule.find((call) => call.identifier === ids.sort()[0]) ?? w.notifications.calls.schedule[0];
      assert.equal(first.trigger.type, "date");
      assert.equal(first.trigger.channelId, "affirmations");
      assert.equal(first.content.sound, "default");
      assert.ok(first.content.title.endsWith(" affirmation"));
      assert.ok(first.content.body.startsWith("You are held this "));
      assert.equal(first.content.data.userHash, HASH_A);
      assert.ok(!JSON.stringify(w.notifications.calls.schedule).includes("longer words"));
      const earliest = Math.min(...ids.map((id) => scheduledAt(w, id)));
      assert.equal(new Date(earliest).toISOString(), "2026-10-28T12:00:00.000Z");
      // Android needs its channel before anything is scheduled; iOS has none.
      if (platform === "android") assert.equal(w.notifications.calls.channels[0]?.id, "affirmations");
      else assert.equal(w.notifications.calls.channels.length, 0);
    });
  }

  await test("schedule: a run that finds nothing changed schedules and cancels nothing", async () => {
    const w = await signedIn();
    const before = w.notifications.calls.schedule.length;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(w.notifications.calls.schedule.length, before);
    assert.equal(w.notifications.calls.cancel.length, 0);
    assert.ok(w.notifications.calls.list >= 2, "it did look");
  });

  await test("schedule: a new reminder time replaces only that slot's seven notifications", async () => {
    const w = await signedIn();
    const before = new Set(planned(w));
    const scheduledBefore = w.notifications.calls.schedule.length;
    w.stores().onboarding.getState().setReminder("morning", "07:30");
    await W.advance(1_000);
    const after = planned(w);
    assert.equal(after.length, 21);
    assert.equal(w.notifications.calls.cancel.length, 7);
    assert.ok(w.notifications.calls.cancel.every((id) => id.startsWith("aff-morning-0800") || id.includes("-0800-")));
    assert.equal(w.notifications.calls.schedule.length - scheduledBefore, 7);
    assert.equal(after.filter((id) => !before.has(id)).length, 7);
    for (const id of after.filter((item) => item.startsWith("aff-morning-"))) assert.equal(wallOf(scheduledAt(w, id), "America/New_York").slice(11), "07:30");
    // The calendar follows: still one row for each reminder, the morning ones at the new time.
    const morning = w.repository.state.calendar.filter((row) => row.slot === "morning");
    assert.equal(w.repository.state.calendar.length, 21);
    assert.equal(morning.length, 7);
    for (const row of morning) assert.equal(wallOf(row.fireAt, "America/New_York").slice(11), "07:30");
  });

  await test("schedule: the Daily Affirmations switch off cancels them all and on brings them back, from Profile or from another phone", async () => {
    const w = await signedIn();
    const prefs = w.stores().prefs;
    prefs.getState().saveUnsent("user_a", { affirmationsEnabled: false });
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
    prefs.getState().saveUnsent("user_a", { affirmationsEnabled: true });
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
    // The server says off (the switch changed on another phone): the profile sync saves its snapshot.
    prefs.getState().clearUnsent("user_a", { affirmationsEnabled: true });
    const snapshot = prefs.getState().byUser.user_a.snapshot;
    prefs.getState().saveSnapshot("user_a", { ...snapshot, affirmationsEnabled: false });
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
  });

  await test("schedule: a permission turned off cancels them at the next foreground, and provisional delivery counts as allowed", async () => {
    const w = await signedIn();
    w.notifications.state.permission = { granted: false, status: "denied", canAskAgain: false, ios: { status: 1 } };
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
    w.notifications.state.permission = { granted: false, status: "granted", canAskAgain: true, ios: { status: 3 } };
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
  });

  await test("schedule: a newest reflection that is a heavy moment saved before 2026-11-08 keeps the app quiet, and the next reflection brings the notifications back with its own headlines", async () => {
    const w = await signedIn();
    // The pool says so: the newest finished reflection has only the person's words (it is a legacy heavy moment).
    w.repository.state.quiet = true;
    w.sync.finished("entry-2", true);
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
    w.repository.state.quiet = false;
    w.repository.state.source = source("entry-3", { morning: "A new morning" });
    w.sync.finished("entry-3");
    await W.advance(1_000);
    const ids = planned(w);
    assert.equal(ids.length, 21);
    assert.ok(ids.every((id) => w.notifications.scheduled.get(id).content.data.entryId === "entry-3"));
    assert.ok(ids.some((id) => w.notifications.scheduled.get(id).content.body === "A new morning"));
  });

  await test("schedule: with no reflection nothing is scheduled; a cache that cannot be read changes nothing", async () => {
    const w = await signedIn();
    w.repository.state.readFails = true;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21, "a bad read never cancels");
    assert.equal(w.notifications.calls.cancel.length, 0);
    w.repository.state.readFails = false;
    w.repository.state.source = null;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
  });

  await test("schedule: nothing happens until the database is open and the profile has been read on this phone, then it plans by itself", async () => {
    const w = W.world();
    W.clock.now = T0;
    await w.hydrate();
    w.scheduler().startAffirmationSchedule("user_a");
    await W.advance(2_000);
    assert.equal(planned(w).length, 0);
    assert.equal(w.notifications.calls.list, 0, "nothing was even listed");
    w.stores().offline.getState().setDatabase("ready");
    await W.advance(1_000);
    assert.equal(planned(w).length, 0, "the profile was never read on this phone");
    assert.equal(w.notifications.calls.list, 0, "an unknown switch changes nothing: it does not even look");
    assert.equal(w.repository.state.saves.length, 0, "and it writes nothing to the calendar either");
    w.stores().prefs.getState().saveSnapshot("user_a", {
      createdAt: "2026-10-01T12:00:00.000Z",
      subscriptionTier: "free",
      syncedAt: new Date(T0).toISOString(),
      affirmationsEnabled: true,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
  });

  await test("schedule: with the profile known but the database not open nothing is looked at; opening it plans by itself", async () => {
    const w = W.world();
    W.clock.now = T0;
    await w.signIn("user_a", { dbReady: false });
    assert.equal(w.notifications.calls.list, 0);
    assert.equal(planned(w).length, 0);
    w.stores().offline.getState().setDatabase("ready");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
  });

  await test("schedule: a new time zone moves every notification to the reminder times of the new zone at the next foreground", async () => {
    const w = await signedIn();
    w.device.zone = "Europe/London";
    w.appState.emit("active");
    await W.advance(1_000);
    const ids = planned(w);
    // 10:00 in London: today's 08:00 has passed.
    assert.equal(ids.length, 20);
    for (const id of ids) {
      const slot = w.notifications.scheduled.get(id).content.data.slot;
      assert.equal(wallOf(scheduledAt(w, id), "Europe/London").slice(11), REMINDERS[slot]);
    }
    assert.equal(w.notifications.calls.cancel.length, 21);
  });

  await test("schedule: a day later the week is refilled at the next foreground, and what was shown is not scheduled again", async () => {
    const w = await signedIn();
    W.clock.now = T0 + 86_400_000;
    w.notifications.deliverDue();
    assert.equal(w.notifications.presented.length, 3);
    const scheduledBefore = w.notifications.calls.schedule.length;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
    assert.equal(w.notifications.calls.schedule.length - scheduledBefore, 3, "only the new day's three");
    assert.equal(w.notifications.calls.cancel.length, 0);
  });

  await test("schedule: one about to fire is kept if it is scheduled and not added if it is not (iOS refuses a time that has passed)", async () => {
    const w = await signedIn();
    W.clock.now = Date.UTC(2026, 9, 28, 11, 59, 55); // 07:59:55 in New York
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21, "the 08:00 one is still there");
    assert.equal(w.notifications.calls.cancel.length, 0);
    const late = await signedIn({ now: Date.UTC(2026, 9, 28, 11, 59, 55) });
    assert.equal(planned(late).length, 20, "5 seconds ahead is too close to schedule");
    assert.ok(!late.notifications.calls.schedule.some((call) => call.identifier.includes("20261028-0800")));
  });

  await test("schedule: requests in the same half second are one run, and a request during a run runs once more after it", async () => {
    const w = await signedIn();
    const lists = w.notifications.calls.list;
    for (let i = 0; i < 5; i += 1) w.scheduler().requestAffirmationReschedule();
    await W.advance(1_000);
    assert.equal(w.notifications.calls.list - lists, 1);
    w.notifications.state.scheduleLagMs = 200;
    w.stores().onboarding.getState().setReminder("evening", "21:00");
    await W.advance(600); // the run has begun and is cancelling and scheduling
    w.stores().onboarding.getState().setReminder("evening", "21:30");
    await W.advance(20_000);
    const evening = planned(w).filter((id) => id.startsWith("aff-evening-"));
    assert.equal(evening.length, 7);
    assert.ok(evening.every((id) => id.includes("-2130-")), "the last time won");
    assert.equal(planned(w).length, 21);
  });

  await test("schedule: one notification that fails to schedule does not stop the others, and the next run adds only that one", async () => {
    const w = W.world();
    W.clock.now = T0;
    const p = w.use("@/services/affirmationPlanner");
    const third = p.planAffirmations(planInput())[2].identifier;
    w.notifications.state.failSchedule.add(third);
    await w.signIn("user_a");
    assert.equal(planned(w).length, 20);
    assert.ok(output.some((line) => line === "[affirmations] schedule_failed"));
    w.notifications.state.failSchedule.clear();
    const before = w.notifications.calls.schedule.length;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 21);
    assert.equal(w.notifications.calls.schedule.length - before, 1);
  });

  await test("schedule: it only ever cancels its own planned notifications: Expo Go's other projects and the test one stay", async () => {
    const others = ["daily-reminder", "aff-test-1"];
    const w = await signedIn({ expoGoOthers: others });
    w.repository.state.source = null;
    w.appState.emit("active");
    await W.advance(1_000);
    assert.equal(planned(w).length, 0);
    for (const id of others) assert.ok(w.notifications.scheduled.has(id), id);
  });

  await test("schedule: in Expo Go on Android, where the module is skipped, nothing is scheduled or cleared and nothing breaks", async () => {
    const w = await signedIn({ platform: "android", expoGo: true });
    assert.equal(planned(w).length, 0);
    assert.equal(w.notifications.calls.list, 0);
    await w.scheduler().clearAffirmations();
    assert.equal(w.notifications.calls.cancel.length, 0);
    // The deal does not need notifications: the calendar, which Today's card reads, was still written.
    assert.equal(w.repository.state.calendar.length, 21);
  });

  await test("schedule: signing out waits for a run in the air, then cancels every notification of ours and clears the notification center", async () => {
    const w = await signedIn({ expoGoOthers: ["daily-reminder"] });
    W.clock.now = T0 + 86_400_000;
    w.notifications.deliverDue();
    w.notifications.presented.push({ request: { identifier: "other-shown", content: {} }, date: T0 });
    await w.scheduler().scheduleTestAffirmation(10_000);
    w.notifications.state.scheduleLagMs = 3_000;
    w.appState.emit("active");
    await W.advance(1_000); // a run is scheduling the new day's three, and its call takes longer than a listing
    await Promise.all([w.scheduler().clearAffirmations(), W.advance(60_000)]);
    assert.deepEqual(w.notifications.ours(), []);
    assert.ok(w.notifications.scheduled.has("daily-reminder"));
    assert.deepEqual(w.notifications.presented.map((item) => item.request.identifier), ["other-shown"]);
    // After sign-out nothing plans any more.
    w.scheduler().requestAffirmationReschedule();
    w.appState.emit("active");
    w.sync.finished("entry-9");
    await W.advance(5_000);
    assert.deepEqual(w.notifications.ours(), []);
    assert.equal(w.sync.count(), 0, "it stopped listening");
  });

  await test("schedule: a session that ends in the middle of a run schedules nothing more after it", async () => {
    const w = W.world();
    W.clock.now = T0;
    w.notifications.state.scheduleLagMs = 100;
    await w.signIn("user_a"); // the run has begun: listed and scheduling one at a time
    const before = w.notifications.calls.schedule.length;
    assert.ok(before > 0 && before < 21, `mid-run: ${before}`);
    w.scheduler().stopAffirmationSchedule();
    await W.advance(10_000);
    assert.ok(w.notifications.calls.schedule.length <= before + 1, "at most the call already in the air");
  });

  await test("schedule: when the session ends without a sign-out nothing is cancelled, and the next account's first plan replaces it", async () => {
    const w = await signedIn();
    const first = planned(w);
    w.scheduler().stopAffirmationSchedule();
    w.appState.emit("active");
    await W.advance(2_000);
    assert.deepEqual(planned(w), first);
    // The next account signs in: its plan waits for its profile, which the profile sync reads right after sign-in.
    w.repository.state.source = source("entry-b");
    w.scheduler().startAffirmationSchedule("user_b");
    await W.advance(1_000);
    assert.deepEqual(planned(w), first, "nothing is planned for an account whose profile was never read");
    await w.signIn("user_b");
    const second = planned(w);
    assert.equal(second.length, 21);
    assert.ok(second.every((id) => !first.includes(id)));
    assert.ok(second.every((id) => w.notifications.scheduled.get(id).content.data.userHash === HASH_B));
  });

  await test("schedule: the developer summary counts them and names the next; the test one fires in 10 s and survives a reschedule", async () => {
    const w = await signedIn();
    assert.deepEqual(await w.scheduler().getAffirmationScheduleSummary(), { count: 21, next: "2026-10-28 08:00" });
    const now = W.clock.now;
    assert.equal(await w.scheduler().scheduleTestAffirmation(10_000), true);
    const test = w.notifications.ours().find((id) => id.startsWith("aff-test-"));
    assert.equal(scheduledAt(w, test), now + 10_000);
    assert.equal(w.notifications.scheduled.get(test).content.data.entryId, "entry-1");
    w.stores().onboarding.getState().setReminder("morning", "09:00");
    await W.advance(1_000);
    assert.ok(w.notifications.scheduled.has(test));
    w.repository.state.source = null;
    assert.equal(await w.scheduler().scheduleTestAffirmation(10_000), false);
  });
}

// ================================================================== taps
async function tapChecks() {
  await test("tap: a tap while the app is open opens its reflection on Affirmations, once, even when the last response reports it too", async () => {
    const w = await signedIn();
    w.navigation.signedIn();
    const stop = w.routing().startNotificationRouting();
    W.clock.now = T0 + 2 * 3_600_000 + 60_000;
    w.notifications.deliverDue();
    const id = w.notifications.presented[0].request.identifier;
    w.notifications.tap(id);
    assert.deepEqual(w.navigation.navigations, [{ name: "Reflection", params: { entryId: "entry-1", tab: "affirmations" } }]);
    // The app is restarted by the system with the same last response: it is not opened again.
    w.routing().startNotificationRouting();
    assert.equal(w.navigation.navigations.length, 1);
    stop();
  });

  await test("tap: the tap that opened a closed app waits for the signed-in screens and the account, then opens once", async () => {
    const w = W.world();
    W.clock.now = T0;
    w.notifications.coldTap("aff-morning-x", { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: HASH_A, scopeKey: "@x/gracehush" });
    w.routing().startNotificationRouting();
    assert.equal(w.notifications.state.lastResponse, null, "it is taken once");
    assert.equal(w.navigation.navigations.length, 0);
    w.navigation.signedOut();
    w.routing().openPendingTap();
    assert.equal(w.navigation.navigations.length, 0, "the signed-in screens are not up");
    w.navigation.signedIn();
    w.routing().openPendingTap();
    assert.equal(w.navigation.navigations.length, 0, "the account is not known yet");
    await w.signIn("user_a");
    assert.deepEqual(w.navigation.navigations, [{ name: "Reflection", params: { entryId: "entry-1", tab: "affirmations" } }]);
    w.routing().openPendingTap();
    assert.equal(w.navigation.navigations.length, 1);
  });

  await test("tap: a tap waits for the signed-in screens even when the account is already known, then opens", async () => {
    const w = W.world();
    W.clock.now = T0;
    w.notifications.coldTap("aff-evening-x", { kind: "affirmation", entryId: "entry-1", slot: "evening", userHash: HASH_A });
    w.routing().startNotificationRouting();
    w.navigation.signedOut(); // the navigator still shows Sign In while the account is set
    await w.signIn("user_a");
    assert.equal(w.navigation.navigations.length, 0);
    w.navigation.signedIn();
    w.routing().openPendingTap();
    assert.deepEqual(w.navigation.navigations, [{ name: "Reflection", params: { entryId: "entry-1", tab: "affirmations" } }]);
  });

  await test("tap: another account's notification opens nothing, and it is forgotten rather than opened later", async () => {
    const w = await signedIn({ userId: "user_b" });
    w.navigation.signedIn();
    w.routing().startNotificationRouting();
    w.notifications.tap("aff-morning-y", { data: { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: HASH_A } });
    assert.equal(w.navigation.navigations.length, 0);
    w.scheduler().stopAffirmationSchedule();
    w.scheduler().startAffirmationSchedule("user_a");
    await W.advance(1_000);
    assert.equal(w.navigation.navigations.length, 0);
  });

  await test("tap: a notification that is not ours, or an action that is not the plain tap, opens nothing", async () => {
    const w = await signedIn();
    w.navigation.signedIn();
    w.routing().startNotificationRouting();
    w.notifications.tap("other", { data: { url: "https://example.com" } });
    w.notifications.tap("aff-morning-z", { data: { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: HASH_A }, action: "reply" });
    assert.equal(w.navigation.navigations.length, 0);
  });

  await test("tap: while the app is open a notification shows as a quiet banner: in the list, no sound, no badge", async () => {
    const w = W.world();
    w.routing().startNotificationRouting();
    const handler = w.notifications.calls.handler[0];
    assert.ok(handler, "a handler is set at start");
    assert.deepEqual(await handler.handleNotification({}), { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false });
  });
}

// ================================================================== the repository, on the real cache (the step 25 world)
async function repositoryChecks() {
  const CRISIS = {
    is_crisis: true,
    dominant_emotion: null,
    scripture_reference: null,
    scripture_text: null,
    scripture_verified: false,
    devotional_title: null,
    devotional_script: null,
    closing_prayer: null,
  };

  async function live(run) {
    J.installClock();
    J.installVirtualDate();
    J.clock.now = J.BASE;
    try {
      const w = J.makeLiveWorld();
      await w.signIn();
      await run(w);
    } finally {
      J.uninstallVirtualDate();
      J.uninstallClock();
    }
  }
  async function cacheRows(w, rows) {
    const cache = w.use("@/db/cache");
    const mappers = w.use("@/data/mappers");
    for (const row of rows) {
      const model = mappers.toJournalEntry(row);
      await cache.upsertEntry(model);
      if (model.status === "ready" && model.devotional !== null) {
        await cache.upsertAffirmations(model.id, J.affirmationRows(model.id).map(mappers.toAffirmation));
      }
    }
  }
  async function until(handle, predicate, label) {
    for (let i = 0; i < 100; i += 1) {
      if (predicate(handle.result.current)) return handle.result.current;
      await J.settle(2);
    }
    assert.fail(`${label}: never reached`);
  }

  const NOW = () => new Date(J.BASE);
  const DAY = 86_400_000;
  const idOf = (n) => J.serverRow(n).id;
  const affOf = (n, slot) => `aff-${idOf(n).slice(-12)}-${slot}`;

  await test("repository (Word Deck): the pool is the week's finished reflections with their words, newest first, a heavy moment's included; one saved before 2026-11-08 keeps it quiet", async () => {
    await live(async (w) => {
      const repo = w.use("@/data/journalRepository");
      assert.deepEqual(await repo.readWordPool(NOW(), "UTC"), { reflections: [], quiet: false, missing: [] });
      await cacheRows(w, [J.serverRow(5), J.serverRow(3)]);
      let pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(pool.reflections.map((item) => [item.entryId, item.tier]), [[idOf(3), "week"], [idOf(5), "week"]]);
      assert.deepEqual(pool.reflections[0].words.map((word) => word.slot), ["morning", "afternoon", "evening"]);
      assert.deepEqual(Object.keys(pool.reflections[0].words[0]).sort(), ["entryId", "headline", "id", "slot", "verse"]);
      assert.equal(pool.quiet, false);
      assert.deepEqual(pool.missing, []);
      const ids = () => pool.reflections.map((item) => item.entryId);
      // A newer failed entry is not a reflection, and neither is one still being prepared (on another phone, minutes ago).
      await cacheRows(w, [J.serverRow(2, { processing_status: "failed", error_code: "AI_UNAVAILABLE" })]);
      const preparing = { processing_status: "processing", updated_at: J.stamp(J.BASE - 60_000), devotional_script: null };
      await cacheRows(w, [J.serverRow(4, preparing)]);
      pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(ids(), [idOf(3), idOf(5)]);
      // An older heavy moment saved before 2026-11-08 has no words: it is no reflection of the deck and stops nothing.
      await cacheRows(w, [J.serverRow(8, CRISIS)]);
      pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(ids(), [idOf(3), idOf(5)]);
      assert.equal(pool.quiet, false);
      assert.deepEqual(pool.missing, [], "an entry with no devotional is not a reflection of the deck, so nothing is fetched for it");
      // A heavy moment since then is a whole reflection with its three words, like any other.
      await cacheRows(w, [J.serverRow(1, { is_crisis: true })]);
      pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(ids(), [idOf(1), idOf(3), idOf(5)]);
      assert.equal(pool.reflections[0].words.length, 3);
      // A reflection still being prepared that is the NEWEST entry is not "the newest finished": it neither keeps the app quiet
      // nor joins the pool.
      await cacheRows(w, [J.serverRow(0, preparing)]);
      pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(ids(), [idOf(1), idOf(3), idOf(5)]);
      assert.equal(pool.quiet, false, "the newest entry is still being prepared");
      assert.deepEqual(pool.missing, []);
      // One saved the old way as the NEWEST finished entry keeps the app quiet, and no older reflection's words are used.
      await cacheRows(w, [J.serverRow(0, CRISIS)]);
      assert.deepEqual(await repo.readWordPool(NOW(), "UTC"), { reflections: [], quiet: true, missing: [] });
    });
  });

  await test("repository (Word Deck): older reflections top the week up to seven, newest first", async () => {
    await live(async (w) => {
      const repo = w.use("@/data/journalRepository");
      const older = (n, ago) => J.serverRow(n, { created_at: J.stamp(J.BASE - ago * DAY), updated_at: J.stamp(J.BASE - ago * DAY) });
      await cacheRows(w, [J.serverRow(1), J.serverRow(2), J.serverRow(3), ...[0, 1, 2, 3, 4, 5].map((i) => older(30 + i, 10 + i))]);
      const pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(
        pool.reflections.map((item) => item.tier),
        ["week", "week", "week", "older", "older", "older", "older"],
      );
      assert.deepEqual(pool.reflections.slice(3).map((item) => item.entryId), [30, 31, 32, 33].map(idOf));
    });
  });

  await test("repository (Word Deck): more than fourteen reflections in the week are capped at the newest fourteen", async () => {
    await live(async (w) => {
      await cacheRows(w, Array.from({ length: 16 }, (_, i) => J.serverRow(i + 1)));
      const pool = await w.use("@/data/journalRepository").readWordPool(NOW(), "UTC");
      assert.deepEqual(pool.reflections.map((item) => item.entryId), Array.from({ length: 14 }, (_, i) => idOf(i + 1)));
      assert.ok(pool.reflections.every((item) => item.tier === "week"));
    });
  });

  await test("repository (Word Deck): a reflection the phone has no affirmations for is missing, and one request brings its words; offline changes nothing", async () => {
    await live(async (w) => {
      const repo = w.use("@/data/journalRepository");
      const cache = w.use("@/db/cache");
      const mappers = w.use("@/data/mappers");
      await cacheRows(w, [J.serverRow(3)]);
      await cache.upsertEntry(mappers.toJournalEntry(J.serverRow(1)));
      await cache.upsertEntry(mappers.toJournalEntry(J.serverRow(2)));
      let pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(pool.reflections.map((item) => item.entryId), [idOf(3)]);
      assert.deepEqual([...pool.missing].sort(), [idOf(1), idOf(2)].sort());
      // Offline: nothing is fetched and nothing written.
      w.server.state.offline = true;
      assert.equal(await repo.hydrateWordPool(NOW()), false);
      w.server.state.offline = false;
      assert.equal((await repo.readWordPool(NOW(), "UTC")).missing.length, 2);
      // Online: the server has their affirmations: one request for both, in the order of their positions.
      for (const n of [1, 2]) w.server.state.affirmations.push(...J.affirmationRows(idOf(n)));
      const before = w.server.state.requests.filter((request) => request.path.endsWith("/daily_affirmations")).length;
      assert.equal(await repo.hydrateWordPool(NOW()), true);
      const requests = w.server.state.requests.filter((request) => request.path.endsWith("/daily_affirmations")).length - before;
      assert.equal(requests, 1, "one request for every reflection that lacks its words");
      pool = await repo.readWordPool(NOW(), "UTC");
      assert.deepEqual(pool.reflections.map((item) => item.entryId), [idOf(1), idOf(2), idOf(3)]);
      assert.deepEqual(pool.missing, []);
      assert.deepEqual(pool.reflections[0].words.map((word) => word.slot), ["morning", "afternoon", "evening"]);
      // Nothing missing: no request at all.
      const after = w.server.state.requests.length;
      assert.equal(await repo.hydrateWordPool(NOW()), false);
      assert.equal(w.server.state.requests.length, after);
    });
  });

  await test("repository (Word Deck): the calendar keeps what the reminders carried: ahead is rewritten, what has passed stays, two weeks on it goes; the current word is the one that last arrived", async () => {
    await live(async (w) => {
      const repo = w.use("@/data/journalRepository");
      await cacheRows(w, [J.serverRow(5), J.serverRow(3)]);
      const H = 3_600_000;
      const now = J.BASE;
      const row = (n, slot, at, day = 20261025) => ({ day, slot, fireAt: at, entryId: idOf(n), affirmationId: affOf(n, slot) });
      assert.equal(await repo.readCurrentWord(now), null, "an empty calendar has no word");
      await repo.saveWordCalendar([row(5, "morning", now - 4 * H), row(5, "afternoon", now + H)], now);
      assert.deepEqual((await repo.readWordCalendar()).map((item) => item.slot), ["morning", "afternoon"]);
      // The current word is the newest row that has fired, with its reflection and the slot it was delivered at.
      const current = await repo.readCurrentWord(now);
      assert.equal(current.affirmation.id, affOf(5, "morning"));
      assert.equal(current.entry.id, idOf(5));
      assert.equal(current.slot, "morning");
      assert.equal(current.fireAt, now - 4 * H);
      assert.equal((await repo.readCurrentWord(now + 2 * H)).affirmation.id, affOf(5, "afternoon"));
      // A word dealt at a slot that is not its own keeps the slot it was delivered at.
      await repo.saveWordCalendar([row(3, "evening", now + 3 * H)], now + 2 * H);
      assert.deepEqual((await repo.readWordCalendar()).map((item) => item.slot), ["morning", "afternoon", "evening"]);
      // A save rewrites what is ahead (the evening row goes), keeps what has passed, and a row of the same day and slot is replaced.
      await repo.saveWordCalendar([row(5, "evening", now + 4 * H)], now + 2 * H);
      const saved = await repo.readWordCalendar();
      assert.deepEqual(saved.map((item) => [item.slot, item.entryId]), [["morning", idOf(5)], ["afternoon", idOf(5)], ["evening", idOf(5)]]);
      await repo.saveWordCalendar([row(3, "afternoon", now + H)], now + 30 * 60_000);
      assert.equal((await repo.readWordCalendar()).find((item) => item.slot === "afternoon").entryId, idOf(3));
      // A word older than 26 hours is not today's word: the card goes back to the newest reflection's.
      assert.equal((await repo.readCurrentWord(now + H + 26 * H)).affirmation.id, affOf(3, "afternoon"));
      assert.equal(await repo.readCurrentWord(now + H + 26 * H + 1), null);
      // A word the phone no longer holds (its reflection was deleted) is no word, and never an error.
      await w.use("@/data/entriesLive").forgetEntry(idOf(3));
      assert.equal(await repo.readCurrentWord(now + 2 * H), null);
      // Rows more than two weeks old are dropped by the next save.
      await repo.saveWordCalendar([], now + 15 * DAY);
      assert.deepEqual(await repo.readWordCalendar(), []);
    });
  });

  await test("repository: a cache that is not open throws (so nothing is cancelled), the current word is simply none, and the switch is read from the phone with no waiting", async () => {
    await live(async (w) => {
      const repo = w.use("@/data/journalRepository");
      assert.equal(repo.getKnownAffirmationsEnabled("user_a"), true);
      w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().saveUnsent("user_a", { affirmationsEnabled: false });
      assert.equal(repo.getKnownAffirmationsEnabled("user_a"), false, "an unsent change wins");
      assert.equal(repo.getKnownAffirmationsEnabled("user_nobody"), null, "never read on this phone");
      await w.use("@/db/database").closeUserDatabase();
      await assert.rejects(() => repo.readWordPool(NOW(), "UTC"));
      await assert.rejects(() => repo.readWordCalendar());
      assert.equal(await repo.readCurrentWord(J.BASE), null);
      assert.equal(await repo.hydrateWordPool(NOW()), false);
    });
  });

  await test("repository: with the mock data the pool is the mock reflections' words, the current word is none, and the switch is the mock row's", async () => {
    await live(async (w) => {
      w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
      const repo = w.use("@/data/journalRepository");
      const pool = await repo.readWordPool(NOW(), "UTC");
      assert.equal(typeof pool.quiet, "boolean");
      assert.deepEqual(pool.missing, []);
      assert.ok(pool.reflections.every((item) => item.words.length === 0 || item.words.length === 3));
      assert.equal(await repo.readCurrentWord(J.BASE), null);
      assert.equal(await repo.hydrateWordPool(NOW()), false);
      assert.equal(typeof repo.getKnownAffirmationsEnabled("user_a"), "boolean");
    });
  });

  await test("repository: Journal's first page from the server asks for the notifications to be planned again; a failed one does not", async () => {
    await live(async (w) => {
      w.server.state.offline = true;
      let handle = w.renderHook(w.use("@/hooks/useJournalHome").useJournalHome);
      await until(handle, (state) => state.status === "error", "the error state");
      assert.equal(w.affirmationRequests(), 0);
      handle.unmount();
      w.server.state.offline = false;
      w.server.state.entries.push(J.serverRow(1));
      w.server.state.affirmations.push(...J.affirmationRows(J.serverRow(1).id));
      handle = w.renderHook(w.use("@/hooks/useJournalHome").useJournalHome);
      await until(handle, (state) => state.status === "ready" && state.entries.length === 1, "the server's page");
      assert.ok(w.affirmationRequests() >= 1);
      handle.unmount();
    });
  });
}

// ================================================================== the shipped files
async function contractChecks() {
  const root = REPO ?? path.resolve(__dirname, "..", "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, name);
      if (fs.statSync(path.join(root, rel)).isDirectory()) out.push(...walk(rel));
      else if (/\.(ts|tsx)$/.test(name)) out.push(rel.split(path.sep).join("/"));
    }
    return out;
  }

  await test("contract: only the notifications service imports expo-notifications, and nothing cancels or dismisses everything", async () => {
    const files = walk("src");
    const importers = files.filter((rel) => /expo-notifications/.test(read(rel)) && /(require|from)\(?\s*"expo-notifications"/.test(read(rel)));
    assert.deepEqual(importers, ["src/services/notifications.ts"]);
    for (const rel of files) {
      const text = read(rel);
      assert.ok(!text.includes("cancelAllScheduledNotificationsAsync"), rel);
      assert.ok(!text.includes("dismissAllNotificationsAsync"), rel);
    }
  });

  await test("contract: no TODO(28) is left, and an opened notification sends step 34's event with its slot and nothing else", async () => {
    for (const rel of [...walk("src"), ...walk("supabase/functions")]) assert.ok(!read(rel).includes("TODO(28)"), rel);
    const w = await signedIn();
    w.navigation.signedIn();
    const stop = w.routing().startNotificationRouting();
    w.notifications.tap("aff-evening-q", { data: { kind: "affirmation", entryId: "entry-1", slot: "evening", userHash: HASH_A } });
    assert.deepEqual(w.analyticsCalls, [["affirmation_notification_opened", { slot: "evening" }]]);
    // Another account's notification opens nothing and sends nothing.
    w.notifications.tap("aff-morning-q", { data: { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: "0000000000000000" } });
    assert.equal(w.analyticsCalls.length, 1);
    stop();
  });

  await test("contract: the config plugin is local only, with the white icon and the plum colour", async () => {
    const plugins = JSON.parse(read("app.json")).expo.plugins;
    const entry = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications");
    assert.deepEqual(entry[1], { icon: "./assets/images/notification-icon.png", color: "#5B3A5E", enableRemoteNotifications: false });
  });

  await test("contract: the notification icon is a 96 by 96 white mark on a transparent square, with no metadata", async () => {
    const { PNG } = require(path.join(root, "node_modules", "pngjs"));
    const bytes = fs.readFileSync(path.join(root, "assets/images/notification-icon.png"));
    const png = PNG.sync.read(bytes);
    assert.equal(png.width, 96);
    assert.equal(png.height, 96);
    let drawn = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      drawn += 1;
      assert.ok(png.data[i] >= 245 && png.data[i + 1] >= 245 && png.data[i + 2] >= 245, "every drawn pixel is white");
    }
    assert.ok(drawn > 500, "the mark is there");
    assert.equal(png.data[3], 0, "the corner is transparent");
    const chunks = [];
    for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) chunks.push(bytes.toString("latin1", at + 4, at + 8));
    assert.deepEqual([...new Set(chunks)], ["IHDR", "IDAT", "IEND"]);
  });
}

(async () => {
  await zoneChecks();
  await planChecks();
  await deckChecks();
  await scheduleChecks();
  await tapChecks();
  await repositoryChecks();
  await contractChecks();
  finished = true;
  if (failures.length === 0) {
    fs.writeSync(1, `${passed} checks passed${String.fromCharCode(10)}`);
  } else {
    fs.writeSync(1, `${passed} checks passed, ${failures.length} FAILED:${String.fromCharCode(10)}${String.fromCharCode(10)} - ${failures.join(`${String.fromCharCode(10)} - `)}${String.fromCharCode(10)}`);
    process.exitCode = 1;
  }
})();
