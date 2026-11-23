// The 2026-11-18 checks: the trial-end reminder. A person who starts a free trial may switch on one local notification, about two
// days before the trial ends (10:00 local, two calendar days before the end day), that says what they keep, what the plan costs after
// the trial and where to manage it (reworded the same day: it first told the person how to avoid being charged).
// They run the app's real planner (utils/trialReminder.ts), notification service (services/trialReminder.ts), tap routing and
// paywall hook in Node, on the notifications checks' fake of expo-notifications 58 (iOS and Android) and a virtual clock, and read the
// shipped files for the screen, the sign-out and the plan watch.
//
//   node --no-warnings supabase/tests/trial-reminder/run.cjs          (from the repo root; a few seconds)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/trial-reminder/run.cjs
//
// What it cannot show is the phone: the OS permission sheet, the lock screen, and the paywall's fold with the extra row. Those are
// the phone checks of the log entry. Exit code 0 only when every check passes.
//   ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either);
//   FAILFAST=1 stops at the first failure; TIMINGS=1 prints how long each check took.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// The step 25 world first: it hands zustand its small React when zustand first loads, and its hooks run the paywall hook below.
const J = require("../journal-data/world.cjs");
const W = require("../notifications/world.cjs");

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

// What must never reach the development log: the reminder's identifier, its words, a date, an account.
const FORBIDDEN_IN_LOGS = ["trial-ending", "trial-test", "trial ends", "continues at", "125.99", "Saturday", "Monday", "2026", "user_a", W.sha16("user_a")];

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

// ------------------------------------------------------------------ the example every check shares
// Monday 23 November 2026, 15:00 in New York (EST, UTC-5: the clocks went back on 1 November). A trial bought now that ends a week
// later, on Monday 30 November at 15:00, is reminded on Saturday 28 November at 10:00. The rule is the same for every length of
// trial; the launch trial of three days (2026-11-18) has a check of its own in planChecks.
const NY = "America/New_York";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 23, 20, 0, 0);
const END = NOW + 7 * DAY;
const FIRE = Date.UTC(2026, 10, 28, 15, 0, 0);
// What the plan costs after the trial, as the paywall hook hands it over: the bought package's own price string and period.
const TERMS = { price: "$125.99", period: "year" };
const TITLE = "Your GraceHush trial ends Monday";
// Scholar is not part of the trial (2026-11-18): the reminder says it opens when the plan begins.
const BODY =
  "Keep unlimited devotionals, and Scholar opens when your plan begins. After your trial, Pro continues at $125.99 per year. Tap to manage your plan.";

const GRANTED = { granted: true, status: "granted", canAskAgain: true, ios: { status: 2 } };
const UNDETERMINED = { granted: false, status: "undetermined", canAskAgain: true, ios: { status: 0 } };
const DENIED = { granted: false, status: "denied", canAskAgain: false, ios: { status: 1 } };
const PROVISIONAL = { granted: false, status: "undetermined", canAskAgain: true, ios: { status: 3 } };

