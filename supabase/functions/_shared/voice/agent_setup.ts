// Creates or updates Scholar's ElevenLabs voice agent (step 39), run by hand with the server secrets file:
//
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
//     --allow-net=api.elevenlabs.io --allow-env --allow-read=supabase/functions/.env.local \
//     --allow-write=supabase/functions/.env.local --env-file=supabase/functions/.env.local \
//     supabase/functions/_shared/voice/agent_setup.ts --llm-url <the project's functions URL>/scholar-voice-llm \
//     --environment development [--voice <voice id>] [--write-ids supabase/functions/.env.local]
//
// The agent is kept as code so development and production get the same settings. What matters for safety, checked after
// every run: the custom LLM is the only brain (no backup LLM that could answer around Scholar's screening when our server
// is slow), ElevenLabs' own guardrails that end or rewrite a call are off (Scholar's care decides, never a filter that
// hangs up on someone in a hard moment), it never speaks into a silence or asks for an answer before the person has
// finished, the agent is private (a talk needs a token from our server), and ElevenLabs keeps and analyses as little as it
// allows. It prints settings as booleans and names, never a key, a secret or anything said in a talk.

const API = "https://api.elevenlabs.io";
const FIRST_MESSAGE = "Hi, this is the GraceHush voice test. Say anything, and I'll answer.";
// How long ElevenLabs waits for the first words of our server's answer before it gives up on the attempt. 15 is the
// highest it allows (2 to 15; its default is 4). With the default, an answer whose first words came after 6 seconds ended
// the talk: three attempts of 4 seconds, then "custom_llm generation failed" (found on the phone on 2026-11-13).
export const CASCADE_TIMEOUT_SECONDS = 15;
const CLIENT_EVENTS = [
  "conversation_initiation_metadata",
  "audio",
  "interruption",
  "user_transcript",
  "agent_response",
  "agent_response_correction",
  "vad_score",
];

type Args = {
  llmUrl: string;
  environment: "development" | "production";
  voice: string | null;
  writeIds: string | null;
};

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
  return { llmUrl, environment, voice: value("--voice"), writeIds: value("--write-ids") };
}

function requireSecret(name: string, pattern: RegExp): string {
  const value = Deno.env.get(name);
  if (!value || !pattern.test(value)) throw new Error(`${name} is missing or malformed`);
  return value;
}

async function api(key: string, method: string, path: string, body?: unknown): Promise<unknown> {
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

export function agentConfig(args: Args, secretId: string): Record<string, unknown> {
  return {
    name: `GraceHush Scholar (${args.environment})`,
    tags: ["gracehush", args.environment],
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: {
          // Never used: the custom LLM writes every answer and ignores this prompt.
          prompt: "GraceHush's server writes every answer.",
          llm: "custom-llm",
          custom_llm: {
            url: args.llmUrl,
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
        ...(args.voice ? { voice_id: args.voice } : {}),
        expressive_mode: false,
        // Our server writes plain text; ElevenLabs turns numbers into words, so "Psalm 23:1" is read properly.
        text_normalisation_type: "elevenlabs",
      },
      turn: {
        // No canned filler such as "Hhmmmm...yeah." while Scholar thinks: a filler cannot know whether the person is in a
        // hard moment. The phone shows that Scholar is thinking instead.
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
      },
      conversation: { max_duration_seconds: 600, client_events: CLIENT_EVENTS },
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
      // The phone may pass the signed session (custom LLM extra body) and one of Scholar's voices, nothing else.
      overrides: { custom_llm_extra_body: true, conversation_config_override: { tts: { voice_id: true } } },
      call_limits: { daily_limit: 300, bursting_enabled: false },
    },
  };
}

type Check = [label: string, ok: boolean];

function readPath(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined),
    object,
  );
}

