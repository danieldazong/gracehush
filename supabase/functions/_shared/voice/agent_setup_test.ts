import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import {
  agentConfig,
  type Agents,
  type AgentTarget,
  type Api,
  CASCADE_TIMEOUT_SECONDS,
  checksFor,
  readKnownAgents,
  setUpAgents,
  SPEECH,
  withIds,
} from "./agent_setup.ts";
import { VOICE_LIMITS, VOICE_SESSION_TTL_MS, voiceTiming } from "./constants.ts";
import { VOICE_LINES } from "./lines.ts";
import { DEFAULT_VOICE, readVoiceAgents, VOICE_KEYS, VOICES } from "./voices.ts";

// Scholar's voice agents as code (step 39): what each agent is set to, the check behind every setting that keeps a talk safe,
// and how the script keeps track of the eight. Nothing here talks to ElevenLabs: the API is a recorder.

const TARGET: AgentTarget = {
  llmUrl: "https://project.example/functions/v1/scholar-voice-llm",
  environment: "development",
};
const SECRET_ID = "secret_made_up_0001";
const WARM = VOICES[0];
const id = (index: number) => `agent_made_up_000${index}`;
const ALL: Agents = Object.fromEntries(VOICE_KEYS.map((key, index) => [key, id(index)]));

const failing = (agent: unknown, voice = WARM) =>
  checksFor(agent, TARGET, SECRET_ID, voice).filter(([, ok]) => !ok).map(([label]) => label);

// A copy of an agent with one setting changed.
function withSetting(agent: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const copy = structuredClone(agent);
  const keys = path.split(".");
  let at = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys.at(-1) as string] = value;
  return copy;
}

Deno.test("setup: every voice's agent passes all twenty-six checks as it is written, and the eight differ only in their voice", () => {
  const stripped = VOICES.map((voice) => {
    const config = agentConfig(TARGET, SECRET_ID, voice);
    const checks = checksFor(config, TARGET, SECRET_ID, voice);
    assertEquals(checks.length, 26);
    assertEquals(checks.filter(([, ok]) => !ok), [], voice.key);
    assertEquals(new Set(checks.map(([label]) => label)).size, 26, "every check has its own name");
    assertEquals(readPath(config, "conversation_config.tts.voice_id"), voice.elevenLabsVoiceId);
    assertEquals(config.name, `GraceHush Scholar: ${voice.key} (development)`);
    assertEquals(config.tags, ["gracehush", "development", voice.key]);
    // Without its name, its tag and its voice, an agent is the same as every other.
    const rest = withSetting(config, "conversation_config.tts.voice_id", "-");
    delete rest.name;
    delete rest.tags;
    return JSON.stringify(rest);
  });
  assertEquals(new Set(stripped).size, 1);
  // An agent checked against another voice is not that voice's agent.
  assertEquals(failing(agentConfig(TARGET, SECRET_ID, VOICES[1]), WARM), ["speaks in its own voice"]);
});

function readPath(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined),
    object,
  );
}

Deno.test("setup: the opening and the 30-minute line are the talk's own lines, and the times fit ElevenLabs' limits", () => {
  const config = agentConfig(TARGET, SECRET_ID, WARM);
  assertEquals(readPath(config, "conversation_config.agent.first_message"), VOICE_LINES.opening);
  assertEquals(readPath(config, "conversation_config.agent.max_conversation_duration_message"), VOICE_LINES.backstop);
  assertEquals(readPath(config, "conversation_config.conversation.max_duration_seconds"), 1_800);
  assertEquals(VOICE_LIMITS.backstopSeconds, 1_800);
  // A signed session outlives ElevenLabs' own end of a talk, so the last turn of a 30-minute talk is still ours.
  assert(VOICE_SESSION_TTL_MS > VOICE_LIMITS.backstopSeconds * 1_000);
  // ElevenLabs gives up on an attempt after 15 seconds with no words: our server has said a holding line well before.
  assertEquals(CASCADE_TIMEOUT_SECONDS, 15);
  assertEquals(readPath(config, "conversation_config.agent.prompt.cascade_timeout_seconds"), 15);
  assert(voiceTiming.holdMs <= 10_000 && voiceTiming.heavyHoldMs <= 10_000, "a holding line comes within 10 seconds");
  assertEquals(SPEECH, { model: "eleven_v4_turbo", stability: 0.5, similarity: 0.75, speed: 1 });
  assertEquals(readPath(config, "conversation_config.tts.model_id"), "eleven_v4_turbo");
  // 48 kHz sound, and the stop words the speech-to-text listens harder for (the retest of 2026-11-14).
  assertEquals(readPath(config, "conversation_config.tts.agent_output_audio_format"), "pcm_48000");
  assertEquals(readPath(config, "conversation_config.asr.keywords"), ["wait", "stop", "pause", "go on", "Scholar"]);
  assertEquals(readPath(config, "conversation_config.turn.turn_eagerness"), "patient");
  // The phone may pass the signed session, and no override is on.
  assertEquals(readPath(config, "platform_settings.overrides.custom_llm_extra_body"), true);
  assertEquals(readPath(config, "platform_settings.overrides.conversation_config_override.tts.voice_id"), false);
});

