// The stream ElevenLabs reads from scholar-voice-llm (step 39): OpenAI's chat-completion chunks as server-sent events. The
// function answers at once with an open stream and says its lines into it: a holding line while the answer is written, then the
// answer sentence by sentence.
//
// How ElevenLabs reads it (measured on 2026-11-13, about forty test talks against this function's test stub):
//   - It does not speak a piece when it arrives. Its voice starts once it holds about 50 characters, and it keeps the last few
//     words back (16 to 32 characters) until more text arrives or the reply ends. The end of a reply is spoken at once, a
//     one-word reply included.
//   - It gives an attempt up when no new piece has arrived for 15 seconds (the agent's cascade_timeout_seconds), counted from
//     the request's start and from every piece. It then asks again with a new request; what the first one sends later is never
//     spoken.
//   - A reply with no words is a failure: at the person's next sentence the talk ends with error 1002. So a reply is never
//     empty: every path of the handler says something (its header, 11).
//
// The reader can go away at any moment (the person spoke again, or ElevenLabs gave the attempt up). The stream then takes nothing
// more and never throws: the turn itself goes on in the background and is saved.

const encoder = new TextEncoder();

// The model name ElevenLabs is shown. Not a secret and not a real model: the answer comes from Scholar's own engine.
const MODEL = "scholar";

// What follows a holding line, in the same piece. A holding line alone is shorter than what ElevenLabs needs before it speaks,
// so it was heard only together with the answer, seconds late. ElevenLabs' buffer counts words: with sixteen more after it,
// the line is spoken about half a second after it is sent. Each of them is a zero-width space, so the voice has nothing to
// say. Measured on 2026-11-13 in all eight voices (11 test talks, every burst saved and described): nothing was heard but the
// lines and, in 4 of the 11, a tick of 30 to 60 ms before the second line (AGENTS.md). Twelve ellipses did the counting too,
// but some voices filled them with sound (a line said twice, a non-word, a sigh), and one run of zero-width spaces with no
// space between them was not counted (AGENTS.md, the ElevenLabs vendor note).
export const HOLD_PAD = "\u200B ".repeat(16);

type Delta = { role?: "assistant"; content?: string };

function chunk(id: string, created: number, delta: Delta, finish: "stop" | null): Uint8Array {
  const body = {
    id,
    object: "chat.completion.chunk",
    created,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
}

export type VoiceStream = {
  // What the function answers with, at once. The words follow as they are said.
  response: Response;
  // Says one piece of the answer (a sentence or a few). False when nobody is reading any more, or the text has no words.
  say(text: string): boolean;
  // Says a holding line: words that must be heard now, while the answer is still being written. It goes out with HOLD_PAD
  // after it, and is not counted as a piece of the answer.
  hold(text: string): boolean;
  // Ends the reply. A reply with nothing in it is the assistant's turn with no words, which ElevenLabs takes for a failure:
  // the handler never lets one end that way. A second call does nothing.
  end(): void;
  // True while the reader is still there and the reply has not ended.
  open(): boolean;
  // How many pieces of the answer were said. Holding lines are not counted.
  said(): number;
};

export function openVoiceStream(): VoiceStream {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let live = true;
  // Whether anything was sent yet (the first piece carries the assistant's role), and how many pieces of the answer.
  let begun = false;
  let pieces = 0;

  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
    cancel() {
      live = false;
    },
  });

  // A reader that went away between two pieces makes enqueue throw: that is the end of the stream, not an error.
  const push = (bytes: Uint8Array): void => {
    try {
      controller?.enqueue(bytes);
    } catch {
      live = false;
    }
  };

  // One piece of text. A space ends it, so that two pieces never run together when they are spoken.
  const send = (content: string): boolean => {
    push(chunk(id, created, begun ? { content } : { role: "assistant", content }, null));
    if (live) begun = true;
    return live;
  };

  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    }),
    say(text: string): boolean {
      const words = text.trim();
      if (!live || words === "") return false;
      if (send(`${words} `)) pieces += 1;
      return live;
    },
    hold(text: string): boolean {
      const words = text.trim();
      if (!live || words === "") return false;
      return send(`${words} ${HOLD_PAD}`);
    },
    end(): void {
      if (!live) return;
      if (!begun) push(chunk(id, created, { role: "assistant" }, null));
      push(chunk(id, created, {}, "stop"));
      push(encoder.encode("data: [DONE]\n\n"));
      live = false;
      try {
        controller?.close();
      } catch {
        // Already closed by the reader.
      }
    },
    open: () => live,
    said: () => pieces,
  };
}