function checksFor(agent: unknown, args: Args, secretId: string): Check[] {
  const guardrails = readPath(agent, "platform_settings.guardrails") as Record<string, unknown> | undefined;
  const enabledGuardrails: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === "is_enabled" && inner === true) enabledGuardrails.push(path);
      walk(inner, path ? `${path}.${key}` : key);
    }
  };
  walk(guardrails, "");
  return [
    ["the brain is the custom LLM", readPath(agent, "conversation_config.agent.prompt.llm") === "custom-llm"],
    [
      "the custom LLM is our endpoint",
      readPath(agent, "conversation_config.agent.prompt.custom_llm.url") === args.llmUrl,
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
    ["no guardrail that ends or rewrites a call", enabledGuardrails.length === 0],
    ["private (token required)", readPath(agent, "platform_settings.auth.enable_auth") === true],
    ["voice recording off", readPath(agent, "platform_settings.privacy.record_voice") === false],
    ["transcripts and audio deleted", readPath(agent, "platform_settings.privacy.delete_transcript_and_pii") === true],
    [
      "extra body allowed (signed session)",
      readPath(agent, "platform_settings.overrides.custom_llm_extra_body") === true,
    ],
    [
      "no prompt override from the phone",
      readPath(agent, "platform_settings.overrides.conversation_config_override.agent.prompt.prompt") !== true,
    ],
  ];
}

async function appendIds(path: string, ids: Record<string, string>): Promise<void> {
  let text = await Deno.readTextFile(path);
  const lineEnd = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [name, value] of Object.entries(ids)) {
    if (new RegExp(`^${name}=`, "m").test(text)) {
      text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`);
    } else {
      if (!text.endsWith(lineEnd)) text += lineEnd;
      text += `${name}=${value}${lineEnd}`;
    }
  }
  await Deno.writeTextFile(path, text);
}

async function main(): Promise<void> {
  const args = readArgs(Deno.args);
  const key = requireSecret("ELEVENLABS_API_KEY", /^sk_[A-Za-z0-9]{20,}$/);
  const llmSecret = requireSecret("ELEVENLABS_LLM_SECRET", /^[A-Za-z0-9_-]{32,}$/);

  let secretId = Deno.env.get("ELEVENLABS_LLM_SECRET_ID") ?? "";
  if (!secretId) {
    const created = await api(key, "POST", "/v1/convai/secrets", {
      type: "new",
      name: `gracehush-scholar-llm-${args.environment}`,
      value: llmSecret,
    }) as { secret_id?: unknown };
    if (typeof created?.secret_id !== "string") throw new Error("the secret was created with no id");
    secretId = created.secret_id;
    console.log("workspace secret for the custom LLM: created");
  } else {
    console.log("workspace secret for the custom LLM: reused");
  }

  let agentId = Deno.env.get("ELEVENLABS_AGENT_ID") ?? "";
  const config = agentConfig(args, secretId);
  if (agentId) {
    await api(key, "PATCH", `/v1/convai/agents/${agentId}`, config);
    console.log("agent: updated");
  } else {
    const created = await api(key, "POST", "/v1/convai/agents/create", config) as { agent_id?: unknown };
    if (typeof created?.agent_id !== "string") throw new Error("the agent was created with no id");
    agentId = created.agent_id;
    console.log("agent: created");
  }

  if (args.writeIds) {
    await appendIds(args.writeIds, { ELEVENLABS_AGENT_ID: agentId, ELEVENLABS_LLM_SECRET_ID: secretId });
    console.log("saved ELEVENLABS_AGENT_ID and ELEVENLABS_LLM_SECRET_ID to the secrets file");
  }

  const agent = await api(key, "GET", `/v1/convai/agents/${agentId}`);
  let failed = 0;
  for (const [label, ok] of checksFor(agent, args, secretId)) {
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  }
  const retention = readPath(agent, "platform_settings.privacy.retention_days");
  const model = readPath(agent, "conversation_config.tts.model_id");
  console.log(`retention days: ${typeof retention === "number" ? retention : "?"}; voice model: ${String(model)}`);
  if (failed > 0) Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