Deno.test("setup: each setting that keeps a talk safe has a check that notices when it is not so", () => {
  const good = agentConfig(TARGET, SECRET_ID, WARM);
  const prompt = "conversation_config.agent.prompt";
  const turn = "conversation_config.turn";
  const override = "platform_settings.overrides.conversation_config_override";
  const passNothing = "the phone can pass nothing but the signed session";
  const pinned = "the speech model and its settings are pinned";
  const backstop = "ends a talk at 30 minutes with our own line";
  const cases: [path: string, value: unknown, expected: string[]][] = [
    [`${prompt}.llm`, "gemini-2.5-flash", ["the brain is the custom LLM"]],
    [`${prompt}.custom_llm.url`, "https://elsewhere.example/v1", ["the custom LLM is our endpoint"]],
    [`${prompt}.custom_llm.api_key.secret_id`, "secret_other_0002", ["the custom LLM key is our secret"]],
    [`${prompt}.backup_llm_config.preference`, "default", ["no backup LLM can answer"]],
    [`${prompt}.cascade_timeout_seconds`, 4, ["waits 15 s for our server's first words"]],
    [`${turn}.soft_timeout_config.timeout_seconds`, 3, ["no canned filler while waiting"]],
    [`${turn}.silence_end_call_timeout`, 20, ["never hangs up on silence"]],
    [`${turn}.turn_timeout`, 7, ["never speaks into a silence"]],
    [`${turn}.speculative_turn`, true, ["never asks for an answer before the person has finished"]],
    ["platform_settings.sentiment_analysis.enabled", true, ["no sentiment analysis"]],
    ["platform_settings.topic_discovery.enabled", true, ["no topic discovery"]],
    ["platform_settings.guardrails.version_1.moderation.is_enabled", true, [
      "no guardrail that ends or rewrites a call",
    ]],
    ["platform_settings.auth.enable_auth", false, ["private (token required)"]],
    ["platform_settings.privacy.record_voice", true, ["voice recording off"]],
    ["platform_settings.privacy.delete_transcript_and_pii", false, ["transcripts and audio deleted"]],
    ["platform_settings.overrides.custom_llm_extra_body", false, ["extra body allowed (signed session)"]],
    [`${override}.agent.prompt.prompt`, true, ["no prompt override from the phone", passNothing]],
    // Step 39's own.
    [`${override}.tts.voice_id`, true, [passNothing]],
    [`${override}.agent.first_message`, true, [passNothing]],
    [`${override}.conversation.max_duration_seconds`, true, [passNothing]],
    [`${override}.turn.soft_timeout_config.message`, true, [passNothing]],
    ["platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook", true, [passNothing]],
    ["platform_settings.overrides.enable_starting_workflow_node_id_from_client", true, [passNothing]],
    ["conversation_config.agent.first_message", "Hello! How can I help?", ["opens by saying it is AI, in our words"]],
    ["conversation_config.agent.first_message", "", ["opens by saying it is AI, in our words"]],
    ["conversation_config.tts.voice_id", VOICES[5].elevenLabsVoiceId, ["speaks in its own voice"]],
    ["conversation_config.tts.model_id", "eleven_flash_v2_5", [pinned]],
    ["conversation_config.tts.stability", 0.3, [pinned]],
    ["conversation_config.tts.similarity_boost", 0.8, [pinned]],
    ["conversation_config.tts.speed", 1.1, [pinned]],
    ["conversation_config.tts.agent_output_audio_format", "pcm_16000", ["sends 48 kHz sound"]],
    ["conversation_config.asr.keywords", [], ["listens harder for the stop words"]],
    ["conversation_config.asr.keywords", ["stop", "wait", "pause", "go on", "Scholar"], [
      "listens harder for the stop words",
    ]],
    [`${turn}.turn_eagerness`, "normal", ["waits for the person to finish (patient)"]],
    [`${turn}.turn_eagerness`, "eager", ["waits for the person to finish (patient)"]],
    [`${turn}.noisy_environment_detection`, true, ["never tells someone to move somewhere quieter"]],
    ["conversation_config.conversation.max_duration_seconds", 600, [backstop]],
    ["conversation_config.agent.max_conversation_duration_message", "", [backstop]],
  ];
  for (const [path, value, expected] of cases) {
    assertEquals(failing(withSetting(good, path, value)), expected, path);
  }
  // Every check is reached by a case above: none can be removed unnoticed.
  const covered = new Set(cases.flatMap(([, , expected]) => expected));
  assertEquals(
    checksFor(good, TARGET, SECRET_ID, WARM).map(([label]) => label).filter((label) => !covered.has(label)),
    [],
  );
  // An agent ElevenLabs answers with nothing of (a wrong id, an empty body) fails, and never passes by default.
  assert(failing({}).length >= 20);
  assert(failing(null).length >= 20);
});

