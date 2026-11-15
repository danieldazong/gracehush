import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { turnMessageId } from "./turnId.ts";

// A turn's message id (step 39, decision 20): the same request finds the same message, and nothing else does.

const SECRET = "session-secret-0123456789abcdef0123456789";
const TALK = "7b1e6a52-3c1d-4f6a-9b2e-0d5c8a7f4e31";
// The engine's own check for an id made on the phone (scholar-turn/handler.ts).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

Deno.test("turn id: a canonical version 4 UUID, the same for the same talk, turn and words", async () => {
  const first = await turnMessageId(SECRET, TALK, 3, "What does Psalm 23 say about rest?");
  const again = await turnMessageId(SECRET, TALK, 3, "What does Psalm 23 say about rest?");
  assert(UUID_V4.test(first), "the engine takes it for a message id");
  assertEquals(first, again);
});

Deno.test("turn id: another talk, turn, wording or secret is another message", async () => {
  const words = "What does Psalm 23 say about rest?";
  const base = await turnMessageId(SECRET, TALK, 3, words);
  const others = await Promise.all([
    turnMessageId(SECRET, "7b1e6a52-3c1d-4f6a-9b2e-0d5c8a7f4e32", 3, words),
    turnMessageId(SECRET, TALK, 4, words),
    turnMessageId(SECRET, TALK, 3, `${words} `),
    turnMessageId(SECRET, TALK, 3, words.toLowerCase()),
    turnMessageId(`${SECRET}x`, TALK, 3, words),
    // The parts cannot run into one another: turn 1 with words "2…" is not turn 12.
    turnMessageId(SECRET, TALK, 31, words.slice(1)),
  ]);
  for (const other of others) {
    assert(UUID_V4.test(other), "every id has the shape");
    assert(other !== base, "a different input gives a different id");
  }
  assertEquals(new Set(others).size, others.length);
});

Deno.test("turn id: ids of many turns are all well formed and all different", async () => {
  const ids = await Promise.all(
    Array.from({ length: 200 }, (_, turn) => turnMessageId(SECRET, TALK, turn + 1, "the same made-up words")),
  );
  assertEquals(new Set(ids).size, 200);
  for (const id of ids) assert(UUID_V4.test(id), "well formed");
});
