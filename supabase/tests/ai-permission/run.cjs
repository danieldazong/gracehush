// The AI permission checks (Apple's guideline 5.1.2(i), 2026-11-03): nothing a person says or writes leaves the phone until that
// account has allowed it. They run the app's real permission service, profile store, outbox and sync engine with the real
// supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs), and read the screens' source for what a
// plain Node run cannot draw. Every check ends by asserting that nothing the database refuses was sent and that the development
// log holds no word, id or token.
//
//   node --no-warnings supabase/tests/ai-permission/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/ai-permission/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  serverRow,
  settle,
  advance,
  clock,
  BASE,
  installClock,
  uninstallClock,
  installVirtualDate,
  uninstallVirtualDate,
} = W;

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
const CHECK_LIMIT_MS = 20000;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

let passed = 0;
const failures = [];
let finished = false;
let stopped = false;

const WORDS = "the words of this prayer stay on the phone";
const FORBIDDEN_IN_LOGS = [WORDS, "tokA", "tokB", "user_a", "user_b", "c-held", "/raw/"];

async function test(name, run) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  installClock();
  installVirtualDate();
  clock.now = BASE;
  const w = makeLiveWorld({ aiPermission: "real" });
  let limit;
  try {
    await w.signIn();
    await Promise.race([
      run(w),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished")), CHECK_LIMIT_MS);
      }),
    ]);
    assert.deepEqual(w.server.state.violations, [], "the app sent something the database or AGENTS.md refuses");
    for (const line of w.logs) {
      for (const word of FORBIDDEN_IN_LOGS) {
        assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
      }
    }
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    w.close();
    uninstallVirtualDate();
    uninstallClock();
  }
}

