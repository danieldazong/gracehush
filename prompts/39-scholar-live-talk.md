# 39 · Scholar live talk

Status: approved on 2026-11-13 (the owner's "Implement it"). Part One is being built; Part Two starts on the owner's word.

Read AGENTS.md first and follow it strictly. This plan is written from the test run of 2026-11-12 and 2026-11-13 (AGENTS.md: the vendor note "ElevenLabs Agents with a custom LLM, and LiveKit WebRTC on the iPhone" and the log entry "Step 39 test run"). The test run's code is replaced by this step. Where the two differ, this plan wins.

## Goal

A trial or Pro member can talk with Scholar out loud. They tap **Talk** in a conversation, speak, and hear Scholar answer in the voice they chose from eight. They can cut in at any moment. ElevenLabs only hears and speaks: every answer is written by GraceHush's server with the engine and the rules of step 38, and it is screened before a word of it is spoken. What was said is saved into the same conversation as text.

Screens touched from the V1 list: Conversation (the Talk button and one sheet), Profile (Scholar's Voice, and the ElevenLabs permission), Paywall (a banner and one row). One screen is new, **Scholar Talk**, so V1 becomes eleven screens. The reflection pipeline is not changed.

How success is measured, inside the Analytics Rules: the share of trial and Pro members who start at least one talk in a week (`scholar_talk_started`), and how long talks last (`scholar_talk_ended`).

## Decisions

The design was approved by the owner on 2026-11-12 ("Go"), and eight voices on 2026-11-13 ("yes"). A decision marked **(new)** was not part of those approvals: it is one recommendation with exact values, and it is approved with this plan.

**Ask-first items**

1. Dependencies. The six packages of the test run stay, pinned exactly (AGENTS.md, Decision Making). One is added: `@elevenlabs/client` 1.36.0, pinned exactly, because the app imports its `internal` entry. It is already in `node_modules` (it comes with `@elevenlabs/react-native` 1.2.39) and it is JavaScript only. `expo-keep-awake` is already installed. No new native module, so the development build on the iPhone keeps working and no EAS build is spent before build 10.
2. Native config. `app.json`: the microphone text in both places (the `expo-audio` plugin and the WebRTC plugin) becomes "GraceHush uses the microphone when you record a reflection, speak a message to Scholar or start a live talk." It reaches a phone with build 10.
3. Migration: one additive file, `supabase/migrations/<day>120000_scholar_voice.sql`, named with the day it is written (after `20261111130000`). It adds one server-only table, `scholar_voice_sessions` (step 2). Nothing existing is altered.
4. RLS and storage: row level security on the new table with no policy, and grants to `service_role` only. No storage change.
5. Edge Function deploys (the owner's): new `scholar-voice-end`; replaced `scholar-voice-start` and `scholar-voice-llm`; changed `scholar-turn` (its engine moves into a shared file, with no change of behaviour) and `delete-account` (one more table in its count).
6. Auth integration: unchanged for the phone. ElevenLabs calls `scholar-voice-llm` with a shared secret, and the talk's owner comes only from a session our server signed (step 5).
7. RevenueCat: no product, entitlement or price change. Pricing copy, approved here: opened from Talk, the Paywall shows the banner "Talking with Scholar is part of GraceHush Pro." and a third Scholar row, "Talk with Scholar out loud".
8. Design: there is no Stitch design for the Talk screen. It is built from the design system, with the values of step 11. Its End button is crisis red, as the recording orb is while the microphone is live.
9. ElevenLabs (the owner's account). The Creator plan includes about 275 minutes of talk a month; more costs about $0.08 a minute. Before production the owner opens an ElevenLabs workspace that only GraceHush uses: today's holds the owner's own cloned voices and another project's key.

**Shape**

10. ElevenLabs hears and speaks, and nothing else. Its agent has no model of its own that can answer: no backup model, no filler, no knowledge base, no tools. `scholar-voice-llm` writes every spoken answer with the same engine as `scholar-turn`, in the same order, so nothing is spoken that was not screened first (step 38's rule 31).
11. A talk belongs to a conversation. Each turn is saved as that conversation's messages: the person's words as a message of `input_type` "audio" (the app shows "Transcribed from your voice"), and Scholar's answer with the same blocks as a typed answer. Closing the talk returns to the Conversation screen, which shows them.
12. What is heard is the answer's Listen script (`buildScholarSpeech`): the lead reading, the answer, the supporting reading, a prayer ending in "Amen.", and the spoken help line last when the answer carries one. A reading is the Berean Standard Bible's own text, read by the server, as a passage card is.
13. **(new)** In a talk an everyday answer is shorter: two to four sentences (25 to 70 words) and at most one passage of one to three verses. A `<spoken>` block in the writer's turn asks for it. The instruction itself does not change, and a typed answer's prompt stays the same byte for byte.
14. **(new)** A hard moment in a talk follows step 38's heavy rules, model and checks unchanged. Three things get a spoken form, because nothing is "under this message" in a talk: the block that tells the writer where the help line is (it now says the line is on the person's screen and is read aloud after the answer), and two phrases of the written answers ("the line under this message" and "the link under this message" become "on your screen"; "since you last wrote" becomes "since you last spoke"). The readers approve these with the voice pack (step 8).
15. **(new)** Listen keeps the devotional's voice. Only a live talk uses the ElevenLabs voices.

**Time (measured in the test run: ElevenLabs waits 15 seconds for our first speakable sentence, then gives up on the attempt)**

16. **(new)** Our server speaks the holding lines, never ElevenLabs' own filler, because only our server knows whether the person is in a hard moment. When no answer is ready after 5 seconds Scholar says "Give me a moment to think about that." In a heavy conversation it says "I’m here. Give me a moment.", and after 13 seconds "I’m still here with you."
17. **(new)** An everyday answer has 13 seconds. After that Scholar says "I’m sorry, I couldn’t answer that just now. Could you say it again?" and the message is released, as a failed typed message is.
18. **(new)** A hard-moment answer has 22 seconds to be written for the person. After that, and for any failure, the person hears the written answer and the help line. Never "try again".
19. Step 1 measures whether ElevenLabs allows a long pause after a holding line. If it does not, the 22 seconds of decision 18 become 12 and nothing else changes.
20. A turn is answered once. Its message id is worked out from the talk, the turn's number and its words, so a request ElevenLabs sends again finds the same message: it waits for the answer being written, or replays the saved one. Nothing is screened, written or counted twice.

**Limits (server only; the app shows the numbers the server sends)**

21. Trial and Pro: 30 minutes of talk a calendar month, in the profile's time zone, and at most 10 minutes a talk. Free accounts: no talk (the Paywall).
22. **(new)** A talk's own cap is the smaller of 10 minutes and what is left of the month. Under 30 seconds left counts as used up.
23. **(new)** A talk's turns do not count toward the day's 40 messages or the 30-in-10-minutes rule. A talk has its own limits: 80 turns a talk and 20 talks started a day.
24. A heavy conversation's talk is never counted and never cut by the 10-minute cap.
25. **(new)** Two backstops stand in front of cost, for everyone. ElevenLabs ends any talk at 30 minutes (the agent's own limit, with a calm closing line). And one account can start heavy talks for at most 120 minutes in a day; after that a new talk gets the resting line, while typing, speaking a message and Listen stay open and uncounted.
26. **(new)** A free account in a heavy conversation sees no Talk button, so no paywall ever appears in a heavy conversation. Typing, speaking a message and Listen stay free there.
27. Cost at the prices of 2026-11: at most about $2.40 a member a month at ElevenLabs, plus about $0.003 of Gemini a turn ($0.007 for a hard-moment answer). A full 10-minute talk costs about $0.90.

**Voices**

28. Eight voices, four women and four men, chosen by the owner from a shortlist of twelve of ElevenLabs' ready-made voices (step 0). One of them is the default. Chosen on 2026-11-13 (the owner accepted the agent's picks): Sarah, Bella, Alice and Lily; George, Brian, Eric and Bill; the default is Sarah. These are ElevenLabs' own names for them, never shown in the app.
29. **(new)** Ready-made voices only. A voice from ElevenLabs' community library can be withdrawn by its owner, and the owner's own cloned voices are never offered.
30. **(new)** One Scholar, eight voices: no personas, no photos and no people's names. A voice is named for how it sounds ("Warm", "Steady"), with one line under it ("A woman’s voice · American · warm and reassuring"). The owner sets the names when choosing. The draft names, accepted with the picks and the owner's to change: `warm` "Warm" (Sarah, American, the default), `bright` "Bright" (Bella, American), `clear` "Clear" (Alice, British), `soft` "Soft" (Lily, British), `storyteller` "Storyteller" (George, British), `deep` "Deep" (Brian, American), `steady` "Steady" (Eric, American) and `wise` "Wise" (Bill, American). The first word of each is its key in `voices.ts` and in the app.
31. **(new)** The server decides the voice. Each voice is its own ElevenLabs agent, and the server picks the agent from a list. The phone cannot pass a voice id (that override is switched off), so no build can reach a voice outside the eight.
32. The person chooses the voice at their first talk, and later in Profile under Preferences ("Scholar’s Voice"). Each voice has a Preview, played from a short clip bundled with the app.
33. **(new)** The choice is kept per account on this phone, like the AI permission. A new phone asks again.

**Privacy and safety**

34. A one-time permission sheet before the first talk names ElevenLabs (Apple's guideline 5.1.2(i)). No token is asked for and no microphone opens before Allow. The Google AI permission is needed too, because Google's AI still writes the answers. Profile gets a second switch, "Share Your Voice with ElevenLabs".
35. At ElevenLabs: no recording is kept, retention is 0 days, sentiment analysis and topic discovery are off, and the workspace's "Improve the models for everyone" is off. **(new)** Our server deletes every finished talk at ElevenLabs, in the background, each time a talk starts or ends. No webhook is used. Until a talk is deleted, ElevenLabs holds its words and a summary its own model wrote (there is no switch for the summary). The permission sheet and the Privacy Policy say so.
36. **(new)** A talk ends when GraceHush leaves the screen: the phone is locked or the app goes to the Home Screen. So the microphone is never open on a locked phone. The screen stays awake during a talk. Pulling down Control Center does not end it.
37. Speaking over Scholar stops it within about half a second (measured). **(new)** When a whole turn is only a stop word ("stop", "wait", "hold on", "pause", "one moment", "one second", "just a moment", "be quiet"), Scholar says "Okay." (in a heavy conversation "Okay. I’m here.") with no model call, and nothing is saved. The phrase list still reads the words first.
38. **(new)** Scholar never speaks into a silence and never hangs up on one (both measured). Nothing ends a talk but the person, the caps, leaving the screen, or a lost connection.
39. The opening line says it is AI: "Hi, I’m Scholar, GraceHush’s AI Bible companion. What’s on your heart today?" The line "Scholar is AI and can be wrong. It isn’t a pastor or counselor." stays on the Talk screen the whole time.
40. A heavy turn in a talk: the help line for the person's situation and region is pinned on the Talk screen with its buttons, and its spoken form is read after the answer. No event, no haptic and no log line about it, as in step 38.
41. Two server switches, read on every request: `SCHOLAR_VOICE_ENABLED` and step 38's `SCHOLAR_ENABLED`. With voice off no talk starts. A heavy turn of a talk already running is still answered.
42. The gate before production (step 8): the evaluation with the spoken forms, and a voice pack read and approved by the owner, the pastor and the licensed counsellor. Their names and approval stay out of every committed file. Production keeps `SCHOLAR_VOICE_ENABLED=false` until then.

**Other answers**

43. **(new)** ElevenLabs decides when the person has finished speaking. The agent's setting is "patient", because people pause when they pray or think. The walk-through checks that it does not cut people off.
44. **(new)** Analytics: two events, `scholar_talk_started { voice }` and `scholar_talk_ended { length, ended_by }`, with values from fixed lists. Nothing about a heavy talk. The Talk screen is never a tracked screen.
45. Evaluation budget: $2 of Gemini, enforced by the runner's `--budget`, and about 20 minutes of ElevenLabs talk and speech for the measurements, the previews, the voice pack and the walk-through.
46. The plan is implemented in two parts, as step 38 was: the measurements, the server and its gate (steps 1 to 8), then the app (steps 9 to 13). Part one ends with a report and the owner's hand-offs.
47. Before this step starts, the pending work (step 38's two parts, the tab bar, the test run) is committed and pushed, on the owner's word.

## Out of scope

- Personas, photos, backstories, people's names for voices, cloned or community voices, and a voice changed in the middle of a talk.
- Live captions of what Scholar says, and a passage card shown while it is read.
- Talk started from the Scholar tab's ask bar or from a reflection. It starts from a conversation's composer only.
- Listen in the ElevenLabs voices.
- A talk that goes on while the phone is locked or the app is in the background, a call screen on the lock screen, and Siri.
- An ElevenLabs webhook, a scheduled clean-up, and voice minutes in the data export (they are counts and times, like the day's message counts).
- A voice choice that follows the account to another phone.
- Languages other than English, and Android (after the App Store).
- Memory across conversations and check-ins (after launch).

## What the owner does

Each of these is guided one instruction at a time when its step comes.

1. **Before step 1:** say "commit", so the pending work is committed and pushed first (decision 47).
2. **Step 0:** listen to the twelve sample voices (`listen.html` in the folder named in step 0), pick eight (four women, four men) and the default, and name them or accept the draft names. Done on 2026-11-13: the owner accepted the agent's eight and the draft names (decisions 28 and 30).
3. **Steps 1, 5, 6 and 7:** run `secrets set` and the `functions deploy` commands on the development project, and the migration and the two self-tests in the SQL editor.
4. **Step 8:** send the voice pack to the pastor and the counsellor.
5. **Before production:** open a GraceHush-only ElevenLabs workspace on the plan the owner chooses, switch "Improve the models for everyone" off there, and make its API key (ElevenAgents write, Voices read, Text to Speech). Then the production migration, secrets, agents and deploys.
6. **Outside the code:** the lawyer reads the permission sheet's words, the Privacy Policy's ElevenLabs section and ElevenLabs' terms (its use policy speaks of health data and of emotional dependency).

## Steps

Part one is steps 0 to 8. Part two is steps 9 to 13. Step 14 is the deploy order.

### 0. Before you start: the tree, the baseline, the voices

- **The tree.** `git status` is clean (decision 47). Otherwise stop and ask.
- **The baseline**, run and recorded: `npm run typecheck` and `npm run lint` exit 0. Node suites: scholar 34, journal-data 104, profile-sync 93, recording 68, offline 44 of 44, playback 135, ambient 64, notifications 51, prayers 34, deletion 36, billing 24, account 23, realtime 27, analytics 36, ai-permission 16, affirmations 13, parity 8 of 8. Deno: lint 171 files, fmt 200, the main run 842, export-data 27. PGlite: 88 of 88 and 76 variants, 21 preflight rows. The release gate prints nothing.
- **Saved copies for the byte-for-byte proofs.** Before any edit, save to the scratchpad: `buildScholarInstruction()`, both schemas, `HEAVY_CHAT_SECTION`, and the output of `buildScholarTurn` and of `buildHeavyBlock` for three fixed inputs each (an everyday turn, a turn from a reflection, a heavy turn). Step 4's tests compare the code with them.
- **The voices.** The shortlist is in the folder `gracehush-sounds/scholar-voices`, beside the repo and outside it: twelve ready-made voices (Sarah, Matilda, Bella, Alice, Lily, Jessica, George, Brian, Eric, Chris, Bill and Daniel, ElevenLabs' own names), each saying the opening line, one everyday answer with a reading, and one hard-moment answer with the help line, in the agent's speech model. `listen.html` plays them. The owner picks eight and the default (done: decisions 28 and 30). Step 4 writes the choice into `voices.ts`.

### 1. Four measurements, from this PC, with no phone

The test endpoint and the development agent are still deployed. A Node script in the scratchpad opens a talk over ElevenLabs' WebSocket (a signed URL from the API, the session signed locally with `_shared/voice/session.ts`), sends made-up sentences as `user_message` events, and records when sound and text arrive. Every test talk is deleted afterwards.

The test endpoint gains three test-only options in the extra body, and the owner deploys it once on the development project: `holdLine` (a real sentence after `holdAtMs`, then the answer after `delayMs`, up to 40 seconds), `readyAtMs` (the answer is ready at a wall-clock time, whichever attempt asks), and `empty` (an answer with no words).

- **M1. A pause after a holding line.** A sentence at 5 s, then the answer at 13, 22 and 30 s. Does ElevenLabs speak both and keep the talk? This fixes decision 19: 22 seconds when the 22-second case passes, otherwise 12.
- **M2. A second attempt.** No words for 20 s, with `readyAtMs`. Is the second attempt a new request, and does its answer get spoken? This is what decision 20's tests model.
- **M3. An empty answer.** Does ElevenLabs end the talk, or stay quiet? This fixes what a turn of noise gets: silence when silence is safe, otherwise "Sorry, I didn’t catch that. Could you say it again?"
- **M4. Deleting a talk that has just ended.** Its status 1, 5 and 15 seconds after the end, and what a DELETE answers at each. This fixes the sweep's waits (step 7).

Record the four results in the step's log entry, set the constants of step 4 from them, and put the development agent back as it was (17 of 17 checks).

### 2. The migration, its checks and the predicted types

`supabase/migrations/<day>120000_scholar_voice.sql`, idempotent, ending with `notify pgrst, 'reload schema';`.

- **`scholar_voice_sessions`**: `id uuid primary key` (the talk's id, made by the server), `user_id text not null` (a foreign key to `users_profile` with `on delete cascade`), `conversation_id uuid not null` (no foreign key: deleting a conversation must not give minutes back), `voice text not null`, `started_at timestamptz not null default now()`, `last_turn_at timestamptz`, `ended_at timestamptz`, `cap_seconds integer` (null for a talk with no cap), `seconds integer not null default 0`, `turns integer not null default 0`, `is_heavy boolean not null default false`.
- Rules in the table: `seconds` between 0 and 1,900, `turns` at least 0, `cap_seconds` null or between 30 and 600, `voice` 1 to 24 characters. An index on `(user_id, started_at desc)`.
- Row level security on, no policy, everything revoked from `anon` and `authenticated`, granted to `service_role` only (as `deleted_devotionals`).
- **Checks:** `rls_selftest.sql` gains four (89 to 92): the table and its rules, the app and a visitor can neither read nor write it, the cascade with the account, and no foreign key to the conversation. `preflight.sql` gains row 22. `run-in-pglite.mjs` gains five broken variants (readable by the app, row level security off, no cascade, a foreign key to the conversation, default grants kept): 81 in all.
- **Types.** `src/types/supabase.ts` gets the table by hand, to the predicted download. The owner's download after the migration must equal it, formatting aside. `src/types/database.ts` leaves the table out: the app never reads it.
- **Account deletion.** `delete-account/lifecycle.ts` counts the new table after the cascade, with the others.

Done when: PGlite passes the fourteen migrations twice under both settings, 11 of 11 and 92 of 92 twice each, nothing left behind, 22 preflight rows, and 81 variants as expected.

### 3. One engine for a typed message and a spoken turn

Today `scholar-turn/handler.ts` holds everything from "one read of everything" to the saved answer (`run` and `answerMessage`). It moves, with no change of behaviour, into `supabase/functions/scholar-turn/turn.ts`:

- `runTurn({ admin, userId, request, config, context, talk })` returns the `ScholarTurnResponse` or throws the same `AppError` as today.
- `handler.ts` keeps the HTTP part: the method, the Clerk token, the body, the log line, and `jsonResponse(200, await runTurn(...))`.
- **The proof of "no change":** every test of `scholar-turn/handler_test.ts` passes with no edit but imports.

`talk` is null for `scholar-turn`. For a spoken turn it is `{ talkId, startedAt, heavyDeadlineAt, answerDeadlineAt }`, and it changes exactly these things, each with a test:

1. The person's message is stored with `input_type` "audio" and its words at once. There is no recording to read or delete.
2. The 30-in-10-minutes rule, the day's allowance, the free budget and the plan re-read are skipped (the plan was checked when the talk started). `usage` is null and nothing is added to the day's count.
3. The everyday writer's turn carries the `<spoken>` block (step 4), with its own time: one attempt of 5 seconds, 13 seconds in all.
4. The request's deadline is `heavyDeadlineAt`, and the heavy block and the written answers use their spoken forms.
5. A message that is already being answered is waited for (a look every 300 ms) and not refused with `ALREADY_PROCESSING`.

Everything else is the same code path: the read, the replay, the conversation, the claim, the phrase list, the screening with the answer written at the same time and held, the confirmation of an emergency, the heavy path with its judge, the written answers, the passages, the typed-verse guard, the under-18 rule, the save, the anonymous counters.

### 4. The voice rules

New files under `supabase/functions/_shared/voice/`, each with a test file:

- **`constants.ts`**: `VOICE_LIMITS` (`monthSeconds` 1,800, `talkSeconds` 600, `minTalkSeconds` 30, `backstopSeconds` 1,800, `maxTurns` 80, `startsPerDay` 20, `heavySecondsPerDay` 7,200) and `voiceTiming` (`holdMs` 5,000, `secondHoldMs` 13,000, `answer` `{ attemptMs: 5_000, totalMs: 13_000 }`, `heavyTotalMs` 22,000 or 12,000 by M1, `joinPollMs` 300, `maxWords` 2,000 characters of a turn).
- **`lines.ts`**: every fixed line Scholar can say that no model wrote. All are drafts for the readers:
  - the opening: "Hi, I’m Scholar, GraceHush’s AI Bible companion. What’s on your heart today?"
  - the holding lines of decision 16 and the not-ready line of decision 17;
  - a turn with no words: "Sorry, I didn’t catch that. Could you say it again?" (or silence, by M3);
  - the stop lines of decision 37;
  - the cap: "That’s our time for this talk. Everything we said is saved in your conversation, and you can keep writing to me there."
  - voice switched off during a talk: "I need to stop talking for now. Your conversation is saved, and you can keep writing to me there."
  - a session that is not valid any more: "This talk has ended. Please start a new one."
  - the 30-minute backstop, spoken by the agent itself: "We’ve talked for a long while, so this talk will end here. Your conversation is saved, and you can start a new talk or keep writing to me."
  - a test keeps every line free of a claim Scholar may not make (a person, a pastor, a counsellor, "confidential", "private", a promised outcome) and in typographic punctuation.
- **`stop.ts`**: `isStopOnly(words)`: the whole turn, lowercased and without punctuation, equals one entry of the list of decision 37, with or without "okay", "please" or "Scholar" around it.
- **`turnId.ts`**: `turnMessageId(secret, talkId, turnNumber, words)`: a canonical version 4 UUID made from an HMAC-SHA256, so it passes the engine's id check and cannot be guessed.
- **`voices.ts`**: the eight voices (`key`, ElevenLabs' public voice id), the default key, and `readVoiceAgents()`, which reads the secret `ELEVENLABS_AGENTS` (one JSON object, voice key to agent id) and fails with `bad_config:ELEVENLABS_AGENTS` when a key is missing.
- **`allowance.ts`**: `checkTalkAllowance({ tier, heavy, monthSeconds, heavySecondsToday, startsToday })` and `billableSeconds(session)`. `_shared/limits/weekly.ts` gains `monthWindow(now, timeZone)` beside `dayWindow`.
- **`sse.ts`**: the OpenAI-format stream (the test endpoint's `chunk` helpers).
- **`sweep.ts`**: `sweepFinishedTalks(config)` (step 7).
- **`session.ts`** (changed): the signed session carries the user, the talk, the conversation, the reflection or null, the region and the voice. It is accepted for 32 minutes.
- **`agent_setup.ts`** (changed): one agent per voice. It creates or updates all eight from `voices.ts` and writes their ids as `ELEVENLABS_AGENTS` into the local secrets file. New or changed settings, each with a check: the opening line; the voice override off (only the signed session may be passed); the speech model pinned (`eleven_v4_turbo`, stability 0.5, similarity 0.75, speed 1); `turn_eagerness` "patient"; `noisy_environment_detection` off; `max_duration_seconds` 1,800 with the backstop line as `max_conversation_duration_message`. The 17 checks of the test run stay.

Changed files under `_shared/scholar/`:

- **`prompt.ts`**: `buildScholarTurn({ ..., spoken })` adds the `<spoken>` block after the message. `SCHOLAR_SPOKEN_VERSION` is `spoken-v1`, and a spoken turn's log line says `scholar-v2/spoken-v1`. `SCHOLAR_PROMPT_VERSION` stays `scholar-v2`. The block's text:
  - this turn is part of a live spoken talk: the answer is read aloud and nothing is shown;
  - two to four short sentences, 25 to 70 words;
  - at most one passage in all, of one to three verses: `lead_passage` when they asked about a passage (it is read before the answer), otherwise `passage` (read after it);
  - nothing that depends on being seen (no list, no heading);
  - a prayer only when they ask for one.
- **`heavyChat.ts`**: `buildHeavyBlock({ ..., spoken })` and `spokenFallback(text)`, the three spoken forms of decision 14 and nothing else.
- **Tests:** without `spoken`, `buildScholarTurn`, `buildHeavyBlock` and the written answers equal step 0's saved copies byte for byte. With it, only the named sentences differ.

### 5. `scholar-voice-start`

`POST { conversationId, entryId?, voice, region? }` with the Clerk token answers `{ talkId, conversationId, conversationToken, session, voice, heavy, limits }`. `limits` is `{ talkSeconds, monthSecondsLeft, resetsAt }`, with the two numbers null for a heavy conversation. Both contract copies and `contractParity.ts` gain the types. `ScholarUsageKind` gains `talk_plan` and `talk_month`.

The order:

1. The method, the token, the body (at most 2 KB; an unknown key is `INVALID_REQUEST`).
2. The switches: `SCHOLAR_VOICE_ENABLED` or `SCHOLAR_ENABLED` off is `SCHOLAR_UNAVAILABLE`.
3. One read: the profile, whether Scholar is closed for the account, the conversation (this id, else the person's conversation for this reflection, else a new one, by step 38's rules), this month's sessions, today's starts and today's heavy seconds.
4. A closed account (under 18) is `SCHOLAR_ADULTS_ONLY`.
5. The plan, with `confirmPaidPlan`. A free account is `LIMIT_REACHED` with `usage.kind` `talk_plan`.
6. More than 20 starts today is `RATE_LIMITED`.
7. The allowance. A heavy conversation is exempt, up to decision 25's 120 minutes a day (then `SCHOLAR_UNAVAILABLE`). Otherwise under 30 seconds left this month is `LIMIT_REACHED` with `talk_month` and `resetsAt`.
8. The account's sessions that never ended are closed at their last activity.
9. The voice: an unknown key becomes the default. The agent comes from `ELEVENLABS_AGENTS`.
10. The ElevenLabs token (8 seconds). A failure is `AI_UNAVAILABLE`; ElevenLabs at capacity is `SCHOLAR_UNAVAILABLE` (`voice:capacity`).
11. The session row, then the signed session.
12. After the response: the sweep (step 7).

The log line is the shared one (43 fields). Its reason is `voice:start` or the error's own word. It never holds the token, the session or the voice.

### 6. `scholar-voice-llm`

ElevenLabs calls it once for each turn of a talk, in the OpenAI chat format, and speaks what it streams back. The order is fixed, and it is what keeps a person safe:

1. POST only. The shared secret, compared in constant time. A wrong or missing one is 401.
2. The body (at most 256 KB). Only two things are read from it: the newest message of role `user`, and `elevenlabs_extra_body.session`. ElevenLabs' own prompt, history and tools are ignored: the engine reads the conversation from our database.
3. The session: signed by us, not expired, and its row found for that user. Otherwise Scholar says the ended line and nothing else happens.
4. The words: trimmed and cut to 2,000 characters. With no letter or digit, the M3 answer, and nothing is saved.
5. The phrase list reads the words. When it does not match and the turn is only a stop word: the stop line, and nothing is saved.
6. The switches. Voice or Scholar off: a clear conversation gets the switched-off line, and a heavy conversation's turn goes on (step 38 gives it the written answer when Scholar is off).
7. The caps, for a clear conversation only: past the talk's cap, or past 80 turns, Scholar says the cap line.
8. The turn. Its message id comes from `turnMessageId`. `runTurn` starts inside `EdgeRuntime.waitUntil`, so the answer is finished and saved even when ElevenLabs stops listening to this request (the person spoke again, or the attempt was given up).
9. The stream, while the turn runs:
   - the holding line when nothing is ready after 5 seconds, and the second one after 13 seconds in a heavy conversation;
   - then the answer, as the sentences of `buildScholarSpeech(blocks, { helpLine })`, with `spokenHelpLine(help, region)` when the answer carries a help line;
   - an error in a clear conversation: the not-ready line.
10. After the stream: the session row's `last_turn_at`, `turns` and `seconds`, and `is_heavy` when the conversation is heavy.

What a person never hears in a talk: words a model wrote that were not screened, a reading that is not the Berean Standard Bible's own text, an error message, or silence where step 38 promises an answer.

The log line is the shared one. Its reason is one of `voice:answered`, `voice:heavy`, `voice:emergency`, `voice:fallback:<why>`, `voice:replayed`, `voice:joined`, `voice:not_ready`, `voice:stop`, `voice:unheard`, `voice:cap`, `voice:off`, `voice:ended`. It never holds a word that was said or spoken, an id, a help line or the voice.

### 7. `scholar-voice-end`, and deleting talks at ElevenLabs

`POST { talkId }` with the Clerk token answers `{ limits }`. It sets the session's `ended_at` and `seconds`. Another person's talk and a missing one are the same `NOT_FOUND`. Calling it twice changes nothing.

- **What a talk costs the person:** `seconds` is the time from the start to the end or the last turn, whichever is later, and never more than the talk's cap. A talk in a heavy conversation counts 0. The month's total is the sum over the person's sessions that started in the month.
- **The sweep** (`sweepFinishedTalks`) runs after the response of every start and every end, with the waits M4 gives. It lists the conversations of our eight agents only, and deletes each one that has ended. It never touches a talk that is still running, or anything of another agent in the workspace. At most 30 deletions a run, each with a 15-second limit. A failure is logged as one word and tried again at the next run.

### 8. The gate: the evaluation and the voice pack

- **Evaluation.** `run_scholar_eval.ts` gains `--spoken`: the three sets are written as a talk would write them. Bars: every bar of step 38 still holds; an everyday spoken answer is 20 to 90 words in at least 18 of 20 and names at most one passage in at least 19 of 20; every hard check of the 27 hard moments passes; no answer says "under this message" or "wrote". Made-up conversations only. The screening does not change, so its evaluation is not run again.
- **The voice pack**, `scholar-eval/voice-pack.md` (git-ignored), written by the runner for the owner, the pastor and the counsellor:
  - every fixed line of `lines.ts`, and when it is said;
  - the spoken forms of decision 14 beside the written ones;
  - the stop rule, the silence rule, the rule that a talk ends when the app leaves the screen, and the limits of decisions 24 to 26;
  - five hard-moment answers as they are spoken, with their spoken help line;
  - sound files (git-ignored) of the opening line, the holding lines and two hard-moment answers in each of the eight voices.
- Production keeps `SCHOLAR_VOICE_ENABLED=false` until all three have approved. The pack is read again when a fixed line, a spoken form or a voice changes.

**Part one ends here**, with a report and the owner's hand-offs: the development migration, secrets, the eight development agents (`agent_setup.ts`), the deploys, and the pack to the readers.

### 9. The app's data layer and the talk service

Red first: the scholar suite gains its talk checks, and they fail on modules that cannot be resolved.

- **Types and gateway.** `src/types/index.ts` gains step 5's and step 7's types. `src/api/journalApi.ts` gains `scholarVoiceStart` (15 s) and `scholarVoiceEnd` (10 s), in the database's region, with hand-written guards.
- **Support.** `src/services/voiceSupport.ts`: `voiceSupported()` is true only when `NativeModules.WebRTCModule` and `NativeModules.LivekitReactNativeModule` exist. Expo Go has neither, so the Talk button never shows there.
- **The session setup.** `src/services/voiceSession.ts` is the test run's `voiceSessionSetup.ts` with both iPhone fixes (close the connection before the audio session; the input-mixer mute mode before each talk). It is installed right before each talk starts. Only the Talk screen imports it and the ElevenLabs package.
- **The talk's state**, `src/services/scholarTalk.ts`, with no ElevenLabs import, so the Node checks can run it:
  - `beginTalk({ conversationId, entryId })`, `attachTalkControls(controls)`, `talkEvent(event)`, `setTalkMuted(muted)`, `endTalk(reason)`, `getTalkState()`, `subscribeTalk(listener)`;
  - the state: the phase (`starting`, `connecting`, `live`, `ending`, `ended`), who is speaking (`listening`, `thinking`, `speaking`), `muted`, `heavy` and its help line, the seconds left or null, and why it ended;
  - before a talk: the devotional, the ambient bed, Listen and any preview are stopped; during it: the screen stays awake (tag `gracehush-talk`); after it: `setSessionMode("playback")`, and `scholarVoiceEnd`;
  - it ends the talk when `AppState` becomes `background` (never for `inactive`), when the cap is reached (after Scholar finishes its sentence, or 20 seconds later), on a disconnect and on an error;
  - after each of Scholar's answers it reads the conversation again from the server, and takes `heavy`, the help line and the cap from it. In a heavy conversation the countdown stops.
- **Repository.** `src/data/scholarRepository.ts` gains `startTalk` and `finishTalk`. `startTalk` refuses without the Google AI permission and without the voice permission, while the phone is known to be offline, and on the mock data, each with no request.
- **Preferences.** `profilePrefsStore` gains `voicePermissionAt` and `scholarVoice` per account (still version 2; a save without them reads as no permission and the default voice). `useVoicePermission()` and `useScholarVoice()` read them. Account deletion forgets them; sign-out keeps them.
- **The voices on the phone.** `src/constants/scholarVoices.ts`: the eight keys with their names, descriptions and preview clips. A Node check keeps its keys equal to the server's `voices.ts`.
- **Previews.** `assets/audio/scholar-voices/{key}.m4a`: each voice saying the opening line (about 5 seconds, AAC 64 kbps mono, about 45 KB each), made once by a script with ElevenLabs' speech API and the agent's model. `src/constants/sounds.ts` exports them. `samplePlayer.ts` learns to play a given sound, so no new player is added.
- **Constants.** `src/constants/app.ts`: `SCHOLAR_VOICE_START_TIMEOUT_MS` 15,000, `SCHOLAR_VOICE_END_TIMEOUT_MS` 10,000, `SCHOLAR_TALK_WARNING_S` 30, `SCHOLAR_TALK_END_GRACE_MS` 20,000, `SCHOLAR_TALK_LOW_S` 300. No limit number.

### 10. The Talk button, the permission sheet, the voice picker

- **The Talk button** sits in the composer's Type row beside the microphone while the field is empty: a 44 plum circle with a white waveform (`waveform` on iOS, `graphic_eq` on Android), labelled "Talk with Scholar", with the hint "Starts a live voice talk". It shows only when `voiceSupported()`, and not for a free account in a heavy conversation.
- **A tap**, in this order:
  1. A free account: the Paywall with `{ source: "scholar", reason: "talk" }`.
  2. No voice permission yet: the Talk sheet (below).
  3. The microphone permission, asked with the recorder's own functions. Off: the existing card ("Microphone access is off…").
  4. The Talk screen.
- **The Talk sheet** is one `BottomSheet` with two steps, so no sheet has to open another:
  - Step 1, the permission. Title: "Allow ElevenLabs to hear and speak for Scholar?" Body: "In a live talk, your voice goes to ElevenLabs, which turns it into text and speaks Scholar’s answers. Google’s AI still writes the answers, as it does when you type." Then: "ElevenLabs keeps no recording. GraceHush deletes each talk’s record there soon after it ends, and has switched off its use of your talks to train its models." Caption: "Nothing is sent until you tap Allow." Buttons: a filled "Allow", a ghost "Not now", and a "Privacy Policy" link. These words are drafts for the owner and the lawyer.
  - Step 2, the voice. Title: "Choose Scholar’s voice". The eight voices as rows (the name, the one-line description, a Preview button), one selected, and a filled "Start talking". "You can change this in Profile."
  - The scrim, the Android back key and "Not now" close the sheet and send nothing.
- **Profile.** Preferences gains "Scholar’s Voice", which expands in place like Ambient Soundscape and shows the same rows. Privacy & Account gains the switch "Share Your Voice with ElevenLabs" under the Google one. Both show only when `voiceSupported()`.
- **Haptics:** a `selection` tick for a changed voice and for the Profile switch. Nothing else in this step makes a haptic.

### 11. The Talk screen

`src/screens/scholar/ScholarTalkScreen.tsx`, the route `ScholarTalk: { conversationId, entryId? }`, a `fullScreenModal` with its own safe-area provider (`modalLayout`). The navigator loads its file only when the route opens (`getComponent`), so Expo Go never loads the ElevenLabs package.

- **Layout**, on linen:
  - a header row: a Close button (X, 44), the title "Scholar", and nothing on the right;
  - under it, centred, the line "Scholar is AI and can be wrong. It isn’t a pastor or counselor." in 13/19 mauve;
  - in the middle, the orb: the brand mark in a 120 white circle with a petal border and `shadows.card`, inside a 168 halo in plum at 12%;
  - under the orb, the status in `text-section`: "Connecting…", "Listening", "Scholar is thinking…", "Scholar is speaking", "Muted";
  - under the status, one quiet line when it applies: "30 seconds left", or the talk's ended line;
  - in a heavy conversation, `HelpLine` for the conversation's help line and the phone's region, above the controls;
  - at the bottom, two round buttons 24 apart: Mute (56, white with a petal border, `mic.slash` or `mic_off`, labelled "Mute" or "Unmute") and End (64, crisis red as the recording orb is while the microphone is live, a white `phone.down.fill` or `call_end`, labelled "End talk").
- **Motion.** The halo breathes slowly while listening (2 seconds, as the recording halo), a little faster while Scholar speaks, and is still while muted, while thinking and under Reduce Motion. Nothing else moves.
- **States:** connecting (a small spinner in the orb); could not start ("Scholar couldn’t start a talk just now." with "Try again" and "Close"); live; ended by the cap ("This talk reached its time. Your conversation is saved."); ended because the app left the screen, shown on return ("The talk ended when you left GraceHush."); the connection dropped ("The talk was interrupted. Your conversation is saved."). Each ended state has one button, "Back to conversation".
- **Leaving.** Close, End and the Android back key end the talk and go back. The Conversation screen then reads the conversation again and shows the new turns.
- **After a talk**, the Conversation screen shows one calm line when little is left: "About 4 minutes of talk left this month." And when the month is used up, a tap on Talk shows: "You’ve used this month’s talk time. It returns on {date}." with no Paywall (the account already has Pro).
- **Screen readers.** The status is a polite live region. Both buttons carry their state in their label.

### 12. The Paywall, analytics, sign-out, the developer panel

- **Paywall.** `reason: "talk"` shows decision 7's banner. The Scholar rows gain "Talk with Scholar out loud". `copy.paywall.scholar` holds both.
- **Analytics.** `scholar_talk_started { voice }` once a talk is live, and `scholar_talk_ended { length: "under_1" | "1_to_5" | "over_5", ended_by: "person" | "cap" | "left_app" | "dropped" }`. Neither is sent when the conversation is or becomes heavy. `paywall_viewed` is unchanged. `ScholarTalk` is not a tracked screen.
- **Sign-out.** `signOutCleanup` ends a live talk first. Nothing of a talk is stored on the phone.
- **Copy.** `copy.scholar.talk`, `copy.voicePermission` and `copy.profile.scholarVoice` hold every new string, in typographic punctuation, with "GraceHush" spelled so.
- **Developer panel.** The "Live voice test (dev)" group, `VoiceSpike.tsx` and `voiceSessionSetup.ts` are deleted. A "Talk (dev)" group shows: supported yes or no, the permission, the voice key, the last start's code, and "Reset voice permission (dev)".

### 13. Documents, the website, the store forms

- **Privacy Policy:** ElevenLabs as a provider (what it receives: the voice in a live talk and the words of Scholar's answers; what it keeps and for how long; that GraceHush deletes each talk's record; that training on it is switched off; the United States), the permission and where to change it, and the table row.
- **Terms of Use:** a live talk is AI, it is not for emergencies, it needs Pro, and its monthly time.
- **The Scholar safety page:** a section "Talking with Scholar": the same check before a word is spoken, the help line on the screen and read aloud, what ends a talk, and that a talk never ends the conversation.
- **The support page and the legal brief** (a section 6b: the permission's words, ElevenLabs' terms, what is kept).
- The site is rebuilt with the day the pages go live, and uploaded by the owner before voice is switched on in production.
- **Store forms** (AGENTS.md, Before a store build): the microphone purpose, ElevenLabs among the third parties, and a review note that says how to reach Talk and that it needs Pro.

### 14. Deploy order and the builds

On the development project first, then production:

1. The migration, `rls_selftest.sql` (92 of 92), `selftest.sql` (11 of 11), the types download.
2. The secrets. New: `ELEVENLABS_AGENTS` and `SCHOLAR_VOICE_ENABLED` (`true` on development, `false` on production). Kept: `ELEVENLABS_API_KEY`, `ELEVENLABS_LLM_SECRET`, `SCHOLAR_VOICE_SESSION_SECRET`, and `ELEVENLABS_LLM_SECRET_ID`, which only the setup script reads. Removed: `ELEVENLABS_AGENT_ID`. Production gets its own values for all of them, never development's.
3. The agents: `agent_setup.ts` for the project's own functions address, then its checks.
4. The deploys, in this order: `scholar-turn`, `scholar-voice-start`, `scholar-voice-llm`, `scholar-voice-end`, `delete-account`. Then the probes with no sign-in.
5. The phone walk-through on the development build that is already on the iPhone (no new build: nothing native changes but the microphone text).
6. The voice pack to the readers.
7. Production: steps 1 to 4 with `SCHOLAR_VOICE_ENABLED=false`, the site upload, then TestFlight build 10, its check, and the switches.

## Verification

- **Lint and types:** `npm run typecheck` and `npm run lint` exit 0 with no messages.
- **Existing suites:** every Node suite at its baseline or higher. The scholar-turn Deno tests pass with no edit but imports (step 3's proof).
- **New Deno tests:** the voice rules (lines, stop words, turn ids, the allowance and the month, the session, the stream, the sweep, the agent's settings), `scholar-voice-start`, `scholar-voice-llm` and `scholar-voice-end` against the fake world, which gains the session table and a fake ElevenLabs (the token, the list of talks, a DELETE).
- **New Node checks** in the scholar suite: the two gateway calls; no start without either permission, offline or on the mock data; the talk's state through every phase; the cap and its countdown; ending on `background` and not on `inactive`; a heavy talk (the help line, no countdown, no event); the audio stopped before and the playback mode put back after; the voice keys equal to the server's; the copy.
- **Edge Functions:** every Deno `check`, `lint`, `fmt --check` and `test` command of AGENTS.md with the three voice functions added, each also checked with its own `deno.json`.
- **Database:** PGlite, as step 2 says.
- **Byte for byte:** without `spoken`, the instruction, both schemas, the heavy section, the turn, the heavy block and the written answers equal step 0's saved copies.
- **Render check** in a scratch harness (not in the repo): the Talk button's four cases, both steps of the sheet, the voice rows, every state of the Talk screen, the pinned help line.
- **Breakages** in a scratch copy, never the repo, each caught by a named check. At least:
  - an answer streamed before the screening has answered;
  - a heavy turn given the not-ready line, the cap line or silence;
  - a heavy talk counted, or cut at 10 minutes;
  - a turn written twice for one request sent twice;
  - the user read from the body and not from the signed session;
  - a session signed for another user accepted, and an expired one accepted;
  - a wrong shared secret accepted;
  - ElevenLabs' own history or prompt reaching the writer;
  - a stop word answered by a model, and a stop word that hides a phrase of the phrase list;
  - a holding line of the everyday kind in a heavy conversation;
  - the spoken forms leaking into a typed answer;
  - the sweep deleting a running talk, or another agent's talk;
  - a voice id passed by the phone used;
  - a free account given a token;
  - a start with no voice permission; a talk that goes on in the background; the microphone left open after End;
  - an event sent about a heavy talk; a limit number in the app.
- **Bundles:** exports for iOS and Android, one platform and one worker at a time, searched for the new strings. The release gate still prints nothing.
- **Safety:** a made-up heavy sentence in a talk gets an answer and the spoken help line, the help line is pinned, and nothing is counted. With voice switched off it is still answered.
- **Privacy:** no word that was said or spoken in any log; the agents list no finished talk a minute after a talk ends; nothing of a talk on the phone.
- **Phone walk-through:** the checks below.

## Phone walk-through

Before B0:

- **Restart:** `npx expo start -c --dev-client`, then a force-quit of the development build (new files, assets and a changed `package.json`). No new EAS build: the build on the iPhone already holds the native modules. Expo Go cannot run a talk.
- **Account and data:** the development test account, with the Google AI permission allowed, sharing usage data on, one ready reflection, and a conversation with at least one answer. It starts on the free plan (B1), then gets Pro through a Test Store purchase (it lasts about an hour, then renews a few times). `SCHOLAR_ENABLED` and `SCHOLAR_VOICE_ENABLED` are `true` on the development project.
- **Cost:** about 15 minutes of ElevenLabs talk and about 30 Scholar turns: under $0.30 of Gemini.
- **The app stays open and in front**, except in B10.
- With the owner's yes the agent presses the app's own buttons, and sends made-up sentences as text where a check does not need the owner's voice. The owner speaks, listens, locks the phone and makes the purchase. The phone's region is Nigeria, so the help line is the outside-the-US one; the US forms are covered by the tests.

**B0. The starting state**
- **Do:** open the app on Journal.
- **Expect:** the development build (not Expo Go); the current code; signed in as the test account; data source `supabase`; the plan free; `voiceSupported()` true; no voice permission; no session row this month.
- **Read:** the stores and a constant of the new code through the inspector; the owner runs a count query the agent writes.

**B1. A free account**
- **Do:** open the conversation and tap Talk.
- **Expect:** the Paywall with "Talking with Scholar is part of GraceHush Pro." and the row "Talk with Scholar out loud"; no request to `scholar-voice-start`; `paywall_viewed` with source `scholar`. Then the owner makes the Test Store purchase.
- **Read:** the navigation state, a fiber walk for the copy, the gateway's last call, the analytics queue by name.

**B2. The permission**
- **Do:** tap Talk, then "Not now". Tap Talk again, then "Allow".
- **Expect:** after "Not now": no request, no microphone, the sheet closed. After "Allow": step 2 with eight voices and the default selected.
- **Read:** the gateway's last call, the prefs store, the native recording getter, a fiber walk.

**B3. The voice**
- **Do:** tap Preview on two voices, choose one, tap "Start talking".
- **Expect:** each preview plays and the first stops when the second starts (heard: the owner's one word); the choice saved; `scholar-voice-start` 200; a session row with that voice; the Talk screen "Connecting…", then "Listening" within about 5 seconds; the opening line heard in the chosen voice.
- **Read:** the recorder's times; the prefs store; the owner's query; the owner's one word for the sound.

**B4. An everyday question**
- **Do:** the owner asks out loud: "What does Psalm 23 say about rest?"
- **Expect:** an answer within about 6 seconds: a reading, then two to four sentences. On the server: the question as an `audio` message with its words, and the answer with a verified passage. The day's message count unchanged. `scholar_talk_started` sent once.
- **Read:** the times; `selectMessages`; the owner's usage query; the passage compared with the public Bible API by the phone.

**B5. Cutting in, and "wait"**
- **Do:** the owner asks another question, speaks over the answer, then says "Wait."
- **Expect:** Scholar stops within about a second of the owner's voice; after "Wait." it says "Okay." within about 2 seconds, and no message is saved for it.
- **Read:** the recorder's times; the message count before and after.

**B6. Mute**
- **Do:** the agent presses Mute, the owner speaks for 5 seconds, the agent presses Unmute.
- **Expect:** "Muted"; no turn reaches the server while muted; "Listening" again.
- **Read:** the microphone track's sent energy (0 while muted); the session row's `turns`.

**B7. Silence**
- **Do:** nobody speaks for 30 seconds.
- **Expect:** Scholar says nothing, the talk stays live, no turn is counted.
- **Read:** the recorder; the session row.

**B8. A hard moment**
- **Do:** with the owner's yes, the agent sends one made-up heavy sentence as text.
- **Expect:** "I’m here. Give me a moment." when the answer takes over 5 seconds; then an answer and the spoken help line; `HelpLine` pinned with the region's button; no countdown; the conversation heavy on the server; no analytics event from here on.
- **Read:** the times; a fiber walk; `selectConversation`; the analytics queue.

**B9. The end**
- **Do:** the agent presses End.
- **Expect:** disconnected within a second; the microphone off; `scholar-voice-end` 200; the session ended with 0 billable seconds (a heavy talk); the Conversation screen with the new turns; within a minute ElevenLabs lists no finished talk for our agents.
- **Read:** the recorder; the native getters; the owner's query; the agent's read of ElevenLabs' list (counts only).

**B10. Leaving the screen**
- **Do:** in a new conversation the owner starts a talk, pulls Control Center down and up, then locks the phone for 20 seconds and unlocks it.
- **Expect:** Control Center changes nothing. The lock ends the talk: nothing was heard or sent while locked, and on return the line "The talk ended when you left GraceHush."
- **Read:** the recorder (the app state and the talk's phase by time); the session row's `turns`; the owner's one word.

**B11. The cap**
- **Do:** the owner runs a statement the agent writes, which leaves the test account 60 seconds of talk this month, then starts a talk and lets it run.
- **Expect:** `limits.talkSeconds` 60; "30 seconds left" at 30 seconds; at 60 the cap line and the ended state; the session's `seconds` 60. Then a tap on Talk shows the month line with a date and no Paywall. The owner removes the test row with a second statement.
- **Read:** the talk state by time; the session row; a fiber walk.

**B12. Another voice, from Profile**
- **Do:** in Profile open "Scholar’s Voice" and choose another voice. Start a talk.
- **Expect:** the row shows the new name; the session row holds the new key; the opening line in the new voice (the owner's one word).
- **Read:** the prefs store; the owner's query.

**B13. The permission taken back**
- **Do:** in Profile switch "Share Your Voice with ElevenLabs" off, then tap Talk.
- **Expect:** the permission sheet again, and no request. Switch it back on.
- **Read:** the gateway's last call; the prefs store.

**B14. A headset and a timer (what the phone does)**
- **Do:** with a Bluetooth headset on, start a talk and ask a question. Then let a 1-minute Clock timer ring during a talk.
- **Expect:** the talk is heard and heard from through the headset. For the timer the result is recorded, whatever it is: the talk ends calmly or goes on, and in both cases End works and the microphone is released.
- **Read:** the recorder; the native getters; the owner's one word.

**B15. The logs and ElevenLabs**
- **Do:** the owner exports the logs of the three voice functions.
- **Expect:** every line has exactly the 43 fields, the reasons match the checks above, and no word, id, voice or help line appears. ElevenLabs lists no talk with words for our agents.
- **Read:** a script outside the repo; the agent's read of ElevenLabs' list.

Not verified on this target, and where: Android (after the App Store); VoiceOver during a talk; a phone call during a talk (the owner arranges one, or TestFlight); a car; the US help lines by ear (the tests cover the words); a talk of the full 10 minutes.

## AGENTS.md updates

- **Instructional Memory:** the eight voices, and that a talk ends when the app leaves the screen.
- **Project Overview, Important Constraints:** eleven screens; Scholar Talk; live voice no longer "step 39, later".
- **Tech Stack and Decision Making:** `@elevenlabs/client` as a direct dependency; ElevenLabs among the external services.
- **Architecture tree:** the new files of steps 3 to 12, and the test files removed.
- **Navigation Map:** the `ScholarTalk` route, and what ends a talk.
- **Screen Specifications:** 10 (the Talk button and sheet) and a new 11 (Scholar Talk); 7 (the two Profile rows); 8 (the Paywall's banner and row).
- **Design System, UI Quality Bar:** the orb and its halo; the two new haptic moments.
- **Backend / Edge Function Rules:** the secrets; `scholar-voice-start`, `scholar-voice-llm`, `scholar-voice-end`; the shared engine; the deploy order.
- **Crisis Safety Rules, "Scholar's heavy moments":** a hard moment in a talk, the spoken forms, the holding lines, the backstops, and the voice gate.
- **AI Permission Rules:** the ElevenLabs permission, its gate and its words.
- **Analytics Rules:** the two events (twenty-two in all).
- **Subscription Rules:** talk as a Pro benefit, and its limits on the server.
- **Audio Rules:** the talk's audio session, what stops before it and what is put back after it.
- **Scholar Data Rules:** a talk's turns are the conversation's messages; nothing of a talk is kept on the phone.
- **Database Rules:** the fourteenth migration.
- **Linting and Validation:** the three functions in the Deno commands, `--spoken`, and "Before a store build".
- **Vendor notes:** what steps 1 and the walk-through measure.
- **Build Status & Decisions Log:** the step's entries.