// The wall clock of `zone` at an instant, written independently of the app's code.
function wallOf(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
// "2026-11-30" two days earlier, by calendar arithmetic.
function dayMinus(dateText, days) {
  const [y, m, d] = dateText.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d - days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(moved.getUTCDate()).padStart(2, "0")}`;
}

const util = () => W.world().use("@/utils/trialReminder");
function plan(input) {
  return util().planTrialReminder({ timeZone: NY, ...input });
}
// A world on the example's clock, with the permission a check asks for.
function tw(options = {}) {
  const { permission = GRANTED, requestAnswer = null, now = NOW, ...rest } = options;
  const w = W.world(rest);
  W.clock.now = now;
  w.notifications.state.permission = { ...permission };
  w.notifications.state.requestAnswer = requestAnswer === null ? null : { ...requestAnswer };
  return w;
}
const read = (relative) => fs.readFileSync(path.join(REPO, relative), "utf8");

// ================================================================== the plan (pure)
async function planChecks() {
  await test("plan: the reminder is 10:00 on the day two before the end day, in zones east and west of UTC and half-hour ones", async () => {
    const u = util();
    for (const zone of ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Pacific/Auckland", "Africa/Lagos", "UTC", "Pacific/Kiritimati"]) {
      const found = u.planTrialReminder({ endsAtMs: END, nowMs: NOW, timeZone: zone });
      assert.ok(found, zone);
      const endDay = wallOf(END, zone).slice(0, 10);
      assert.equal(wallOf(found.fireAt.getTime(), zone), `${dayMinus(endDay, 2)} 10:00`, zone);
      assert.equal(found.endsAt.getTime(), END);
      assert.equal(found.timeZone, zone);
      assert.equal(found.identifier, "trial-ending");
    }
  });

  await test("plan: the New York example is Saturday 28 November, 10:00, the day the paywall's line names", async () => {
    const found = plan({ endsAtMs: END, nowMs: NOW });
    assert.equal(found.fireAt.getTime(), FIRE);
    assert.equal(found.endsAt.getTime(), END);
    assert.ok(!("cancelBy" in found), "the reminder carries no cancel deadline: it does not tell anyone to cancel");
  });

  await test("plan: every day of 2026 in four zones is 10:00 two days before the end day, 37 to 63 hours before the end, daylight-saving days included", async () => {
    const u = util();
    for (const zone of ["America/New_York", "Europe/London", "Pacific/Auckland", "Australia/Lord_Howe"]) {
      for (let offset = 0; offset < 365; offset += 1) {
        const end = Date.UTC(2026, 0, 1, 15, 7, 0) + offset * DAY;
        const found = u.planTrialReminder({ endsAtMs: end, nowMs: end - 10 * DAY, timeZone: zone });
        assert.ok(found, `${zone} day ${offset}`);
        assert.equal(wallOf(found.fireAt.getTime(), zone), `${dayMinus(wallOf(end, zone).slice(0, 10), 2)} 10:00`, `${zone} day ${offset}`);
        const hours = (end - found.fireAt.getTime()) / HOUR;
        assert.ok(hours >= 37 && hours <= 63, `${zone} day ${offset}: ${hours} h before the end`);
      }
    }
  });

  await test("plan: the launch trial of three days always has its reminder: 10:00 within a day and a half of the purchase, 37 to 63 hours before the end, at any time of day and in any zone", async () => {
    const u = util();
    // Every 61 minutes through 2026 (61 and 1440 have no common factor, so the purchases walk through every minute of the day),
    // in zones west and east of UTC, a half-hour one and one whose clocks move by half an hour. One formatter per zone, and a
    // message only when a purchase fails: building either for every purchase made this check take twenty seconds.
    for (const zone of ["America/New_York", "Pacific/Auckland", "Asia/Kolkata", "Australia/Lord_Howe"]) {
      const clockOf = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
      for (let bought = Date.UTC(2026, 0, 1, 0, 7, 0); bought < Date.UTC(2027, 0, 1); bought += 61 * 60_000) {
        const end = bought + 3 * DAY;
        const found = u.planTrialReminder({ endsAtMs: end, nowMs: bought, timeZone: zone });
        const fire = found === null ? Number.NaN : found.fireAt.getTime();
        const after = (fire - bought) / HOUR;
        const before = (end - fire) / HOUR;
        const ok =
          found !== null &&
          fire - bought >= 10_000 &&
          after <= 36 &&
          clockOf.format(new Date(fire)) === "10:00" &&
          before >= 37 &&
          before <= 63;
        if (!ok) {
          assert.fail(
            `a three-day trial bought ${zone} ${wallOf(bought, zone)}: ${found === null ? "no reminder" : `${wallOf(fire, zone)}, ${after} h after the purchase, ${before} h before the end`}`,
          );
        }
      }
    }
  });

  await test("plan: a trial that ends in 36 hours has no reminder left to plan, and one 10 seconds ahead is the least that is planned", async () => {
    const u = util();
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    // The reminder day (1 November, 10:00 UTC) is already past at 12:00.
    assert.equal(u.planTrialReminder({ endsAtMs: Date.UTC(2026, 10, 3, 15, 0, 0), nowMs: now, timeZone: "UTC" }), null);
    // 2 November, 10:00 UTC is 22 hours ahead.
    const ends = Date.UTC(2026, 10, 4, 9, 0, 0);
    assert.ok(u.planTrialReminder({ endsAtMs: ends, nowMs: now, timeZone: "UTC" }));
    const fire = Date.UTC(2026, 10, 2, 10, 0, 0);
    assert.equal(u.planTrialReminder({ endsAtMs: ends, nowMs: fire - 5_000, timeZone: "UTC" }), null);
    assert.equal(u.planTrialReminder({ endsAtMs: ends, nowMs: fire - 9_999, timeZone: "UTC" }), null);
    assert.ok(u.planTrialReminder({ endsAtMs: ends, nowMs: fire - 10_000, timeZone: "UTC" }));
    assert.equal(u.planTrialReminder({ endsAtMs: ends, nowMs: fire + 1, timeZone: "UTC" }), null);
  });

  await test("plan: an end that is not a time, or is already past, and a zone Intl does not know", async () => {
    const u = util();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(u.planTrialReminder({ endsAtMs: bad, nowMs: NOW, timeZone: NY }), null);
      assert.equal(u.planTrialReminder({ endsAtMs: END, nowMs: bad, timeZone: NY }), null);
    }
    assert.equal(u.planTrialReminder({ endsAtMs: NOW - 1_000, nowMs: NOW, timeZone: NY }), null);
    const odd = u.planTrialReminder({ endsAtMs: END, nowMs: NOW, timeZone: "Not/AZone" });
    const utc = u.planTrialReminder({ endsAtMs: END, nowMs: NOW, timeZone: "UTC" });
    assert.ok(odd && utc);
    assert.equal(odd.fireAt.getTime(), utc.fireAt.getTime());
    assert.equal(odd.timeZone, "UTC");
  });
}

// ================================================================== the words (pure)
async function textChecks() {
  await test("text: the title names the weekday the trial ends on; the body says what is kept, what the plan costs after the trial and where to manage it, the same on both platforms", async () => {
    const u = util();
    const found = u.planTrialReminder({ endsAtMs: END, nowMs: NOW, timeZone: NY });
    assert.deepEqual(u.trialReminderText(found, TERMS), { title: TITLE, body: BODY });
    // The price and the period are the bought package's own, so a monthly plan and another currency's string read as they are.
    assert.equal(
      u.trialReminderText(found, { price: "$14.99", period: "month" }).body,
      "Keep unlimited devotionals, and Scholar opens when your plan begins. After your trial, Pro continues at $14.99 per month. Tap to manage your plan.",
    );
    assert.ok(u.trialReminderText(found, { price: "US$125.99", period: "year" }).body.includes("continues at US$125.99 per year."));
    assert.ok(u.trialReminderText(found, { price: "125,99 €", period: "year" }).body.includes("continues at 125,99 € per year."));
  });

  await test("text: the weekday is the zone's own, so a phone in London or Auckland reads its own calendar", async () => {
    const u = util();
    const now = Date.UTC(2026, 10, 23, 15, 0, 0);
    const title = (endsAtMs, timeZone) => u.trialReminderText(u.planTrialReminder({ endsAtMs, nowMs: now, timeZone }), TERMS).title;
    // 30 November 15:00 UTC is Monday 15:00 in London in winter, and 04:00 on Tuesday 1 December in Auckland.
    const instant = Date.UTC(2026, 10, 30, 15, 0, 0);
    assert.equal(title(instant, "Europe/London"), "Your GraceHush trial ends Monday");
    assert.equal(title(instant, "Pacific/Auckland"), "Your GraceHush trial ends Tuesday");
    // Midnight UTC on Monday 30 November is still Sunday evening in New York.
    const midnight = Date.UTC(2026, 10, 30, 0, 0, 0);
    assert.equal(title(midnight, "UTC"), "Your GraceHush trial ends Monday");
    assert.equal(title(midnight, NY), "Your GraceHush trial ends Sunday");
  });

  await test("text: it never tells anyone to avoid a charge or to cancel, names no store, pressures nobody, and fits a lock screen", async () => {
    const u = util();
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (let offset = 0; offset < 7; offset += 1) {
      const end = Date.UTC(2026, 10, 29 + offset, 18, 30, 0);
      const found = u.planTrialReminder({ endsAtMs: end, nowMs: NOW, timeZone: "UTC" });
      assert.ok(found, `day ${offset}`);
      const { title, body } = u.trialReminderText(found, TERMS);
      assert.equal(title, `Your GraceHush trial ends ${WEEKDAYS[new Date(end).getUTCDay()]}`);
      assert.ok(title.length <= 38, `${title} (${title.length} characters)`);
      assert.ok(body.length <= 150, `${body.length} characters`);
      for (const words of [title, body]) {
        assert.ok(!/avoid|cancel|charged|charge|app store|google play|apple|google|expire|lose|miss out|last chance|hurry|don.t|too late/i.test(words), words);
        assert.ok(!words.includes("'") && !words.includes("..."), words);
        assert.ok(!/\d{1,2}:\d{2}/.test(words), `no clock time: ${words}`);
      }
      // What it says: what is kept, what happens after the trial and at what price, and the way to manage it.
      assert.ok(body.startsWith("Keep unlimited devotionals, and Scholar opens when your plan begins."), body);
      assert.ok(body.includes("After your trial, Pro continues at $125.99 per year."), body);
      assert.ok(body.endsWith("Tap to manage your plan."), body);
    }
    // The paywall's line after the purchase names the reminder's own day.
    const found = u.planTrialReminder({ endsAtMs: END, nowMs: NOW, timeZone: NY });
    assert.equal(u.reminderDayLabel(found.fireAt, NY), "Saturday, Nov 28");
    assert.equal(u.reminderDayLabel(found.fireAt, "Pacific/Kiritimati"), "Sunday, Nov 29");
  });

  await test("text: the identifier and the tap data are recognised, and nothing else is", async () => {
    const u = util();
    assert.equal(u.isTrialReminderId("trial-ending"), true);
    assert.equal(u.isTrialReminderId("trial-test-1790000000000"), true);
    assert.equal(u.isTrialReminderId("aff-morning-20261101-0800-abcd1234"), false);
    assert.equal(u.isTrialReminderId("trial"), false);
    assert.equal(u.isTrialReminderId(""), false);
    assert.equal(u.isTrialReminderTap({ kind: "trial_reminder" }), true);
    // Expo Go adds keys of its own to a notification's data.
    assert.equal(u.isTrialReminderTap({ kind: "trial_reminder", experienceId: "@x/y", scopeKey: "z" }), true);
    for (const other of [null, undefined, "trial_reminder", 4, {}, { kind: "affirmation" }, { kind: "Trial_Reminder" }]) {
      assert.equal(u.isTrialReminderTap(other), false, JSON.stringify(other));
    }
  });
}

// ================================================================== the service
async function serviceChecks() {
  await test("schedule: a granted iPhone gets one notification for 10:00 two days before the end day, with the tap data and the words", async () => {
    const w = tw();
    const result = await w.trial().scheduleTrialReminder(END, TERMS);
    assert.deepEqual(result, { status: "scheduled", fireAt: FIRE, day: "Saturday, Nov 28" });
    assert.deepEqual(w.notifications.trialIds(), ["trial-ending"]);
    assert.equal(w.notifications.calls.schedule.length, 1);
    const [call] = w.notifications.calls.schedule;
    assert.equal(call.identifier, "trial-ending");
    assert.equal(call.trigger.type, "date");
    assert.equal(call.trigger.date.getTime(), FIRE);
    assert.deepEqual(call.content.data, { kind: "trial_reminder" });
    assert.equal(call.content.title, TITLE);
    assert.equal(call.content.body, BODY);
    assert.equal(call.content.sound, "default");
    assert.equal(w.notifications.calls.requests.length, 0, "a permission that is already given is not asked again");
    // Nothing of the person is in it: not the plan, the price, an id or an account.
    assert.ok(!JSON.stringify(call.content).includes("user_"));
  });

  await test("schedule: on Android it goes to the affirmation channel, which is created first, with the same words", async () => {
    const w = tw({ platform: "android" });
    const result = await w.trial().scheduleTrialReminder(END, TERMS);
    assert.equal(result.status, "scheduled");
    const [call] = w.notifications.calls.schedule;
    assert.equal(call.trigger.channelId, "affirmations");
    assert.equal(call.content.title, TITLE);
    assert.equal(call.content.body, BODY);
    assert.ok(w.notifications.calls.channels.some((channel) => channel.id === "affirmations"), "the channel exists before the notification");
  });

  await test("schedule: a permission never asked is asked once, in context; a yes schedules and a no does not", async () => {
    const yes = tw({ permission: UNDETERMINED, requestAnswer: GRANTED });
    assert.equal((await yes.trial().scheduleTrialReminder(END, TERMS)).status, "scheduled");
    assert.equal(yes.notifications.calls.requests.length, 1);
    assert.deepEqual(yes.notifications.trialIds(), ["trial-ending"]);

    const no = tw({ permission: UNDETERMINED, requestAnswer: DENIED });
    assert.deepEqual(await no.trial().scheduleTrialReminder(END, TERMS), { status: "denied" });
    assert.equal(no.notifications.calls.requests.length, 1);
    assert.deepEqual(no.notifications.trialIds(), []);
    assert.equal(no.notifications.calls.schedule.length, 0);
  });

  await test("schedule: a permission already refused is not asked for again, and a quiet (provisional) one counts as given", async () => {
    const denied = tw({ permission: DENIED });
    assert.deepEqual(await denied.trial().scheduleTrialReminder(END, TERMS), { status: "denied" });
    assert.equal(denied.notifications.calls.requests.length, 0);
    assert.equal(denied.notifications.calls.schedule.length, 0);

    const quiet = tw({ permission: PROVISIONAL });
    assert.equal((await quiet.trial().scheduleTrialReminder(END, TERMS)).status, "scheduled");
    assert.equal(quiet.notifications.calls.requests.length, 0);
  });

  await test("schedule: a second call replaces the first, so only one reminder ever waits", async () => {
    const w = tw();
    const t = w.trial();
    await t.scheduleTrialReminder(END, TERMS);
    const later = END + 2 * DAY;
    const second = await t.scheduleTrialReminder(later, TERMS);
    assert.equal(second.status, "scheduled");
    assert.deepEqual(w.notifications.trialIds(), ["trial-ending"]);
    assert.equal(w.notifications.scheduled.get("trial-ending").at, FIRE + 2 * DAY);
    assert.ok(w.notifications.calls.cancel.includes("trial-ending"), "the earlier one is cancelled before the new one");
  });

  await test("schedule: a trial too short for a reminder is skipped, with nothing scheduled and nothing asked", async () => {
    const w = tw({ permission: UNDETERMINED, requestAnswer: GRANTED });
    assert.deepEqual(await w.trial().scheduleTrialReminder(NOW + 36 * HOUR, TERMS), { status: "skipped" });
    assert.deepEqual(await w.trial().scheduleTrialReminder(NOW - HOUR, TERMS), { status: "skipped" });
    assert.deepEqual(await w.trial().scheduleTrialReminder(Number.NaN, TERMS), { status: "skipped" });
    assert.equal(w.notifications.calls.requests.length, 0);
    assert.equal(w.notifications.calls.schedule.length, 0);
  });

  await test("schedule: with no price to name there is no reminder, and nothing is asked", async () => {
    const w = tw({ permission: UNDETERMINED, requestAnswer: GRANTED });
    for (const price of ["", "   "]) {
      assert.deepEqual(await w.trial().scheduleTrialReminder(END, { price, period: "year" }), { status: "skipped" });
    }
    assert.equal(await w.trial().scheduleTestTrialReminder({ price: "", period: "year" }, 10_000), false);
    assert.equal(w.notifications.calls.requests.length, 0);
    assert.equal(w.notifications.calls.schedule.length, 0);
  });

  await test("schedule: the words carry the price and period that were handed over, in the real notification and in the developer test", async () => {
    const real = tw();
    await real.trial().scheduleTrialReminder(END, { price: "$14.99", period: "month" });
    assert.ok(real.notifications.scheduled.get("trial-ending").content.body.includes("continues at $14.99 per month."));
    const test = tw();
    assert.equal(await test.trial().scheduleTestTrialReminder({ price: "¥6,000", period: "year" }, 10_000), true);
    const [id] = test.notifications.trialIds();
    assert.ok(test.notifications.scheduled.get(id).content.body.includes("continues at ¥6,000 per year."));
  });

  await test("schedule: the phone refusing the notification is a failed result, never a throw", async () => {
    const w = tw();
    w.notifications.state.failScheduleAll = true;
    assert.deepEqual(await w.trial().scheduleTrialReminder(END, TERMS), { status: "failed" });
    assert.deepEqual(w.notifications.trialIds(), []);
  });

  await test("schedule: where notifications cannot load (Expo Go on Android) it is skipped and asks for nothing", async () => {
    const w = tw({ platform: "android", expoGo: true, permission: UNDETERMINED, requestAnswer: GRANTED });
    assert.deepEqual(await w.trial().scheduleTrialReminder(END, TERMS), { status: "skipped" });
    assert.equal(await w.trial().canOfferTrialReminder(), false);
    assert.equal(w.notifications.calls.requests.length, 0);
  });

  await test("offer: the switch is shown for a permission given or never asked, and not for one refused", async () => {
    assert.equal(await tw({ permission: GRANTED }).trial().canOfferTrialReminder(), true);
    assert.equal(await tw({ permission: PROVISIONAL }).trial().canOfferTrialReminder(), true);
    assert.equal(await tw({ permission: UNDETERMINED }).trial().canOfferTrialReminder(), true);
    assert.equal(await tw({ permission: DENIED }).trial().canOfferTrialReminder(), false);
    // Reading it asks the person nothing.
    const w = tw({ permission: UNDETERMINED });
    await w.trial().canOfferTrialReminder();
    assert.equal(w.notifications.calls.requests.length, 0);
  });

  await test("clear: every scheduled trial notification goes and the ones in the notification center are dismissed, and nothing else", async () => {
    const w = tw({ expoGoOthers: ["trial-someone-elses-is-not-ours-unless-prefixed", "other-project-id"] });
    const t = w.trial();
    await t.scheduleTrialReminder(END, TERMS);
    await t.scheduleTestTrialReminder(TERMS, 10_000);
    // An affirmation notification waiting, and two shown: ours and an affirmation.
    w.notifications.scheduled.set("aff-morning-20261124-0800-abcd1234", { content: { title: "x", body: "y", data: {} }, trigger: {}, at: NOW + DAY });
    w.notifications.presented.push(
      { request: { identifier: "trial-ending", content: { title: "t", body: "b", data: {} } }, date: NOW },
      { request: { identifier: "aff-evening-20261123-2000-abcd1234", content: { title: "t", body: "b", data: {} } }, date: NOW },
    );
    assert.equal(w.notifications.trialIds().length, 3, "the two of ours and the lookalike another project holds");
    await t.clearTrialReminder();
    assert.deepEqual(w.notifications.trialIds(), []);
    assert.ok(w.notifications.scheduled.has("aff-morning-20261124-0800-abcd1234"), "the affirmation notification stays");
    assert.ok(w.notifications.scheduled.has("other-project-id"), "another project's stays");
    assert.deepEqual(w.notifications.calls.dismiss, ["trial-ending"]);
    assert.ok(w.notifications.presented.some((shown) => shown.request.identifier.startsWith("aff-")));
  });

  await test("clear: a phone that cannot list its notifications is not an error, and with no reminder it asks for nothing more", async () => {
    const w = tw();
    w.notifications.state.failList = true;
    await w.trial().clearTrialReminder();
    const quiet = tw();
    await quiet.trial().clearTrialReminder();
    assert.deepEqual(quiet.notifications.calls.cancel, []);
    assert.deepEqual(quiet.notifications.calls.dismiss, []);
  });

  await test("reconcile: no trial, or a trial that no longer renews, removes the real reminder, waiting and shown, and nothing else of ours; an active trial keeps it and touches nothing", async () => {
    for (const trial of [null, { endsAt: END, willRenew: false }]) {
      const w = tw();
      const t = w.trial();
      await t.scheduleTrialReminder(END, TERMS);
      await t.scheduleTestTrialReminder(TERMS, 10_000);
      const [testId] = w.notifications.trialIds().filter((id) => id !== "trial-ending");
      assert.ok(/^trial-test-\d+$/.test(testId), testId);
      const shown = (identifier) => ({ request: { identifier, content: { title: "t", body: "b", data: {} } }, date: NOW });
      w.notifications.presented.push(shown("trial-ending"), shown(testId), shown("aff-evening-20261123-2000-abcd1234"));
      await t.reconcileTrialReminder(trial);
      assert.deepEqual(w.notifications.trialIds(), [testId], `${JSON.stringify(trial)}: only the developer panel's test stays waiting`);
      assert.deepEqual(w.notifications.calls.dismiss, ["trial-ending"], "only the real reminder is dismissed");
      assert.deepEqual(
        w.notifications.presented.map((notification) => notification.request.identifier).sort(),
        [testId, "aff-evening-20261123-2000-abcd1234"].sort(),
        "the test notification and the affirmation are still shown",
      );
    }
    const w = tw();
    await w.trial().scheduleTrialReminder(END, TERMS);
    const listedBefore = w.notifications.calls.list;
    const cancelledBefore = w.notifications.calls.cancel.length;
    await w.trial().reconcileTrialReminder({ endsAt: END, willRenew: true });
    assert.deepEqual(w.notifications.trialIds(), ["trial-ending"]);
    assert.equal(w.notifications.calls.list, listedBefore, "an active trial is not even listed");
    assert.equal(w.notifications.calls.cancel.length, cancelledBefore);
  });

  await test("reconcile: it never creates a reminder, and it never asks for a permission", async () => {
    const w = tw({ permission: UNDETERMINED, requestAnswer: GRANTED });
    await w.trial().reconcileTrialReminder({ endsAt: END, willRenew: true });
    await w.trial().reconcileTrialReminder(null);
    assert.equal(w.notifications.calls.schedule.length, 0);
    assert.equal(w.notifications.calls.requests.length, 0);
  });

  await test("dev: the test notification fires in 10 seconds with the real words and the tap data, and says whether it was sent", async () => {
    const w = tw();
    assert.equal(await w.trial().scheduleTestTrialReminder(TERMS, 10_000), true);
    const [id] = w.notifications.trialIds();
    assert.ok(/^trial-test-\d+$/.test(id), id);
    const entry = w.notifications.scheduled.get(id);
    assert.ok(entry.at - NOW >= 9_000 && entry.at - NOW <= 11_000, `${entry.at - NOW} ms ahead`);
    assert.deepEqual(entry.content.data, { kind: "trial_reminder" });
    // A pretend trial that ends in three days: Monday 23 November plus three days is Thursday.
    assert.equal(entry.content.title, "Your GraceHush trial ends Thursday");
    assert.equal(entry.content.body, BODY);

    const denied = tw({ permission: DENIED });
    assert.equal(await denied.trial().scheduleTestTrialReminder(TERMS, 10_000), false);
    assert.deepEqual(denied.notifications.trialIds(), []);
  });
}

