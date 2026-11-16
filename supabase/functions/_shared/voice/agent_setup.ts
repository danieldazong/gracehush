// Creates or updates Scholar's ElevenLabs voice agents (step 39): one agent for each voice of voices.ts. Run by hand with the
// server secrets file:
//
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
//     --allow-net=api.elevenlabs.io --allow-env --allow-read=supabase/functions/.env.local \
//     --allow-write=supabase/functions/.env.local --env-file=supabase/functions/.env.local \
//     supabase/functions/_shared/voice/agent_setup.ts --llm-url <the project's functions URL>/scholar-voice-llm \
//     --environment development --write-ids supabase/functions/.env.local
//
// The agents are kept as code so development and production get the same settings, and so the eight differ in their voice and
// in nothing else. What matters for safety, checked on every agent after every run: the custom LLM is the only brain (no backup
// LLM that could answer around Scholar's screening when our server is slow), ElevenLabs' own guardrails that end or rewrite a
// call are off (Scholar's care decides, never a filter that hangs up on someone in a hard moment), it never speaks into a
// silence or asks for an answer before the person has finished, the agent is private (a talk needs a token from our server), the
// phone can pass nothing but the signed session (not a voice, a prompt or a first message), and ElevenLabs keeps and analyses as
// little as it allows. It prints settings as counts and names, never a key, a secret, an id or anything said in a talk.
import { VOICE_LIMITS } from "./constants.ts";
import { VOICE_LINES } from "./lines.ts";
import { DEFAULT_VOICE, VOICE_KEYS, type VoiceKey, VOICES } from "./voices.ts";

const API = "https://api.elevenlabs.io";
// How long ElevenLabs waits for the next piece of our server's answer before it gives up on the attempt: from the request's
// start, and again from every piece (measured, 2026-11-13). 15 is the highest it allows (2 to 15; its default is 4). With the
// default, an answer whose first words came after 6 seconds ended the talk: three attempts of 4 seconds, then "custom_llm
// generation failed" (found on the phone on 2026-11-13). Our server says a holding line before then (constants.ts,
// voiceTiming), and constants_test.ts keeps every gap of a turn under this limit.
export const CASCADE_TIMEOUT_SECONDS = 15;
// The voice's own settings, pinned so that every agent sounds as the owner heard it when choosing (2026-11-13): a model
// ElevenLabs changes its default for would otherwise change Scholar's voice without anyone deciding it.
export const SPEECH = { model: "eleven_v4_turbo", stability: 0.5, similarity: 0.75, speed: 1 } as const;
// The sound ElevenLabs sends the phone: 48 kHz, its highest (2026-11-14, the retest). Its default, 16 kHz, is the sound of a phone
// call, and the owner heard the talk as unclean beside the voice previews (MP3s at 44.1 kHz); a talk reaches the iPhone over
// WebRTC, which carries 48 kHz.
export const SPEECH_OUTPUT_FORMAT = "pcm_48000";
// The words ElevenLabs' speech-to-text listens harder for (its documented keyword boost): the stop words a person says over
// Scholar, and Scholar's name. On 2026-11-14 a spoken "Wait." came out as "Weight." three times of three (stop.ts also takes it).
export const ASR_KEYWORDS: readonly string[] = ["wait", "stop", "pause", "go on", "Scholar"];
// The events ElevenLabs sends the phone in a talk. The Talk screen's captions read three of them: "tentative_user_transcript"
// (the person's words while they are still speaking, 2026-11-16), "user_transcript" (their words once the turn is over) and
// "audio", whose alignment times each character Scholar says; nothing else in a talk is drawn or kept.
export const CLIENT_EVENTS: readonly string[] = [
  "conversation_initiation_metadata",
  "audio",
  "interruption",
  "user_transcript",
  "tentative_user_transcript",
  "agent_response",
  "agent_response_correction",
  "vad_score",
];

export type AgentTarget = { llmUrl: string; environment: "development" | "production" };
type Args = AgentTarget & { writeIds: string | null };
type Voice = (typeof VOICES)[number];
export type Agents = Partial<Record<VoiceKey, string>>;

function readArgs(argv: string[]): Args {
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
  };
  const llmUrl = value("--llm-url");
  if (!llmUrl || !/^https:\/\/[^/]+\/functions\/v1\/scholar-voice-llm$/.test(llmUrl)) {
    throw new Error("--llm-url must be https://<project>/functions/v1/scholar-voice-llm");
  }
  const environment = value("--environment");
  if (environment !== "development" && environment !== "production") {
    throw new Error("--environment must be development or production");
  }
  return { llmUrl, environment, writeIds: value("--write-ids") };
}