function sourceCheck(name, run) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  try {
    run();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 5).join("\n    ")}`);
  }
}

// ------------------------------------------------------------------ helpers
const text = (id, words = WORDS) => ({ clientEntryId: id, inputType: "text", text: words });
const audio = (id) => ({ clientEntryId: id, inputType: "audio", durationMs: 20000, mimeType: "audio/mp4" });
const processCalls = (w) => w.server.state.requests.filter((r) => r.path === "/functions/v1/process-entry");
const engine = (w) => w.use("@/services/syncEngine");
const outbox = (w) => w.use("@/db/outbox");
const service = (w) => w.use("@/services/aiPermission");
const prefs = (w) => w.use("@/store/profilePrefsStore").useProfilePrefsStore;
const allow = (w, id = "user_a") => prefs(w).getState().setAiPermission(id, new Date(clock.now).toISOString());
const withdraw = (w, id = "user_a") => prefs(w).getState().setAiPermission(id, null);
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

async function main() {
  await test("engine: with no permission a written reflection stays on this phone, and nothing is sent", async (w) => {
    await w.startEngine();
    await outbox(w).enqueue(text("c-held"));
    await engine(w).syncNow("submit");
    await settle(6);
    assert.equal(processCalls(w).length, 0, "no request to process-entry");
    const item = await outbox(w).get("c-held");
    assert.equal(item.status, "queued", "still waiting");
    assert.equal(item.attempts, 0, "never tried");
    assert.equal(item.text, WORDS, "the words are kept");
  });

  await test("engine: with no permission a recording is not uploaded", async (w) => {
    await w.startEngine();
    await outbox(w).enqueue(audio("c-held"));
    await engine(w).syncNow("submit");
    await settle(6);
    assert.equal(w.upload.calls.length, 0, "no upload");
    assert.equal(processCalls(w).length, 0, "no request");
  });

  await test("engine: allowing it sends what was waiting, once, with the same id", async (w) => {
    await w.startEngine();
    await outbox(w).enqueue(text("c-held"));
    await engine(w).syncNow("submit");
    await settle(4);
    assert.equal(processCalls(w).length, 0);
    allow(w);
    const wait = engine(w).syncAndWait("c-held", { waitMs: 60_000 });
    await engine(w).syncNow("permission");
    assert.equal((await wait).kind, "ready");
    assert.equal(processCalls(w).length, 1, "sent once");
    assert.equal(await outbox(w).get("c-held"), null, "and gone from the outbox");
  });

  await test("engine: withdrawing it holds the next reflection, and a prayer change still goes", async (w) => {
    allow(w);
    await w.startEngine();
    await settle(2);
    withdraw(w);
    w.server.state.entries.push(serverRow(1));
    const { toJournalEntry } = w.use("@/data/mappers");
    await w.use("@/db/cache").upsertEntry(toJournalEntry(serverRow(1)));
    await outbox(w).enqueue(text("c-held"));
    const change = await w.use("@/data/journalRepository").setPrayerTracked(serverRow(1).id, true);
    assert.equal(change.ok, true);
    await engine(w).syncNow("mutation");
    await settle(8);
    assert.equal(processCalls(w).length, 0, "the reflection is held");
    assert.equal(await w.use("@/db/mutations").countMutations(), 0, "the prayer change was sent: it goes to no AI");
    assert.equal((await outbox(w).get("c-held")).status, "queued");
  });

  await test("engine: while it holds a reflection it does not wake itself up in a loop", async (w) => {
    await w.startEngine();
    await outbox(w).enqueue(text("c-held"));
    const past = clock.now - 60_000;
    await outbox(w).markQueued("c-held", past, "NETWORK", past);
    await engine(w).syncNow("submit");
    await settle(4);
    const before = w.logs.filter((line) => line.includes("run (timer)")).length;
    await advance(10 * 60 * 1000);
    await settle(4);
    assert.equal(w.logs.filter((line) => line.includes("run (timer)")).length, before, "no timer runs for a held reflection");
    assert.equal(processCalls(w).length, 0);
  });

  await test("account: one account's permission is not another's, and signing out keeps it", async (w) => {
    const { setSupabaseSession } = w.use("@/services/supabaseClient");
    assert.equal(service(w).hasAiPermission(), false, "nobody has answered");
    allow(w);
    assert.equal(service(w).hasAiPermission(), true);
    setSupabaseSession({ userId: "user_b", getToken: async () => "tokB" });
    assert.equal(service(w).hasAiPermission(), false, "the second account has not answered");
    setSupabaseSession(null);
    assert.equal(service(w).hasAiPermission(), false, "nobody signed in: nothing may be sent");
    setSupabaseSession({ userId: "user_a", getToken: async () => "tokA" });
    assert.equal(service(w).hasAiPermission(), true, "the first account's answer is still there after a sign-out");
  });

  await test("store: a damaged saved value means no permission, and deleting the account forgets it", async (w) => {
    const store = prefs(w);
    const merge = store.persist.getOptions().merge;
    const merged = merge(
      {
        byUser: {
          a: { unsent: {}, snapshot: null, aiPermissionAt: "not a date" },
          b: { unsent: {}, snapshot: null, aiPermissionAt: 12 },
          c: { unsent: {}, snapshot: null },
          d: { unsent: {}, snapshot: null, aiPermissionAt: "2026-11-03T10:00:00.000Z" },
        },
      },
      store.getState(),
    );
    assert.equal(merged.byUser.a.aiPermissionAt, null);
    assert.equal(merged.byUser.b.aiPermissionAt, null);
    assert.equal(merged.byUser.c.aiPermissionAt, null, "a save from before this step");
    assert.equal(merged.byUser.d.aiPermissionAt, "2026-11-03T10:00:00.000Z");
    allow(w);
    assert.equal(service(w).hasAiPermission(), true);
    store.getState().forgetUser("user_a");
    assert.equal(service(w).hasAiPermission(), false);
  });

  await test("store: the other writes keep the answer", async (w) => {
    const store = prefs(w);
    allow(w);
    const at = store.getState().byUser.user_a.aiPermissionAt;
    store.getState().saveUnsent("user_a", { ambientSound: "soft-rain" });
    store.getState().clearUnsent("user_a", { ambientSound: "soft-rain" });
    store.getState().saveSnapshot("user_a", store.getState().byUser.user_a.snapshot);
    assert.equal(store.getState().byUser.user_a.aiPermissionAt, at);
  });

  await test("copy: the sheet names Google and the AI, says what is sent, answers the training worry and stays short", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const sheet = copy.aiPermission;
    const face = [sheet.title, sheet.body, sheet.trust, sheet.caption].join(" ");
    const all = [
      face,
      sheet.allow,
      sheet.notNow,
      sheet.learnMore,
      sheet.showLess,
      sheet.privacy,
      ...sheet.details.flatMap((row) => [row.label, row.body]),
    ].join(" ");
    // What Apple's reviewers look for: what is sent, who gets it, and the permission asked before anything goes.
    for (const word of ["Google", "AI", "Gemini", "text-to-speech", "recording", "words", "devotional"]) {
      assert.ok(face.includes(word), `the face of the sheet must say "${word}"`);
    }
    assert.ok(sheet.title.includes("Google") && sheet.title.includes("AI"), "the question itself names Google's AI");
    assert.ok(sheet.title.startsWith("Allow ") && sheet.title.endsWith("?"), "and it is an explicit question");
    assert.equal(sheet.allow, "Allow");
    assert.equal(sheet.notNow, "Not now");
    assert.equal(sheet.caption, "Nothing is sent until you tap Allow.");
    // Apple's guidance on AI: say plainly whether it is used for training. The Privacy Policy says the same (checked below).
    assert.ok(sheet.trust.includes("We don\u2019t train AI on them"), "the face answers the training worry");
    assert.ok(
      sheet.trust.includes("Google\u2019s paid terms") && sheet.trust.includes("improve its products"),
      "and says what Google's terms say, in Google's words",
    );
    // One tap away, nothing hidden: what Google keeps, why it is asked, where to change it.
    for (const word of ["extra care", "Profile", "misuse", "limited time"]) {
      assert.ok(all.includes(word), `the details must say "${word}"`);
    }
    assert.equal(sheet.details.length, 3);
    // The point of the redesign: the page it replaces was 103 words and read like a wall.
    const faceWords = face.split(/\s+/).filter(Boolean).length;
    assert.ok(faceWords <= 55, `the face must stay short, it is ${faceWords} words`);
    for (const word of ["confidential", "secure", "encrypted", "guarantee", "never stored", "safe", "free"]) {
      assert.ok(!all.toLowerCase().includes(word), `the sheet must not claim "${word}"`);
    }
    const texts = [all, copy.journal.notes.permission, copy.journal.card.pendingPermission, copy.profile.aiPermission.title, copy.profile.aiPermission.on, copy.profile.aiPermission.off].join(" ");
    assert.ok(!texts.includes("'"), "curly apostrophes only");
    assert.ok(!texts.includes('"'), "curly quotes only");
    assert.ok(!copy.journal.notes.permission.toLowerCase().includes("crisis"), "the note says nothing about a crisis");
  });

  // ---------------------------------------------------------------- what plain Node cannot draw
  sourceCheck("New Entry: nothing can be said or written until the person has answered", () => {
    const screen = read("src/screens/journal/NewEntryScreen.tsx");
    assert.ok(!screen.includes("if (!allowed) {"), "no early return: the screen is drawn and the sheet covers it");
    assert.match(screen, /\{allowed \? null : \(\s*<AiPermissionSheet/, "the sheet covers the screen until the person has answered");
    assert.ok(
      screen.indexOf("<AiPermissionSheet") > screen.lastIndexOf("<ConfirmDialog"),
      "the last thing the screen draws, so above all of it",
    );
    assert.match(screen, /accessibilityElementsHidden=\{!editing \|\| !allowed\}/, "screen readers cannot reach the editor behind it");
    assert.match(screen, /usePreventRemove\(allowed && \(/, "leaving the sheet never asks to discard");
    assert.match(screen, /leaveToJournal\("permission"\)/, "Not now returns to Journal with the calm note");
    assert.ok(!screen.includes("CrisisResources") && !screen.includes("onOpenSupport"), "Support Resources was removed (2026-11-08)");
    assert.match(screen, /route\.params\.mode !== "write" \|\| !allowed/, "the keyboard waits for the answer");
    assert.match(screen, /\[route\.params\.mode, allowed\]/, "and comes up after it");
  });

  sourceCheck("the sheet: every way out is a button, it covers the screen as a modal view, and it has no haptic, event, log or crisis colour", () => {
    const view = read("src/screens/journal/AiPermissionSheet.tsx");
    for (const word of ["haptics", "track(", "console.", "crisis", "colors.crisis", "<Modal"]) {
      assert.ok(!view.includes(word), `the sheet must not use ${word}`);
    }
    // Drawn inside the screen, not as a system Modal: Not now and the keyboard never meet iOS's one-Modal rule.
    assert.ok(!/<BottomSheet|import \{[^}]*BottomSheet/.test(view), "the sheet is not a BottomSheet (a Modal)");
    assert.ok(!view.includes("onOpenSupport"), "no Support Resources link (removed 2026-11-08)");
    for (const handler of ["onOpenPrivacy"]) {
      assert.match(view, new RegExp(`onPress=\\{${handler}\\}`), `${handler} is pressable`);
    }
    for (const handler of ["onAllow", "onNotNow"]) {
      assert.match(view, new RegExp(`finish\\(${handler}\\)`), `${handler} goes through the closing animation`);
    }
    assert.match(view, /accessibilityRole="header"/);
    assert.match(view, /accessibilityLabel=\{copy\.common\.close\}/, "the scrim is a labelled button");
    // On the root view's own tag, not a mention in a comment: the word is in one.
    assert.match(
      view,
      /<View style=\{StyleSheet\.absoluteFill\} accessibilityViewIsModal onAccessibilityEscape=\{\(\) => finish\(onNotNow\)\}>/,
      "VoiceOver reads the sheet and not the screen behind it, and its two-finger scrub is Not now",
    );
    assert.match(view, /BackHandler\.addEventListener\("hardwareBackPress"/, "Android back is Not now");
    assert.match(view, /accessibilityState=\{expanded === undefined \? undefined : \{ expanded \}\}/, "Learn more says whether it is open");
    assert.match(view, /useReduceMotion\(\)/, "Reduce Motion shows it at once");
    assert.match(view, /useNativeDriver: true/);
    assert.ok(view.indexOf("</ScrollView>") < view.indexOf("text.caption"), "the answers and links are pinned under the scrolling text");
  });

  sourceCheck("the sheet's training answer is what the Privacy Policy and the Terms already say", () => {
    assert.match(read("docs/privacy-policy.md"), /we do not use them to train AI models\. Google\u2019s paid terms say it does not use them to improve its products/);
    assert.match(read("docs/terms-of-use.md"), /we do not use it to train AI models/);
  });

  sourceCheck("the engine: the gate is on the outbox, in the run and in the timer, and not on prayer changes", () => {
    const source = read("src/services/syncEngine.ts");
    assert.match(source, /if \(change === null && hasAiPermission\(\)\) item = await outbox\.nextDue/);
    assert.match(source, /allowed \? outbox\.nextAttemptAt\(\) : null/);
    assert.match(source, /allowed \? outbox\.earliestLimitReset\(\) : null/);
    assert.match(source, /\| "permission"/);
  });

  sourceCheck("the rest of the app: nothing else sends an entry, and the screens follow the answer", () => {
    const callers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && /\bprocessItem\(/.test(read(rel))) callers.push(rel);
      }
    };
    walk("src");
    assert.deepEqual(callers.sort(), ["src/services/entryProcessor.ts", "src/services/syncEngine.ts"], "only the engine calls the processor");
    const journal = read("src/screens/journal/JournalFeedScreen.tsx");
    assert.match(journal, /heldForPermission=\{!aiAllowed\}/);
    assert.match(journal, /unsyncedCount=\{aiAllowed \? unsentCount : 0\}/, "the offline banner promises no send that is held");
    const card = read("src/components/JournalCard.tsx");
    assert.match(card, /status === "queued" && online !== false && !heldForPermission/, "no endless spinner on a held card");
    const profile = read("src/screens/profile/ProfileScreen.tsx");
    assert.match(profile, /title=\{text\.aiPermission\.title\}/);
    assert.match(profile, /subtitle=\{aiAllowed \? text\.aiPermission\.on : text\.aiPermission\.off\}/);
    assert.match(profile, /setAiAllowed\(!aiAllowed\)/);
    assert.match(profile, /accessibilityState=\{\{ checked: aiAllowed \}\}/);
    assert.match(read("src/components/dev/DevToolsPanel.tsx"), /Reset AI permission \(dev\)/);
    assert.ok(!read("src/navigation/types.ts").includes("CrisisResources"), "no Support Resources route (removed 2026-11-08)");
    assert.match(read("src/store/offlineStore.ts"), /"permission"/);
  });

  finished = true;
  if (failures.length > 0) {
    console.log(`${passed} checks passed, ${failures.length} FAILED`);
    for (const failure of failures) console.log(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log(`${passed} checks passed`);
  process.exit(0);
}

main().catch((error) => {
  console.log(`the run stopped: ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 5).join(" | ")}`);
  process.exit(1);
});
process.on("exit", () => {
  if (!finished && process.exitCode === undefined) process.exitCode = 1;
});