// ================================================================== the tap
async function tapChecks() {
  await test("tap: a trial reminder opens the Profile tab (popping back to the tabs), held until the signed-in screens are up, and acted on once", async () => {
    const w = tw();
    const routing = w.routing();
    routing.startNotificationRouting();
    w.notifications.tap("trial-ending", { data: { kind: "trial_reminder" }, date: 500 });
    assert.deepEqual(w.navigation.navigations, [], "signed out: nothing opens yet");
    w.navigation.signedIn();
    routing.openPendingTap();
    assert.deepEqual(w.navigation.navigations, [{ name: "MainTabs", params: { screen: "Profile" }, options: { pop: true } }]);
    routing.openPendingTap();
    routing.openPendingTap();
    assert.equal(w.navigation.navigations.length, 1, "once");
    // The same delivery reported again (the listener and the last response can both report one tap) is still once.
    w.notifications.tap("trial-ending", { data: { kind: "trial_reminder" }, date: 500 });
    routing.openPendingTap();
    assert.equal(w.navigation.navigations.length, 1, "the same delivery, reported twice, opens Profile once");
    // A later delivery of the reminder is a new tap.
    w.notifications.tap("trial-ending", { data: { kind: "trial_reminder" }, date: 501 });
    routing.openPendingTap();
    assert.equal(w.navigation.navigations.length, 2, "a later delivery opens Profile again");
  });

  await test("tap: the tap that opened a closed app is read at start and opens Profile once the screens are up", async () => {
    const w = tw();
    w.notifications.coldTap("trial-ending", { kind: "trial_reminder" });
    const routing = w.routing();
    routing.startNotificationRouting();
    assert.deepEqual(w.navigation.navigations, []);
    w.navigation.signedOut();
    routing.openPendingTap();
    assert.deepEqual(w.navigation.navigations, [], "the sign-in screen has no Profile to open");
    w.navigation.signedIn();
    routing.openPendingTap();
    assert.deepEqual(w.navigation.navigations, [{ name: "MainTabs", params: { screen: "Profile" }, options: { pop: true } }]);
    assert.equal(w.notifications.state.lastResponse, null, "the last response is taken");
  });

  await test("tap: Expo Go's extra keys do not matter; other data and an affirmation tap are unchanged", async () => {
    const w = tw();
    const routing = w.routing();
    routing.startNotificationRouting();
    w.navigation.signedIn();
    w.notifications.tap("a", { data: { kind: "trial_reminder", experienceId: "@x/y", scopeKey: "k" }, date: 1 });
    assert.equal(w.navigation.navigations.length, 1);
    for (const [index, data] of [{}, { kind: "other" }, null].entries()) {
      w.notifications.tap(`b${index}`, { data, date: 10 + index });
    }
    assert.equal(w.navigation.navigations.length, 1, "other data opens nothing");
    // An affirmation tap is the existing rule: it needs the account, then opens its reflection with no navigate options.
    routing.setTapUser(W.sha16("user_a"));
    w.notifications.tap("aff-x", { data: { kind: "affirmation", entryId: "entry-1", slot: "morning", userHash: W.sha16("user_a") }, date: 99 });
    assert.deepEqual(w.navigation.navigations[1], { name: "Reflection", params: { entryId: "entry-1", tab: "affirmations" } });
  });
}

