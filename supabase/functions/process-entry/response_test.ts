import { assert, assertEquals } from "./testing/assert.ts";
import { toResponse } from "./response.ts";
import type { AffirmationRow, EntryRow } from "./lifecycle.ts";

// The same fixtures are read by supabase/tests/process-entry/parity.cjs, which runs the app's own mapper on them.
// Both must give the expected response, so the function and the app cannot drift apart unnoticed.
type Case = { name: string; row: EntryRow; affirmations: AffirmationRow[]; expected: unknown };
const cases: Case[] = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/parity.json", import.meta.url)));

Deno.test("there are fixtures to compare", () => {
  assert(cases.length >= 6);
});

for (const fixture of cases) {
  Deno.test(`the response for: ${fixture.name}`, () => {
    assertEquals(toResponse(fixture.row, fixture.affirmations), fixture.expected);
  });
}

Deno.test("affirmations come back in the order of the day, whatever order the database gives", () => {
  const ready = cases[0];
  const shuffled = [ready.affirmations[2], ready.affirmations[0], ready.affirmations[1]];
  assertEquals(toResponse(ready.row, shuffled).affirmations.map((item) => item.slot), [
    "morning",
    "afternoon",
    "evening",
  ]);
});

Deno.test("a heavy moment's row returns its affirmations like any other (gen-v2.4)", () => {
  const heavy = cases.find((item) => item.row.is_crisis && item.row.devotional_script !== null);
  assert(heavy !== undefined, "there is a fixture of a whole heavy moment");
  assertEquals(toResponse(heavy.row, heavy.affirmations).affirmations.length, 3);
  // One saved before 2026-11-08 has none, so none come back.
  assertEquals(toResponse(cases[2].row, []).affirmations, []);
});
