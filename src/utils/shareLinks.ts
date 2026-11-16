// The links GraceHush's share panel opens (2026-11-16, the owner's request: after sharing, the person ends up in the chat they
// chose). Each opens the app itself with the message typed in, so the person picks the chat there, taps Send and stays. The
// iPhone's share menu cannot do that: each app's panel in it closes back into GraceHush, and iOS never says who was picked.
// The whole message is encoded, so a newline, an ampersand or a question mark in it can never end the text. Pure.

// WhatsApp's own "send" link: its chat picker, then the chosen chat.
export function whatsAppShareUrl(message: string): string {
  return `whatsapp://send?text=${encodeURIComponent(message)}`;
}

// A new message in Messages with the text typed in and the "To" field empty. iOS writes the body after "&", Android after "?"
// (as openTextMessage does with a number).
export function messagesShareUrl(message: string, os: string): string {
  return `sms:${os === "ios" ? "&" : "?"}body=${encodeURIComponent(message)}`;
}
