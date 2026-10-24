import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { FREE_DEVOTIONALS_PER_WEEK, WEEK_STARTS_ON } from "./constants.ts";
import { weekWindow } from "./weekly.ts";

const iso = (date: Date) => date.toISOString().replace(".000Z", "Z");
const window = (now: string, zone: string, weekStartsOn?: number) => {
  const found = weekWindow(new Date(now), zone, weekStartsOn);
  return { start: iso(found.start), end: iso(found.end), zone: found.zone, fallback: found.zoneFallback };
};

Deno.test("the two numbers that the app mirrors", () => {
  assertEquals([FREE_DEVOTIONALS_PER_WEEK, WEEK_STARTS_ON], [3, 1]);
});

Deno.test("UTC: a Friday belongs to the week that began on Monday 00:00", () => {
  assertEquals(window("2026-10-23T15:00:00Z", "UTC"), {
    start: "2026-10-19T00:00:00Z",
    end: "2026-10-26T00:00:00Z",
    zone: "UTC",
    fallback: false,
  });
  // The first instant of a week is in that week, and one millisecond earlier is in the week before.
  assertEquals(window("2026-10-26T00:00:00Z", "UTC").start, "2026-10-26T00:00:00Z");
  assertEquals(iso(weekWindow(new Date("2026-10-25T23:59:59.999Z"), "UTC").start), "2026-10-19T00:00:00Z");
});

Deno.test("Lagos (UTC+1) starts its Monday an hour before UTC does", () => {
  assertEquals(window("2026-10-23T15:00:00Z", "Africa/Lagos").start, "2026-10-18T23:00:00Z");
});

Deno.test("New York across the spring-forward Sunday: the week of the change is 167 hours", () => {
  // Clocks went forward at 02:00 on Sunday 2026-03-08 (07:00 UTC). It is Sunday 08:00 EDT at 12:00 UTC.
  const during = window("2026-03-08T12:00:00Z", "America/New_York");
  assertEquals(during.start, "2026-03-02T05:00:00Z"); // Monday 00:00 EST
  assertEquals(during.end, "2026-03-09T04:00:00Z"); // Monday 00:00 EDT
  assertEquals((Date.parse(during.end) - Date.parse(during.start)) / 3_600_000, 167);
  // The first Monday after it.
  assertEquals(window("2026-03-09T05:00:00Z", "America/New_York"), {
    start: "2026-03-09T04:00:00Z",
    end: "2026-03-16T04:00:00Z",
    zone: "America/New_York",
    fallback: false,
  });
  // 03:59 UTC on that Monday is still Sunday 23:59 EDT: the old week.
  assertEquals(window("2026-03-09T03:59:00Z", "America/New_York").start, "2026-03-02T05:00:00Z");
});

Deno.test("New York across the fall-back Sunday: the week of the change is 169 hours", () => {
  const during = window("2026-11-01T12:00:00Z", "America/New_York");
  assertEquals(during.start, "2026-10-26T04:00:00Z"); // Monday 00:00 EDT
  assertEquals(during.end, "2026-11-02T05:00:00Z"); // Monday 00:00 EST
  assertEquals((Date.parse(during.end) - Date.parse(during.start)) / 3_600_000, 169);
});

Deno.test("UTC+13 (Auckland in summer), UTC+14 (Kiritimati) and UTC-11 (Pago Pago)", () => {
  // Sunday 23:00 in Auckland: the week that began on Monday 2026-11-30 00:00 NZDT is nearly over.
  assertEquals(window("2026-12-06T10:00:00Z", "Pacific/Auckland"), {
    start: "2026-11-29T11:00:00Z",
    end: "2026-12-06T11:00:00Z",
    zone: "Pacific/Auckland",
    fallback: false,
  });
  assertEquals(window("2026-12-06T11:00:00Z", "Pacific/Auckland").start, "2026-12-06T11:00:00Z");
  // Kiritimati is 14 hours ahead: Monday 2026-06-01 00:00 there is Sunday 10:00 UTC.
  assertEquals(window("2026-06-01T00:00:00Z", "Pacific/Kiritimati").start, "2026-05-31T10:00:00Z");
  // Pago Pago is 11 hours behind: still Sunday there at 10:59:59 UTC on Monday.
  assertEquals(window("2026-06-01T10:59:59Z", "Pacific/Pago_Pago").start, "2026-05-25T11:00:00Z");
  assertEquals(window("2026-06-01T11:00:00Z", "Pacific/Pago_Pago").start, "2026-06-01T11:00:00Z");
});