Deno.test("setup: the agents the secrets file knows are reused, and a value that cannot be read is a fault", () => {
  assertEquals(readKnownAgents(undefined, undefined), { agents: {}, adopted: false });
  assertEquals(readKnownAgents("", undefined), { agents: {}, adopted: false });
  assertEquals(readKnownAgents(JSON.stringify(ALL), undefined), { agents: ALL, adopted: false });
  // A run that stopped halfway: what was made is known, the rest is made at the next run.
  const half = { warm: id(0), bright: id(1), clear: id(2) };
  assertEquals(readKnownAgents(JSON.stringify(half), undefined), { agents: half, adopted: false });
  // A key that is no voice (one taken off the list) is not an agent of ours any more.
  assertEquals(readKnownAgents(JSON.stringify({ ...half, gentle: "agent_made_up_0099" }), undefined).agents, half);

  // The test run's one agent becomes the default voice's agent, once.
  assertEquals(DEFAULT_VOICE, "warm");
  assertEquals(readKnownAgents(undefined, "agent_test_run_01"), {
    agents: { warm: "agent_test_run_01" },
    adopted: true,
  });
  assertEquals(readKnownAgents(JSON.stringify({ deep: id(5) }), "agent_test_run_01"), {
    agents: { deep: id(5), warm: "agent_test_run_01" },
    adopted: true,
  });
  // Not when the default voice already has an agent, not when it is already another voice's, and not when it is malformed.
  assertEquals(readKnownAgents(JSON.stringify(ALL), "agent_test_run_01"), { agents: ALL, adopted: false });
  assertEquals(readKnownAgents(JSON.stringify({ deep: id(5) }), id(5)), { agents: { deep: id(5) }, adopted: false });
  assertEquals(readKnownAgents(undefined, "has a space"), { agents: {}, adopted: false });
  assertEquals(readKnownAgents(undefined, ""), { agents: {}, adopted: false });

  // Never "nothing known" for a value that is there and cannot be read: that would make eight more agents.
  const broken = [
    "not json",
    "[]",
    "null",
    '"agent_made_up_0001"',
    JSON.stringify({ warm: 7 }),
    JSON.stringify({ warm: "" }),
    JSON.stringify({ warm: "has a space" }),
    JSON.stringify({ warm: id(0), deep: id(0) }),
  ];
  for (const raw of broken) {
    let message = "";
    try {
      readKnownAgents(raw, undefined);
    } catch (error) {
      message = error instanceof Error ? error.message : "thrown";
    }
    assert(message.startsWith("ELEVENLABS_AGENTS"), `accepted: ${raw.slice(0, 30)}`);
    // What is said about a fault never holds the value itself.
    assert(!message.includes("agent_made_up"), "the message holds an id");
  }
});

