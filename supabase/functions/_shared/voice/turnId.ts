// The message id of one turn of a live talk (step 39, decision 20). ElevenLabs can send the request for a turn again (it gives up on
// an attempt that brought no words in time and tries once more), and a turn must be screened, written and counted once. So the
// id is not random: it is worked out from the talk, the turn's number and its words, and a request sent again finds the same
// message. It is an HMAC under the server's own secret, so nobody outside can work out or guess a message's id, and it is shaped
// as a canonical version 4 UUID, which is what Scholar's engine takes for an id the phone made.

const encoder = new TextEncoder();

export async function turnMessageId(
  secret: string,
  talkId: string,
  turnNumber: number,
  words: string,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  // The three parts cannot run into one another: an id has no line break, and the number is written out.
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`turn\n${talkId}\n${turnNumber}\n${words}`));
  const bytes = new Uint8Array(signed).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // the RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