// ================================================================== the paywall hook
const OFFERING = {
  id: "default",
  packages: [
    { id: "$rc_annual", kind: "annual", productId: "gracehush_pro_yearly", priceString: "$125.99", price: 125.99, currencyCode: "USD", periodLabel: "year", pricePerMonthString: null, introOffer: { kind: "free_trial", periodDays: 3 } },
    { id: "$rc_monthly", kind: "monthly", productId: "gracehush_pro_monthly", priceString: "$14.99", price: 14.99, currencyCode: "USD", periodLabel: "month", pricePerMonthString: null, introOffer: null },
  ],
};
const SCHEDULED = { status: "scheduled", fireAt: FIRE, day: "Saturday, Nov 28" };

// The paywall hook on a tiny React, with stand-ins for everything that needs a phone: what the store sells, what a purchase answers,
// and the reminder service (the real service is checked above).
function hookWorld(overrides = {}) {
  const state = {
    offering: JSON.parse(JSON.stringify(OFFERING)),
    eligible: { $rc_annual: true, $rc_monthly: false },
    canOffer: true,
    purchase: { ok: true, tier: "trial", trialEndsAt: END },
    restore: { ok: true, restored: true, tier: "pro" },
    reminder: SCHEDULED,
    reminderThrows: false,
    gate: null,
    ...overrides,
  };
  const calls = { canOffer: 0, schedule: [], purchases: [], restores: 0, haptics: [], tracks: [] };
  const react = J.shared.react;
  const fakes = {
    react,
    "@react-navigation/native": { useFocusEffect: (effect) => react.useEffect(() => effect(), [effect]) },
    "@/data/journalRepository": {
      getUsage: async () => ({ tier: "free", used: 0, limit: 3, resetsAt: "2026-11-30T00:00:00.000Z" }),
      getEntry: async () => null,
    },
    "@/services/analytics": { __esModule: true, track: (...args) => void calls.tracks.push(args) },
    "@/services/haptics": { __esModule: true, haptics: { selection: () => void calls.haptics.push("selection") } },
    "@/services/purchases": {
      __esModule: true,
      getCurrentOffering: async () => state.offering,
      isTrialEligible: async (id) => state.eligible[id] === true,
      purchasePackage: async (id) => {
        calls.purchases.push(id);
        if (state.gate !== null) await state.gate;
        return state.purchase;
      },
      restorePurchases: async () => {
        calls.restores += 1;
        return state.restore;
      },
    },
    "@/services/trialReminder": {
      __esModule: true,
      canOfferTrialReminder: async () => {
        calls.canOffer += 1;
        return state.canOffer;
      },
      scheduleTrialReminder: async (endsAtMs, terms) => {
        calls.schedule.push([endsAtMs, terms]);
        if (state.reminderThrows) throw new Error("the phone refused");
        return state.reminder;
      },
    },
  };
  const env = J.makeEnv({ fakes });
  const { usePaywall } = env.use("@/hooks/usePaywall");
  const handle = J.shared.renderHook(usePaywall, undefined);
  return {
    state,
    calls,
    handle,
    now: () => handle.result.current,
    async ready() {
      await J.settle(3);
      assert.equal(handle.result.current.status, "ready");
      return handle.result.current;
    },
    async settle() {
      await J.settle(3);
      return handle.result.current;
    },
  };
}