function requireSecret(name: string, pattern: RegExp): string {
  const value = Deno.env.get(name);
  if (!value || !pattern.test(value)) throw new Error(`${name} is missing or malformed`);
  return value;
}

export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

async function callApi(key: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = "";
    try {
      const detail = (JSON.parse(text) as { detail?: { status?: string } | unknown[] }).detail;
      if (Array.isArray(detail)) {
        // Which setting was refused and why, never the value that was sent.
        const refused = detail.slice(0, 5).map((item) => {
          const entry = item as { loc?: unknown; msg?: unknown };
          const where = Array.isArray(entry.loc) ? entry.loc.filter((part) => part !== "body").join(".") : "?";
          return `${where}: ${typeof entry.msg === "string" ? entry.msg.slice(0, 80) : "refused"}`;
        });
        code = `validation (${detail.length}): ${refused.join("; ")}`;
      } else {
        code = (detail as { status?: string })?.status ?? "";
      }
    } catch { /* not JSON */ }
    throw new Error(
      `${method} ${path.split("?")[0].replace(/\/[A-Za-z0-9_-]{16,}/g, "/<id>")} answered ${response.status} ${code}`,
    );
  }
  return text.length === 0 ? null : JSON.parse(text);
}

// One voice's agent. The eight differ in their name, their tag and their voice, and in nothing else.
export function agentConfig(target: AgentTarget, secretId: string, voice: Voice): Record<string, unknown> {
  return {
    name: `GraceHush Scholar: ${voice.key} (${target.environment})`,
    tags: ["gracehush", target.environment, voice.key],
    conversation_config: {
      agent: {
        // The first thing a person hears says it is AI. The agent says it by itself; every later word comes from our server.
        first_message: VOICE_LINES.opening,
        // What the agent says when ElevenLabs' own limit ends a talk (conversation.max_duration_seconds below).
        max_conversation_duration_message: VOICE_LINES.backstop,
        language: "en",
        prompt: {
          // Never used: the custom LLM writes every answer and ignores this prompt.
          prompt: "GraceHush's server writes every answer.",
          llm: "custom-llm",
          custom_llm: {
            url: target.llmUrl,
            model_id: "scholar",
            api_key: { secret_id: secretId },
            api_type: "chat_completions",
          },
          // No other model may ever answer around Scholar's screening, however long our server takes.
          backup_llm_config: { preference: "disabled" },
          cascade_timeout_seconds: CASCADE_TIMEOUT_SECONDS,
          ignore_default_personality: true,
        },
      },
      tts: {
        voice_id: voice.elevenLabsVoiceId,
        model_id: SPEECH.model,
        stability: SPEECH.stability,
        similarity_boost: SPEECH.similarity,
        speed: SPEECH.speed,
        expressive_mode: false,
        // Our server writes plain text; ElevenLabs turns numbers into words, so "Psalm 23:1" is read properly. (The help
        // numbers arrive already spelled out, digit by digit: lines.ts, sayNumbers.)
        text_normalisation_type: "elevenlabs",
        agent_output_audio_format: SPEECH_OUTPUT_FORMAT,
      },
      asr: { keywords: [...ASR_KEYWORDS] },
      turn: {
        // No canned filler such as "Hhmmmm...yeah." while Scholar thinks: a filler cannot know whether the person is in a
        // hard moment. Our server says the holding lines itself.
        soft_timeout_config: { timeout_seconds: -1 },
        // Never hang up because someone went quiet.
        silence_end_call_timeout: -1,
        // Never speak into a silence. With ElevenLabs' default (7 seconds) it sends our server a turn of its own once the
        // person has been quiet that long, and speaks the answer: someone who is thinking, praying or crying would be
        // hurried, and a silence would count as a message (found on the phone on 2026-11-13).
        turn_timeout: -1,
        // Never ask our server for an answer before the person has finished speaking: every request is a screened,
        // counted Scholar message. A new agent has this on.
        speculative_turn: false,
        // Wait for a clearer end of the person's turn: someone who prays or searches for words pauses in the middle.
        turn_eagerness: "patient",
        // Never tell someone to move somewhere quieter: a person in a hard moment may have nowhere else to go.
        noisy_environment_detection: false,
      },
      // ElevenLabs' own end of a talk: a backstop behind our caps, which a heavy conversation's talk never meets before it.
      conversation: { max_duration_seconds: VOICE_LIMITS.backstopSeconds, client_events: CLIENT_EVENTS },
    },
    platform_settings: {
      // Private: a talk needs a token minted by our server with the API key.
      auth: { enable_auth: true },
      // As little as ElevenLabs allows on a self-serve plan; the server also deletes each talk when it ends.
      privacy: { record_voice: false, retention_days: 0, delete_transcript_and_pii: true, delete_audio: true },
      // No analysis of what a person said beyond the talk itself. A new agent has both on. (The summary ElevenLabs
      // writes after each talk has no switch: the server deletes the talk instead.)
      sentiment_analysis: { enabled: false },
      topic_discovery: { enabled: false },
      // The phone may pass the signed session (custom LLM extra body) and nothing else. The voice is the agent's own: each
      // override is named, so an agent that allowed one before is switched back.
      overrides: {
        custom_llm_extra_body: true,
        conversation_config_override: {
          tts: { voice_id: false },
          agent: {
            first_message: false,
            language: false,
            max_conversation_duration_message: false,
            prompt: { prompt: false },
          },
        },
      },
      call_limits: { daily_limit: 300, bursting_enabled: false },
    },
  };
}