Deno.test("setup: the ids are written into the secrets file in place, and no other line is touched", () => {
  const file = (lineEnd: string) =>
    [
      "# made-up values",
      "ELEVENLABS_API_KEY=sk_made_up",
      "ELEVENLABS_AGENT_ID=agent_test_run_01",
      "ELEVENLABS_LLM_SECRET_ID=secret_old",
      "ELEVENLABS_LLM_SECRET=made_up_secret",
      "SCHOLAR_VOICE_SESSION_SECRET=made=up=with=equals",
      "",
    ].join(lineEnd);
  for (const lineEnd of ["\n", "\r\n"]) {
    const half = { bright: id(1), warm: id(0) };
    const written = withIds(file(lineEnd), { agents: half, secretId: SECRET_ID, dropTestAgent: false });
    assertEquals(written.split(lineEnd), [
      "# made-up values",
      "ELEVENLABS_API_KEY=sk_made_up",
      "ELEVENLABS_AGENT_ID=agent_test_run_01",
      `ELEVENLABS_LLM_SECRET_ID=${SECRET_ID}`,
      "ELEVENLABS_LLM_SECRET=made_up_secret",
      "SCHOLAR_VOICE_SESSION_SECRET=made=up=with=equals",
      // In the list's own order, whatever order they were given in.
      `ELEVENLABS_AGENTS={"warm":"${id(0)}","bright":"${id(1)}"}`,
      "",
    ]);
    assert(lineEnd === "\r\n" || !written.includes("\r"), "a file with plain line ends keeps them");

    // A second write replaces the line it wrote, and drops the test run's line when that agent was adopted.
    const again = withIds(written, { agents: ALL, secretId: SECRET_ID, dropTestAgent: true });
    assertEquals(again.split(lineEnd), [
      "# made-up values",
      "ELEVENLABS_API_KEY=sk_made_up",
      `ELEVENLABS_LLM_SECRET_ID=${SECRET_ID}`,
      "ELEVENLABS_LLM_SECRET=made_up_secret",
      "SCHOLAR_VOICE_SESSION_SECRET=made=up=with=equals",
      `ELEVENLABS_AGENTS=${JSON.stringify(ALL)}`,
      "",
    ]);
    // Writing the same thing again changes nothing.
    assertEquals(withIds(again, { agents: ALL, secretId: SECRET_ID, dropTestAgent: true }), again);
    // What the script writes is what the functions read (voices.ts), with every voice's agent its own.
    const line = again.split(lineEnd).find((text) => text.startsWith("ELEVENLABS_AGENTS=")) as string;
    const value = line.slice("ELEVENLABS_AGENTS=".length);
    assertEquals(readVoiceAgents((name) => (name === "ELEVENLABS_AGENTS" ? value : undefined)), ALL);
  }
  // A file with no line end at its last line gets one, and nothing else changes.
  assertEquals(
    withIds("A=1\nELEVENLABS_AGENT_ID=x", { agents: {}, secretId: "s", dropTestAgent: false }),
    "A=1\nELEVENLABS_AGENT_ID=x\nELEVENLABS_AGENTS={}\nELEVENLABS_LLM_SECRET_ID=s\n",
  );
});

type Call = { method: string; path: string; body: unknown };

// ElevenLabs as the script sees it: it remembers what was sent for each agent and answers with it.
function recorder(options: { createdIds?: (string | null)[]; failAt?: number } = {}) {
  const calls: Call[] = [];
  const held = new Map<string, unknown>();
  const saves: Agents[] = [];
  const createdIds = [...(options.createdIds ?? [])];
  let made = 0;
  const api: Api = (method, path, body) => {
    calls.push({ method, path, body });
    if (options.failAt === calls.length) return Promise.reject(new Error("POST answered 500"));
    if (method === "POST" && path === "/v1/convai/agents/create") {
      const next = createdIds.length > 0 ? createdIds.shift() : `agent_new_made_up_${made}`;
      made += 1;
      if (next === null) return Promise.resolve({});
      held.set(next as string, body);
      return Promise.resolve({ agent_id: next });
    }
    const agentId = path.split("/").at(-1) as string;
    if (method === "PATCH") {
      held.set(agentId, body);
      return Promise.resolve(null);
    }
    return Promise.resolve(held.get(agentId) ?? {});
  };
  const save = (agents: Agents) => {
    saves.push({ ...agents });
    return Promise.resolve();
  };
  return { api, save, calls, saves, held };
}

