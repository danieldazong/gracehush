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

Deno.test("a crisis row never returns affirmations, even if rows exist", () => {
  const crisis = cases[2];
  assertEquals(toResponse(crisis.row, cases[0].affirmations).affirmations, []);
});