export type Check = [label: string, ok: boolean];

function readPath(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined),
    object,
  );
}

// Every path under `value` whose own key passes `wanted` and whose value is true.
function pathsOfTrue(value: unknown, wanted: (key: string) => boolean, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => {
    const here = path ? `${path}.${key}` : key;
    return [...(inner === true && wanted(key) ? [here] : []), ...pathsOfTrue(inner, wanted, here)];
  });
}

export function checksFor(agent: unknown, target: AgentTarget, secretId: string, voice: Voice): Check[] {
  const tts = (name: string) => readPath(agent, `conversation_config.tts.${name}`);
  const overrides = readPath(agent, "platform_settings.overrides");
  // Everything the phone could pass besides the signed session: any field of the conversation it may override, and the
  // other ways ElevenLabs lets a client shape a talk.
  const passable = [
    ...pathsOfTrue(readPath(overrides, "conversation_config_override"), () => true),
    ...pathsOfTrue(overrides, (key) => key.startsWith("enable_")),
  ];
  return [
    ["the brain is the custom LLM", readPath(agent, "conversation_config.agent.prompt.llm") === "custom-llm"],
    [
      "the custom LLM is our endpoint",
      readPath(agent, "conversation_config.agent.prompt.custom_llm.url") === target.llmUrl,
    ],
    [
      "the custom LLM key is our secret",
      readPath(agent, "conversation_config.agent.prompt.custom_llm.api_key.secret_id") === secretId,
    ],
    [
      "no backup LLM can answer",
      readPath(agent, "conversation_config.agent.prompt.backup_llm_config.preference") === "disabled",
    ],
    [
      `waits ${CASCADE_TIMEOUT_SECONDS} s for our server's first words`,
      readPath(agent, "conversation_config.agent.prompt.cascade_timeout_seconds") === CASCADE_TIMEOUT_SECONDS,
    ],
    [
      "no canned filler while waiting",
      readPath(agent, "conversation_config.turn.soft_timeout_config.timeout_seconds") === -1,
    ],
    ["never hangs up on silence", readPath(agent, "conversation_config.turn.silence_end_call_timeout") === -1],
    ["never speaks into a silence", readPath(agent, "conversation_config.turn.turn_timeout") === -1],
    [
      "never asks for an answer before the person has finished",
      readPath(agent, "conversation_config.turn.speculative_turn") === false,
    ],
    ["no sentiment analysis", readPath(agent, "platform_settings.sentiment_analysis.enabled") === false],
    ["no topic discovery", readPath(agent, "platform_settings.topic_discovery.enabled") === false],
    [
      "no guardrail that ends or rewrites a call",
      pathsOfTrue(readPath(agent, "platform_settings.guardrails"), (key) => key === "is_enabled").length === 0,
    ],
    ["private (token required)", readPath(agent, "platform_settings.auth.enable_auth") === true],
    ["voice recording off", readPath(agent, "platform_settings.privacy.record_voice") === false],
    ["transcripts and audio deleted", readPath(agent, "platform_settings.privacy.delete_transcript_and_pii") === true],
    ["extra body allowed (signed session)", readPath(overrides, "custom_llm_extra_body") === true],
    [
      "no prompt override from the phone",
      readPath(overrides, "conversation_config_override.agent.prompt.prompt") !== true,
    ],
    // Step 39's own settings.
    ["the phone can pass nothing but the signed session", passable.length === 0],
    [
      "opens by saying it is AI, in our words",
      readPath(agent, "conversation_config.agent.first_message") === VOICE_LINES.opening,
    ],
    ["speaks in its own voice", tts("voice_id") === voice.elevenLabsVoiceId],
    [
      "the speech model and its settings are pinned",
      tts("model_id") === SPEECH.model && tts("stability") === SPEECH.stability &&
      tts("similarity_boost") === SPEECH.similarity && tts("speed") === SPEECH.speed,
    ],
    ["sends 48 kHz sound", tts("agent_output_audio_format") === SPEECH_OUTPUT_FORMAT],
    [
      "listens harder for the stop words",
      JSON.stringify(readPath(agent, "conversation_config.asr.keywords")) === JSON.stringify(ASR_KEYWORDS),
    ],
    [
      "waits for the person to finish (patient)",
      readPath(agent, "conversation_config.turn.turn_eagerness") === "patient",
    ],
    [
      "never tells someone to move somewhere quieter",
      readPath(agent, "conversation_config.turn.noisy_environment_detection") === false,
    ],
    [
      "sends the phone the words for its captions",
      ["audio", "user_transcript", "tentative_user_transcript"].every((event) =>
        (readPath(agent, "conversation_config.conversation.client_events") as unknown[] | undefined)?.includes(
          event,
        ) === true
      ),
    ],
    [
      "ends a talk at 30 minutes with our own line",
      readPath(agent, "conversation_config.conversation.max_duration_seconds") === VOICE_LIMITS.backstopSeconds &&
      readPath(agent, "conversation_config.agent.max_conversation_duration_message") === VOICE_LINES.backstop,
    ],
  ];
}

const AGENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

// The agents the secrets file already knows: ELEVENLABS_AGENTS (voice to agent id; a run that stopped halfway leaves it with
// some of the eight), and the one agent of the test run (ELEVENLABS_AGENT_ID), which becomes the default voice's agent so that
// it is not left behind. A value that cannot be read is a fault, never "nothing known": that would make eight more agents.
export function readKnownAgents(
  raw: string | undefined,
  testAgentId: string | undefined,
): { agents: Agents; adopted: boolean } {
  const agents: Agents = {};
  if (raw !== undefined && raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("ELEVENLABS_AGENTS is not JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("ELEVENLABS_AGENTS is not an object of voice to agent id");
    }
    for (const key of VOICE_KEYS) {
      const id = (parsed as Record<string, unknown>)[key];
      if (id === undefined) continue;
      if (typeof id !== "string" || !AGENT_ID.test(id)) {
        throw new Error(`ELEVENLABS_AGENTS: the agent of "${key}" is malformed`);
      }
      agents[key] = id;
    }
    const ids = Object.values(agents);
    if (new Set(ids).size !== ids.length) throw new Error("ELEVENLABS_AGENTS names one agent for two voices");
  }
  const adopted = agents[DEFAULT_VOICE] === undefined && testAgentId !== undefined && AGENT_ID.test(testAgentId) &&
    !Object.values(agents).includes(testAgentId);
  if (adopted) agents[DEFAULT_VOICE] = testAgentId;
  return { agents, adopted };
}

// The secrets file with the ids written into it: each name's own line replaced in place, or added at the end. Every other
// line stays byte for byte, and the file keeps its line endings. `dropTestAgent` removes the test run's ELEVENLABS_AGENT_ID line
// once that agent is one of ELEVENLABS_AGENTS.
export function withIds(
  text: string,
  ids: { agents: Agents; secretId: string; dropTestAgent: boolean },
): string {
  const lineEnd = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  // In the list's own order, whatever order they were made in.
  const agents = Object.fromEntries(VOICE_KEYS.flatMap((key) => (ids.agents[key] ? [[key, ids.agents[key]]] : [])));
  const values: [string, string][] = [
    ["ELEVENLABS_AGENTS", JSON.stringify(agents)],
    ["ELEVENLABS_LLM_SECRET_ID", ids.secretId],
  ];
  const kept = ids.dropTestAgent ? lines.filter((line) => !line.startsWith("ELEVENLABS_AGENT_ID=")) : lines;
  for (const [name, value] of values) {
    const at = kept.findIndex((line) => line.startsWith(`${name}=`));
    if (at >= 0) kept[at] = `${name}=${value}`;
    else kept.push(`${name}=${value}`);
  }
  return kept.join(lineEnd) + lineEnd;
}