Deno.test("a zone Intl does not know is read as UTC, and says so", () => {
  for (const zone of ["Mars/Phobos", "", "not a zone", "UTC+1"]) {
    const found = window("2026-10-23T15:00:00Z", zone);
    assertEquals([found.start, found.zone, found.fallback], ["2026-10-19T00:00:00Z", "UTC", true], zone);
  }
  assertEquals(window("2026-10-23T15:00:00Z", "UTC").fallback, false);
});

Deno.test("midnight that does not exist, and midnight that happens twice (Havana, weeks that start on Sunday)", () => {
  // Cuba's clocks jump from 00:00 to 01:00 on Sunday 2026-03-08: that Sunday starts when the clocks land, 05:00 UTC.
  assertEquals(window("2026-03-10T12:00:00Z", "America/Havana", 0).start, "2026-03-08T05:00:00Z");
  // They go back from 01:00 to 00:00 on Sunday 2026-11-01, so 00:00 comes twice: the earlier counts (04:00 UTC).
  assertEquals(window("2026-11-03T12:00:00Z", "America/Havana", 0).start, "2026-11-01T04:00:00Z");
});

// The local weekday and clock of an instant, written independently of the code under test.
function clock(instant: Date, zone: string): { weekday: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: get("weekday"), time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Africa/Lagos",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe", // a 30-minute daylight-saving change
  "Pacific/Auckland",
  "Pacific/Apia",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
  "America/St_Johns",
  "America/Sao_Paulo",
  "America/Havana",
  "America/Santiago",
  "Asia/Beirut",
  "Africa/Cairo",
];

Deno.test("for 18 zones over two years: every instant is in its week, weeks tile, and a week starts on a local Monday", () => {
  // Intl is slow (about 40 microseconds a call and about 55 calls per instant here), so the sweep is chosen, not dense:
  // every week that holds a daylight-saving change is checked in full, with the minutes and hours around its Monday
  // start; the ordinary weeks are sampled, and a spread of instants across the two years covers the rest.
  const HOUR = 3_600_000;
  const WEEK = 7 * 24 * HOUR;
  const from = Date.parse("2026-01-01T00:00:00Z");
  const to = Date.parse("2028-01-01T00:00:00Z");
  let checked = 0;
  let irregular = 0;
  for (const zone of ZONES) {
    const instants: number[] = [];
    for (let t = from; t < to; t += 13 * 24 * HOUR + 5 * HOUR + 11 * 60_000) instants.push(t);
    let weekNumber = 0;
    for (let t = from; t < to; t += WEEK) {
      const week = weekWindow(new Date(t), zone);
      const start = week.start.getTime();
      if (week.end.getTime() - start !== WEEK) {
        irregular += 1;
        for (const offset of [-2 * HOUR, -HOUR, -60_000, -1, 0, 1, 60_000, HOUR, 2 * HOUR]) {
          instants.push(start + offset);
        }
      } else if (weekNumber % 8 === 0) {
        for (const offset of [-1, 0]) instants.push(start + offset);
      }
      weekNumber += 1;
    }
    for (const t of instants) {
      const here = new Date(t);
      const week = weekWindow(here, zone);
      const label = `${zone} ${here.toISOString()}`;
      assert(week.start.getTime() <= t && t < week.end.getTime(), `${label}: not inside its own week`);
      assert(!week.zoneFallback && week.zone === zone, `${label}: the zone was not used`);

      // The next week begins where this one ends, and the week before ends where this one begins.
      assertEquals(iso(weekWindow(week.start, zone).start), iso(week.start), `${label}: start is not stable`);
      assertEquals(iso(weekWindow(week.start, zone).end), iso(week.end), `${label}: end moves with start`);
      assertEquals(iso(weekWindow(new Date(week.end.getTime() - 1), zone).start), iso(week.start), `${label}: end - 1`);
      assertEquals(iso(weekWindow(week.end, zone).start), iso(week.end), `${label}: end is the next start`);
      assertEquals(iso(weekWindow(new Date(week.start.getTime() - 1), zone).end), iso(week.start), `${label}: before`);

      // A week starts on a local Monday at 00:00:00 (these zones have no midnight gap on a Monday).
      const local = clock(week.start, zone);
      assertEquals([local.weekday, local.time], ["Mon", "00:00:00"], `${label}: start is not Monday 00:00`);

      // A week is 7 days, give or take the daylight-saving change inside it (at most 2 hours).
      const hours = (week.end.getTime() - week.start.getTime()) / HOUR;
      assert(Math.abs(hours - 168) <= 2, `${label}: a week of ${hours} hours`);
      checked += 1;
    }
  }
  // 14 of the 18 zones change their clocks (UTC, Lagos, Kolkata and the like do not): a few weeks a year each.
  assert(irregular >= 40, `only ${irregular} weeks with a clock change were found`);
  assert(checked > 1_500, `only ${checked} instants were checked`);
});