async function hookChecks() {
  await test("paywall: the row is offered for a trial of three days or more on a phone that can be reminded, and follows the selected plan", async () => {
    const h = hookWorld();
    const s = await h.ready();
    assert.equal(s.selected.id, "$rc_annual");
    assert.deepEqual({ available: s.reminder.available, on: s.reminder.on }, { available: true, on: true });
    s.select("$rc_monthly");
    assert.equal((await h.settle()).reminder.available, false, "the monthly plan has no trial");
    h.now().select("$rc_annual");
    assert.equal((await h.settle()).reminder.available, true);
  });

  await test("paywall: not offered when the phone cannot be reminded, the trial is not confirmed, or it is under three days", async () => {
    const cannot = await hookWorld({ canOffer: false }).ready();
    assert.equal(cannot.reminder.available, false);

    const notEligible = hookWorld({ eligible: { $rc_annual: false, $rc_monthly: false } });
    assert.equal((await notEligible.ready()).reminder.available, false);
    assert.equal(notEligible.calls.canOffer, 0, "with no trial to sell the notification permission is not even read");

    const shortOffering = JSON.parse(JSON.stringify(OFFERING));
    shortOffering.packages[0].introOffer.periodDays = 2;
    assert.equal((await hookWorld({ offering: shortOffering }).ready()).reminder.available, false);
    const threeOffering = JSON.parse(JSON.stringify(OFFERING));
    threeOffering.packages[0].introOffer.periodDays = 3;
    assert.equal((await hookWorld({ offering: threeOffering }).ready()).reminder.available, true);

    // A trial that is bought where the switch was not offered (the state behind it still reads on) makes no reminder at all.
    for (const [name, overrides] of [
      ["a phone that cannot be reminded", { canOffer: false }],
      ["a trial the store did not confirm", { eligible: { $rc_annual: false, $rc_monthly: false } }],
    ]) {
      const bought = hookWorld(overrides);
      await (await bought.ready()).purchase();
      await bought.settle();
      assert.deepEqual(bought.calls.schedule, [], name);
      assert.deepEqual(bought.now(), { status: "done", tier: "trial", reminder: null }, name);
    }
  });

  await test("paywall: the switch starts on, and a change ticks the selection haptic once; setting the same value again does not", async () => {
    const h = hookWorld();
    const s = await h.ready();
    assert.equal(s.reminder.on, true);
    s.reminder.set(true);
    assert.deepEqual(h.calls.haptics, []);
    s.reminder.set(false);
    assert.equal((await h.settle()).reminder.on, false);
    h.now().reminder.set(false);
    assert.deepEqual(h.calls.haptics, ["selection"]);
    h.now().reminder.set(true);
    assert.equal((await h.settle()).reminder.on, true);
    assert.deepEqual(h.calls.haptics, ["selection", "selection"]);
  });

  await test("paywall: a trial purchase with the switch on schedules one reminder for the trial's end, and the done state carries its result", async () => {
    const h = hookWorld();
    const s = await h.ready();
    await s.purchase();
    await h.settle();
    assert.deepEqual(h.calls.purchases, ["$rc_annual"]);
    assert.deepEqual(h.calls.schedule, [[END, TERMS]]);
    assert.deepEqual(h.now(), { status: "done", tier: "trial", reminder: SCHEDULED });
  });

  await test("paywall: with the switch off no reminder is made, and the done state says none was", async () => {
    const h = hookWorld();
    const s = await h.ready();
    s.reminder.set(false);
    await h.settle();
    await h.now().purchase();
    await h.settle();
    assert.deepEqual(h.calls.schedule, []);
    assert.deepEqual(h.now(), { status: "done", tier: "trial", reminder: null });
  });

  await test("paywall: a plan with no trial, a purchase with no end time, a failed or cancelled purchase and a restore schedule nothing", async () => {
    // Monthly: no trial, the row is not offered, and the purchase is Pro.
    const monthly = hookWorld({ purchase: { ok: true, tier: "pro", trialEndsAt: null } });
    (await monthly.ready()).select("$rc_monthly");
    await monthly.settle();
    await monthly.now().purchase();
    await monthly.settle();
    assert.deepEqual(monthly.calls.schedule, []);
    assert.deepEqual(monthly.now(), { status: "done", tier: "pro", reminder: null });

    // A trial the store gave no end time for: nothing to remind about.
    const noEnd = hookWorld({ purchase: { ok: true, tier: "trial" } });
    await (await noEnd.ready()).purchase();
    await noEnd.settle();
    assert.deepEqual(noEnd.calls.schedule, []);
    assert.deepEqual(noEnd.now(), { status: "done", tier: "trial", reminder: null });

    // A cancelled purchase and a failed one.
    for (const code of ["CANCELLED", "NETWORK"]) {
      const failed = hookWorld({ purchase: { ok: false, code, message: "x" } });
      await (await failed.ready()).purchase();
      await failed.settle();
      assert.deepEqual(failed.calls.schedule, [], code);
      assert.equal(failed.now().status, "ready", code);
    }

    // Restore, from the header and after an "already owned" purchase.
    const restored = hookWorld({ restore: { ok: true, restored: true, tier: "trial" } });
    await (await restored.ready()).restore();
    await restored.settle();
    assert.deepEqual(restored.calls.schedule, []);
    assert.deepEqual(restored.now(), { status: "done", tier: "trial", reminder: null });
    const owned = hookWorld({ purchase: { ok: false, code: "ALREADY_OWNED", message: "" }, restore: { ok: true, restored: true, tier: "trial" } });
    await (await owned.ready()).purchase();
    await owned.settle();
    assert.deepEqual(owned.calls.schedule, []);
    assert.deepEqual(owned.now(), { status: "done", tier: "trial", reminder: null });
  });

  await test("paywall: a reminder that fails or throws leaves the purchase done, with the failure to say", async () => {
    const refused = hookWorld({ reminder: { status: "denied" } });
    await (await refused.ready()).purchase();
    await refused.settle();
    assert.deepEqual(refused.now(), { status: "done", tier: "trial", reminder: { status: "denied" } });

    const thrown = hookWorld({ reminderThrows: true });
    await (await thrown.ready()).purchase();
    await thrown.settle();
    assert.deepEqual(thrown.now(), { status: "done", tier: "trial", reminder: { status: "failed" } });
  });

  await test("paywall: a purchase that finishes after the screen closed still sets the reminder the person asked for", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const h = hookWorld({ gate });
    const s = await h.ready();
    const pending = s.purchase();
    await h.settle();
    h.handle.unmount();
    release();
    await pending;
    await J.settle(3);
    assert.deepEqual(h.calls.schedule, [[END, TERMS]]);
    assert.ok(h.calls.tracks.some(([name]) => name === "purchase_completed"), "the purchase is still reported");
  });

  await test("paywall: a second purchase press while one runs does nothing, so one reminder at most", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const h = hookWorld({ gate });
    const s = await h.ready();
    const first = s.purchase();
    const second = h.now().purchase();
    release();
    await Promise.all([first, second]);
    await h.settle();
    assert.deepEqual(h.calls.purchases, ["$rc_annual"]);
    assert.deepEqual(h.calls.schedule, [[END, TERMS]]);
  });

  await test("paywall: the reminder's price and period are the bought package's own, as the store wrote them", async () => {
    // The yearly plan, with a price string as another store would write it.
    const euro = JSON.parse(JSON.stringify(OFFERING));
    euro.packages[0].priceString = "125,99 €";
    const yearly = hookWorld({ offering: euro });
    await (await yearly.ready()).purchase();
    await yearly.settle();
    assert.deepEqual(yearly.calls.schedule, [[END, { price: "125,99 €", period: "year" }]]);

    // A monthly plan that has a trial: the price and the period are that package's.
    const monthlyTrial = JSON.parse(JSON.stringify(OFFERING));
    monthlyTrial.packages[1].introOffer = { kind: "free_trial", periodDays: 7 };
    const monthly = hookWorld({ offering: monthlyTrial, eligible: { $rc_annual: true, $rc_monthly: true } });
    (await monthly.ready()).select("$rc_monthly");
    await monthly.settle();
    await monthly.now().purchase();
    await monthly.settle();
    assert.deepEqual(monthly.calls.schedule, [[END, { price: "$14.99", period: "month" }]]);
  });
}