export type VoiceReport = { key: VoiceKey; action: "created" | "updated"; checks: Check[] };

// Every voice's agent, in the list's order: updated when the secrets file knows it, created otherwise. A new agent's id is
// saved before the next one is made, so a run that stops halfway never leaves an agent nobody knows.
export async function setUpAgents(input: {
  target: AgentTarget;
  secretId: string;
  agents: Agents;
  api: Api;
  save: (agents: Agents) => Promise<void>;
}): Promise<{ agents: Agents; reports: VoiceReport[] }> {
  const { target, secretId, api, save } = input;
  const agents: Agents = { ...input.agents };
  const reports: VoiceReport[] = [];
  for (const voice of VOICES) {
    const config = agentConfig(target, secretId, voice);
    let id = agents[voice.key];
    const action = id === undefined ? "created" : "updated";
    if (id === undefined) {
      const created = await api("POST", "/v1/convai/agents/create", config) as { agent_id?: unknown } | null;
      if (typeof created?.agent_id !== "string" || !AGENT_ID.test(created.agent_id)) {
        throw new Error(`the agent of "${voice.key}" was created with no id`);
      }
      id = created.agent_id;
      agents[voice.key] = id;
      await save(agents);
    } else {
      await api("PATCH", `/v1/convai/agents/${id}`, config);
    }
    // What ElevenLabs holds now, not what was sent.
    const agent = await api("GET", `/v1/convai/agents/${id}`);
    reports.push({ key: voice.key, action, checks: checksFor(agent, target, secretId, voice) });
  }
  return { agents, reports };
}

async function main(): Promise<void> {
  const args = readArgs(Deno.args);
  const key = requireSecret("ELEVENLABS_API_KEY", /^sk_[A-Za-z0-9]{20,}$/);
  const llmSecret = requireSecret("ELEVENLABS_LLM_SECRET", /^[A-Za-z0-9_-]{32,}$/);
  const api: Api = (method, path, body) => callApi(key, method, path, body);
  const known = readKnownAgents(Deno.env.get("ELEVENLABS_AGENTS"), Deno.env.get("ELEVENLABS_AGENT_ID"));
  const missing = VOICE_KEYS.filter((voice) => known.agents[voice] === undefined).length;
  let secretId = Deno.env.get("ELEVENLABS_LLM_SECRET_ID") ?? "";
  if ((missing > 0 || known.adopted || !secretId) && !args.writeIds) {
    // An agent or a secret made with nowhere to keep its id would be made again at the next run.
    throw new Error(
      "--write-ids <the secrets file> is needed: this run makes or adopts something whose id must be kept",
    );
  }

  const save = async (agents: Agents) => {
    if (!args.writeIds) return;
    const text = await Deno.readTextFile(args.writeIds);
    await Deno.writeTextFile(args.writeIds, withIds(text, { agents, secretId, dropTestAgent: known.adopted }));
  };

  if (!secretId) {
    const created = await api("POST", "/v1/convai/secrets", {
      type: "new",
      name: `gracehush-scholar-llm-${args.environment}`,
      value: llmSecret,
    }) as { secret_id?: unknown };
    if (typeof created?.secret_id !== "string") throw new Error("the secret was created with no id");
    secretId = created.secret_id;
    await save(known.agents);
    console.log("workspace secret for the custom LLM: created");
  } else {
    console.log("workspace secret for the custom LLM: reused");
  }
  if (known.adopted) console.log(`the test run's agent becomes the "${DEFAULT_VOICE}" voice's agent`);

  const { agents, reports } = await setUpAgents({ target: args, secretId, agents: known.agents, api, save });
  let failed = 0;
  for (const report of reports) {
    const bad = report.checks.filter(([, ok]) => !ok);
    failed += bad.length;
    const passed = report.checks.length - bad.length;
    console.log(
      `${
        bad.length === 0 ? "ok  " : "FAIL"
      } ${report.key}: ${report.action}, ${passed} of ${report.checks.length} checks`,
    );
    for (const [label] of bad) console.log(`       not met: ${label}`);
  }
  // The ids as they stand after the run. Each new one was already saved as it was made; this also writes an adopted one.
  if (args.writeIds) {
    await save(agents);
    console.log("saved ELEVENLABS_AGENTS and ELEVENLABS_LLM_SECRET_ID to the secrets file");
  }
  console.log(`${reports.length} agents, ${failed} checks not met`);
  if (failed > 0) Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
