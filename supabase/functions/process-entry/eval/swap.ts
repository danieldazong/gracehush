// The swap test of the tone evaluation (step 36, decision 14). A grader is shown a reflection and three entries, the real one
// and two decoys, and says which entry it was written for. A reflection written from its entry is picked out; one that only
// matches its topic is not, because the first decoy is on the same topic whenever there is one. Pure, and the same on every
// run: the draw and the order are seeded by the case's id.

export const SWAP_LABELS = ["A", "B", "C"] as const;
export type SwapLabel = (typeof SWAP_LABELS)[number];

type Drawable = { id: string; topic: string };

// FNV-1a over the text: a small, stable number for a seed.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

// The two decoys of a case: one on the case's own topic when another case has it, and one on another topic. A case alone on its
// topic gets two decoys on two other topics. Never the case itself, and never two decoys on one topic.
export function pickDecoys<T extends Drawable>(cases: readonly T[], id: string): [T, T] {
  const item = cases.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`no case ${id}`);
  const others = cases.filter((candidate) => candidate.id !== id);
  const sameTopic = others.filter((candidate) => candidate.topic === item.topic);
  const otherTopic = others.filter((candidate) => candidate.topic !== item.topic);
  const pick = (from: readonly T[], salt: string) => from[hash(`${id}:${salt}`) % from.length];
  if (otherTopic.length === 0) throw new Error("every case is on one topic");
  if (sameTopic.length > 0) return [pick(sameTopic, "same"), pick(otherTopic, "other")];
  const first = pick(otherTopic, "first");
  const rest = otherTopic.filter((candidate) => candidate.topic !== first.topic);
  if (rest.length === 0) throw new Error("only two topics: no second decoy on a topic of its own");
  return [first, pick(rest, "second")];
}

// The order the three entries are shown in: position k shows entry swapOrder(id)[k], where 0 is the real entry and 1 and 2 the
// decoys in pickDecoys' order. A seeded Fisher-Yates shuffle.
export function swapOrder(id: string): number[] {
  const order = [0, 1, 2];
  let seed = hash(`${id}:order`);
  for (let index = order.length - 1; index > 0; index -= 1) {
    // One step of a small linear congruential generator, enough for three cards.
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swap = seed % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

// The grader's answer: {"entry": "A"}, in a code fence or not, any case. Anything else is no answer.
export function readSwapAnswer(text: string): SwapLabel | null {
  try {
    const data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (typeof data !== "object" || data === null || Array.isArray(data) || typeof data.entry !== "string") return null;
    const label = data.entry.trim().toUpperCase();
    return (SWAP_LABELS as readonly string[]).includes(label) ? label as SwapLabel : null;
  } catch {
    return null;
  }
}
