import { pointsUnderMessage, saysTheyWrote } from "./spoken_checks.ts";

function assertEquals<T>(actual: T, expected: T, message = ""): void {
  if (actual !== expected) throw new Error(`${message}\n  expected: ${expected}\n  actual:   ${actual}`);
}

Deno.test("spoken checks: an answer that speaks of what the person wrote or typed is caught, and a sentence about Scripture is not", () => {
  for (
    const said of [
      "What you wrote shows how tired you are.",
      "You wrote about your father just now.",
      "You’ve written something honest here.",
      "You've written something honest here.",
      "You have just written a brave thing.",
      "The words you typed matter to God.",
      "Thank you for what you had written earlier.",
      "Your written words carry real weight.",
    ]
  ) assertEquals(saysTheyWrote(said), true, said);
  for (
    const said of [
      "Paul wrote this to encourage people who feel like quitting.",
      "David wrote this psalm while he was hiding.",
      "It is written that he will never leave you.",
      "This was written for people who were waiting, as you are.",
      "What you said shows how tired you are.",
      "You spoke about your father just now.",
      "The psalmist had written these words in exile.",
    ]
  ) assertEquals(saysTheyWrote(said), false, said);
});

Deno.test("spoken checks: pointing under the message is caught, and pointing to the screen is not", () => {
  assertEquals(pointsUnderMessage("Please call or text the line under this message."), true);
  assertEquals(pointsUnderMessage("The link Under This Message finds a help line."), true);
  assertEquals(pointsUnderMessage("Please look at the help line on your screen right now."), false);
  assertEquals(pointsUnderMessage("He holds you under his wing, and this message is for you."), false);
});
