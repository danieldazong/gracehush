// Contract parity (step 19): the app's own mapper against the fixtures the process-entry function is tested with.
//
// process-entry returns a ProcessEntryResponse built from the saved row (supabase/functions/process-entry/response.ts),
// and step 25 shows that entry without reading it back. So it has to be exactly what the app's toJournalEntry and
// toAffirmation (src/data/mappers.ts) make of the same row. response_test.ts checks the function against
// fixtures/parity.json; this checks the app against the same file. If either side changes, one of the two fails.
//
//   node supabase/tests/process-entry/parity.cjs       (from the repo root; a few seconds, no network)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeEnv } = require("../profile-sync/loader.cjs");

const fixturesPath = path.join(__dirname, "..", "..", "functions", "process-entry", "fixtures", "parity.json");
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
const { toJournalEntry, toAffirmation } = makeEnv().use("@/data/mappers");

let passed = 0;
const failures = [];
for (const fixture of fixtures) {
  try {
    assert.deepStrictEqual(toJournalEntry(fixture.row), fixture.expected.entry);
    // The repository returns no affirmations for a crisis entry, even if rows exist.
    const affirmations = fixture.row.is_crisis ? [] : fixture.affirmations.map(toAffirmation);
    assert.deepStrictEqual(affirmations, fixture.expected.affirmations);
    passed += 1;
  } catch (error) {
    failures.push(`${fixture.name}\n      ${String(error.message).split("\n").slice(0, 12).join("\n      ")}`);
  }
}

console.log(`${passed} of ${fixtures.length} fixtures match the app's mapper`);
if (failures.length > 0) {
  console.log(failures.map((failure) => `  FAIL ${failure}`).join("\n"));
  process.exit(1);
}