Deno.test("setup: known agents are updated, missing ones are created, and each new id is saved before the next is made", async () => {
  // Nothing known: eight are created, in the list's order, each saved at once.
  const fresh = recorder();
  const made = await setUpAgents({ target: TARGET, secretId: SECRET_ID, agents: {}, api: fresh.api, save: fresh.save });
  assertEquals(fresh.calls.map((call) => call.method), VOICE_KEYS.flatMap(() => ["POST", "GET"]));
  assertEquals(made.reports.map((report) => [report.key, report.action]), VOICE_KEYS.map((key) => [key, "created"]));
  assertEquals(Object.keys(made.agents), [...VOICE_KEYS]);
  assertEquals(new Set(Object.values(made.agents)).size, 8);
  assertEquals(fresh.saves.length, 8);
  fresh.saves.forEach((saved, index) => assertEquals(Object.keys(saved), VOICE_KEYS.slice(0, index + 1)));
  // What was sent for each voice is that voice's agent, and what ElevenLabs then holds passes every check.
  VOICES.forEach((voice, index) => {
    assertEquals(fresh.calls[index * 2].body, agentConfig(TARGET, SECRET_ID, voice));
    assertEquals(fresh.calls[index * 2 + 1].path, `/v1/convai/agents/${made.agents[voice.key]}`);
    assertEquals(made.reports[index].checks.filter(([, ok]) => !ok), []);
  });

  // All known: eight are updated, none is created and nothing needs saving.
  const again = recorder();
  const updated = await setUpAgents({
    target: TARGET,
    secretId: SECRET_ID,
    agents: ALL,
    api: again.api,
    save: again.save,
  });
  assertEquals(again.calls.map((call) => call.method), VOICE_KEYS.flatMap(() => ["PATCH", "GET"]));
  assertEquals(again.calls.filter((call) => call.method === "PATCH").map((call) => call.path), [
    ...VOICE_KEYS.map((key) => `/v1/convai/agents/${ALL[key]}`),
  ]);
  assertEquals(updated.reports.map((report) => report.action), VOICE_KEYS.map(() => "updated"));
  assertEquals(updated.agents, ALL);
  assertEquals(again.saves, []);
  // The caller's own list is never changed.
  const partial: Agents = { warm: id(0), deep: id(5) };
  const mixed = recorder();
  const both = await setUpAgents({
    target: TARGET,
    secretId: SECRET_ID,
    agents: partial,
    api: mixed.api,
    save: mixed.save,
  });
  assertEquals(partial, { warm: id(0), deep: id(5) });
  assertEquals(both.reports.map((report) => report.action), [
    "updated",
    "created",
    "created",
    "created",
    "created",
    "updated",
    "created",
    "created",
  ]);
  assertEquals(both.agents.warm, id(0));
  assertEquals(both.agents.deep, id(5));
  assertEquals(mixed.saves.length, 6);
});

Deno.test("setup: a check reads what ElevenLabs holds, a run that stops keeps what it made, and an agent with no id stops it", async () => {
  // ElevenLabs holds something else than was sent (a setting it ignored): the check says so.
  const drifting = recorder();
  const api: Api = async (method, path, body) => {
    const answer = await drifting.api(method, path, body);
    return method === "GET"
      ? withSetting(answer as Record<string, unknown>, "conversation_config.turn.turn_timeout", 7)
      : answer;
  };
  const drifted = await setUpAgents({ target: TARGET, secretId: SECRET_ID, agents: ALL, api, save: drifting.save });
  for (const report of drifted.reports) {
    assertEquals(report.checks.filter(([, ok]) => !ok).map(([label]) => label), ["never speaks into a silence"]);
  }

  // The fifth call fails (the third voice's create): the two agents made before it were saved, and nothing after is tried.
  const stopping = recorder({ failAt: 5 });
  let stopped = "";
  try {
    await setUpAgents({ target: TARGET, secretId: SECRET_ID, agents: {}, api: stopping.api, save: stopping.save });
  } catch (error) {
    stopped = error instanceof Error ? error.message : "thrown";
  }
  assertEquals(stopped, "POST answered 500");
  assertEquals(stopping.calls.length, 5);
  assertEquals(stopping.saves.map((saved) => Object.keys(saved)), [["warm"], ["warm", "bright"]]);

  // An agent created with no id, or with one that is no id: the run stops there and saves nothing for it.
  for (const bad of [null, "has a space"]) {
    const nameless = recorder({ createdIds: ["agent_new_made_up_a", bad] });
    let message = "";
    try {
      await setUpAgents({ target: TARGET, secretId: SECRET_ID, agents: {}, api: nameless.api, save: nameless.save });
    } catch (error) {
      message = error instanceof Error ? error.message : "thrown";
    }
    assertEquals(message, 'the agent of "bright" was created with no id');
    assertEquals(nameless.saves.map((saved) => Object.keys(saved)), [["warm"]]);
  }
});