// ================================================================== the shipped files
async function sourceChecks() {
  await test("screen: the row sits under the plans in the scrolling page, only when it is offered, and never in the pinned block", async () => {
    const screen = read("src/screens/paywall/PaywallScreen.tsx").replace(/\r\n/g, "\n");
    const radiogroup = screen.indexOf('accessibilityRole="radiogroup"');
    const row = screen.indexOf("<TrialReminderRow");
    const pinnedFooter = screen.indexOf("{pinned ? null : footer}");
    const pinnedBlock = screen.indexOf('<View className="pb-2">');
    assert.ok(radiogroup > 0 && row > radiogroup, "the row comes after the plan list");
    assert.ok(row < pinnedFooter, "the row is part of the scrolling content");
    assert.ok(row < pinnedBlock, "the row is not in the pinned block");
    assert.ok(/state\.reminder\.available\s*\?/.test(screen), "it is drawn only when offered");
    const element = screen.slice(row, screen.indexOf("/>", row) + 2);
    assert.ok(element.includes("value={state.reminder.on}") && element.includes("onChange={state.reminder.set}"), "the row shows and changes the hook's switch");
    assert.ok(element.includes("disabled={busy}"), "the row itself is disabled while a purchase or restore runs");
    assert.ok(/state\.reminder/.test(screen) && screen.includes("paywall.reminder"), "the done view says what happened to the reminder");
  });

  await test("row: a switch row like the prayer request's: the whole row is the touch target, the Switch is a hidden picture of the state", async () => {
    const row = read("src/components/paywall/TrialReminderRow.tsx").replace(/\r\n/g, "\n");
    assert.ok(row.includes('accessibilityRole="switch"'));
    assert.ok(row.includes("accessibilityState={{ checked: value, disabled }}") || /accessibilityState=\{\{\s*checked: value,\s*disabled/.test(row));
    assert.ok(row.includes("accessibilityLabel={reminder.title}") && row.includes("accessibilityHint={reminder.detail}"));
    assert.ok(row.includes("accessibilityElementsHidden") && row.includes('importantForAccessibility="no-hide-descendants"') && row.includes('pointerEvents="none"'));
    assert.ok(row.includes("<Switch") && row.includes("trackColor={{ false: colors.petal, true: colors.plum }}"));
    assert.ok(/ios:\s*"bell"/.test(row) && /android:\s*"notifications"/.test(row), "the bell, as Profile's affirmations row");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(row.replace(/\/\/.*$/gm, "")), "no raw colour");
    assert.ok(!row.includes("haptics"), "the haptic is the hook's, once per change");
  });

  await test("sign-out: the reminder is cleared right after the affirmations and before the plan watch stops", async () => {
    const account = read("src/services/account.ts").replace(/\r\n/g, "\n");
    assert.ok(account.includes('import { clearTrialReminder } from "@/services/trialReminder";'));
    const affirmations = account.indexOf("await clearAffirmations();");
    const trial = account.indexOf("await clearTrialReminder();");
    // deleteAccount also stops the plan watch, earlier in the file: the one that matters is the first after the trial clear.
    const watch = account.indexOf("stopPlanWatch();", trial);
    assert.ok(affirmations > 0 && trial > affirmations && watch > trial, "clearAffirmations, then clearTrialReminder, then stopPlanWatch");
  });

  await test("plan watch: the trial is reconciled for the signed-in account on RevenueCat's answer, on the real data source only, and stopped with the watch", async () => {
    const sync = read("src/services/subscriptionSync.ts").replace(/\r\n/g, "\n");
    assert.ok(sync.includes('import { reconcileTrialReminder } from "@/services/trialReminder";'));
    assert.ok(sync.includes("reconcileTrialReminder(state.trial)"));
    const reconcile = sync.slice(sync.indexOf("const reconcile"), sync.indexOf("const reconcile") + 700);
    assert.ok(reconcile.includes('getDataSource() !== "supabase"'), "the mock data source never reaches it");
    assert.ok(reconcile.includes("state.userId !== userId") && reconcile.includes("state.checkedAt === null"), "another account's answer, or none yet, does nothing");
    assert.ok(sync.includes("stopTrial()"), "unsubscribed with the watch");
  });

  await test("store: the entitlement carries the trial, and an answer for another account is still dropped", async () => {
    const w = W.world();
    const store = w.use("@/store/entitlementStore").useEntitlementStore;
    store.getState().start("user_a", "test");
    store.getState().setEntitlement("user_a", "trial", null, { endsAt: END, willRenew: true });
    assert.deepEqual(store.getState().trial, { endsAt: END, willRenew: true });
    store.getState().setEntitlement("user_a", "pro", null);
    assert.equal(store.getState().trial, null, "a call without a trial clears it");
    store.getState().setEntitlement("user_b", "trial", null, { endsAt: END, willRenew: true });
    assert.equal(store.getState().trial, null, "another account's answer is dropped");
    store.getState().setEntitlement("user_a", "trial", null, { endsAt: END, willRenew: false });
    store.getState().start("user_c", "test");
    assert.equal(store.getState().trial, null, "a new account starts from nothing known");
    store.getState().setEntitlement("user_c", "trial", null, { endsAt: END, willRenew: true });
    store.getState().clear();
    assert.equal(store.getState().trial, null);
  });

  await test("copy: the reminder's words use curly punctuation and type no price of their own, and the paywall's lines are the ones the screen reads", async () => {
    const { copy } = W.world().use("@/constants/copy");
    // One body for both platforms: a title and a body, nothing per store.
    assert.deepEqual(Object.keys(copy.notifications.trialEnding).sort(), ["body", "title"]);
    const priced = copy.notifications.trialEnding.body("PRICE", "year");
    assert.ok(priced.includes("PRICE"), "the price in the words is the one handed over");
    const all = [
      copy.notifications.trialEnding.title("Monday"),
      priced,
      copy.paywall.reminder.title,
      copy.paywall.reminder.detail,
      copy.paywall.reminder.scheduled("Saturday, Nov 28"),
      copy.paywall.reminder.denied,
      copy.paywall.reminder.failed,
    ];
    for (const text of all) {
      assert.ok(typeof text === "string" && text.length > 0);
      assert.ok(!text.includes("'") && !text.includes("..."), text);
      assert.ok(!/[$€£¥]/.test(text), `a price typed into the copy: ${text}`);
    }
    assert.equal(copy.paywall.reminder.title, "Remind me before my trial ends");
    assert.equal(copy.paywall.reminder.detail, "One notification, about two days before it ends.");
    assert.equal(copy.paywall.reminder.scheduled("Saturday, Nov 28"), "We’ll remind you on Saturday, Nov 28, before your trial ends.");
    assert.equal(copy.paywall.reminder.denied, "Notifications are off for GraceHush, so we couldn’t set a reminder.");
    assert.equal(copy.paywall.reminder.failed, "We couldn’t set the reminder.");
  });

  await test("dev panel: a Trial reminder group with a ten-second test and a clear", async () => {
    const panel = read("src/components/dev/DevToolsPanel.tsx");
    assert.ok(panel.includes("Trial reminder (dev)"));
    assert.ok(panel.includes("scheduleTestTrialReminder") && panel.includes("clearTrialReminder"));
    assert.ok(panel.includes("await getCurrentOffering()"), "the test reads its terms from the current offering");
    assert.ok(/scheduleTestTrialReminder\(\{ price: pkg\.priceString, period: pkg\.periodLabel \}, 10_000\)/.test(panel), "with the package's own price string and period");
  });

  await test("constants: the reminder's four numbers", async () => {
    const app = read("src/constants/app.ts");
    assert.ok(/TRIAL_REMINDER_DAYS_BEFORE = 2;/.test(app));
    assert.ok(/TRIAL_REMINDER_AT = "10:00";/.test(app));
    assert.ok(/TRIAL_REMINDER_MIN_LEAD_MS = 10_000;/.test(app));
    assert.ok(/TRIAL_REMINDER_MIN_TRIAL_DAYS = 3;/.test(app));
  });

  await test("service: the only code that schedules the trial reminder imports no expo-notifications and no analytics, and logs nothing in release", async () => {
    const service = read("src/services/trialReminder.ts");
    assert.ok(!/from "expo-notifications"|require\("expo-notifications"\)/.test(service), "expo-notifications stays in services/notifications.ts");
    assert.ok(!/analytics|haptics/.test(service), "no event and no haptic");
    for (const line of service.split("\n").filter((l) => l.includes("console."))) assert.ok(line.includes("__DEV__") || /\bwarn\(/.test(line), line);
    assert.ok(!service.includes("cancelAllScheduledNotificationsAsync") && !service.includes("dismissAllNotificationsAsync"));
  });
}

(async () => {
  await planChecks();
  await textChecks();
  await serviceChecks();
  await tapChecks();
  await hookChecks();
  await sourceChecks();
  finished = true;
  if (failures.length === 0) {
    fs.writeSync(1, `${passed} checks passed${String.fromCharCode(10)}`);
  } else {
    fs.writeSync(1, `${passed} checks passed, ${failures.length} FAILED:${String.fromCharCode(10)}${String.fromCharCode(10)} - ${failures.join(`${String.fromCharCode(10)} - `)}${String.fromCharCode(10)}`);
    process.exitCode = 1;
  }
})();
