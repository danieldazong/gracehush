import { Buffer } from "node:buffer";

import { exportPKCS8, generateKeyPair } from "jose";

import type { ServiceAccount } from "./googleAuth.ts";

// A stand-in for Google's token endpoint and for Text-to-Speech, installed as globalThis.fetch for one test. It is the
// same idea as process-entry/testing/fakes.ts, kept apart so that the speech modules can be tested alone; step 22 folds
// it into that file for the handler tests. The service account is real: a fresh RSA key, so the signed assertion that the
// code sends can be checked against the matching public key.

export type Reply =
  | { kind: "json"; status: number; body: unknown; delayMs?: number }
  | { kind: "network" }
  | { kind: "hang" }; // never answers: the call ends when its own timeout aborts it

export type GoogleCall = { url: URL; method: string; headers: Headers; text: string; json: unknown };

export type GoogleWorld = {
  tokenCalls: GoogleCall[];
  synthCalls: GoogleCall[];
  // Replies are used in order. With none queued a token request is answered with a fresh token ("ya29.test-1", "-2"...) and
  // a synthesize request fails the test, so a test says what it expects.
  tokenReplies: Reply[];
  synthReplies: Reply[];
  restore(): void;
};

export type TestAccount = { account: ServiceAccount; encoded: string; publicKey: CryptoKey };

export async function makeServiceAccount(
  email = "gracehush-tts@test-project.iam.gserviceaccount.com",
): Promise<TestAccount> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const file = {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "abc123",
    private_key: pem,
    client_email: email,
    token_uri: "https://oauth2.googleapis.com/token",
  };
  return {
    account: { clientEmail: email, privateKey: pem },
    encoded: Buffer.from(JSON.stringify(file)).toString("base64"),
    publicKey,
  };
}

export const tokenOk = (token = "ya29.test", expiresIn = 3599): Reply => ({
  kind: "json",
  status: 200,
  body: { access_token: token, expires_in: expiresIn, token_type: "Bearer" },
});

export const synthOk = (audio: Uint8Array): Reply => ({
  kind: "json",
  status: 200,
  body: { audioContent: Buffer.from(audio).toString("base64") },
});

export const googleError = (status: number, body: unknown = null): Reply => ({ kind: "json", status, body });

export function installGoogle(): GoogleWorld {
  const original = globalThis.fetch;
  let tokens = 0;
  const world: GoogleWorld = {
    tokenCalls: [],
    synthCalls: [],
    tokenReplies: [],
    synthReplies: [],
    restore() {
      globalThis.fetch = original;
    },
  };

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === "GET" ? "" : await request.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (the token request is a form).
    }
    const call: GoogleCall = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      text,
      json,
    };

    let reply: Reply | undefined;
    if (call.url.host === "oauth2.googleapis.com") {
      world.tokenCalls.push(call);
      tokens += 1;
      reply = world.tokenReplies.shift() ?? tokenOk(`ya29.test-${tokens}`);
    } else if (call.url.host === "texttospeech.googleapis.com") {
      world.synthCalls.push(call);
      reply = world.synthReplies.shift();
      if (reply === undefined) throw new Error("the test queued no synthesize reply");
    } else {
      throw new Error(`the test world has no route for ${call.url.host}`);
    }

    if (reply.kind === "network") throw new TypeError("network down");
    if (reply.kind === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return world;
}
