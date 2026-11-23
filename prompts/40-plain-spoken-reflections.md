# 40 · Plain-spoken reflections (gen-v2.7)

Read AGENTS.md first and follow it strictly.

The project lead tested TestFlight build 11. He found the voice natural and the words wrong: "it sounds so structured, so organized. The grammar is so complex. Like 'gazing forward' … a human being does not talk like that." The owner asked for every reflection to sound "as human as possible, like a real human that a 9 years old can understand". The same day the owner found a second fault: the reflections speak to the wrong part of the day, with bedtime advice in the morning and waking-up words at night. This step rewrites the reflection's instruction so that it talks like a caring Christian friend and never assumes the time of day, adds two soft checks in code, and changes the evaluation so it rewards plain speech instead of a sermon. It is a server change only: one deploy of `process-entry`, no app build, no migration, no secret.

Status: draft, written 2026-11-23. The plan it follows was approved by the owner on 2026-11-23, and the time-of-day part was added the same day at the owner's request ("Before Implementing Fix this and Add it to the Prompt"). Where this prompt changes the plan's numbers, the decision says **Revised** and why: read those before saying "Implement". Decision 22 (the written fallback's affirmations) needs the owner's yes.

## The incident

The cause is the instruction, not the voice. `supabase/functions/process-entry/prompt.ts` (gen-v2.6, deployed on both projects since 2026-11-11) asks for a sermon, and nothing asks for everyday words.

| What the lead heard | Cause in gen-v2.6 | Where |
| --- | --- | --- |
| "So structured, so organized" | "You speak the way a beloved pastor preaches to a single listener … You declare his truth with quiet authority, and every sentence you write carries weight." | `prompt.ts:36` (Role) |
| Lines built to sound important | "write it the way a sermon sounds", "let the lines rise and land", "a few longer ones that build", "Move like a short sermon" | `prompt.ts:76-77` (Voice) |
| Fancy words ("gazing forward") | "draw on the riches of the faith … in fresh words of your own, never in the passage's words"; "never borrow the passage's key words or images"; the prayer must "name him by who he is for this need … never the passage's". Each ban pushes the model to a rarer synonym. | `prompt.ts:80`, `:107`, `:33` |
| Endings that sound like sayings | "Let the last line land as a sentence worth carrying into the day." | `prompt.ts:48` |
| Written, not spoken | The only length rule is "mostly under 20 words and never over 25". Contractions are asked for once and never checked. | `prompt.ts:97` |
| The test rewards it | The grader scores `sermon_flow`, `warm_authority`, `spiritual_depth` and "every sentence carries weight", as "an experienced pastor and editor". Nothing scores plain speech. | `eval/run_tone_eval.ts:409-424`, `:442` |

Measured on 2026-11-23, with no API call, on gen-v2.6's 36 saved test reflections (`tone-eval/out/gen-v2.6/gemini-3.8-flash/`, made-up entries, written 2026-11-10), using the exact rules of step 2 below:

| Measure | gen-v2.6 | The lead's example |
| --- | --- | --- |
| Reading grade of the devotional (Flesch-Kincaid, step 2's syllable rule) | median 6.30, max 8.83, 17 of 36 over 6.5 | 5.83 |
| Reading grade of the closing prayer | median 4.43, max 6.00 (already plain) | — |
| Contractions in the devotionals | **0 in all 36** | 1 in 47 words |
| "does not", "cannot" and the like in the devotionals | 69 | 0 |
| Words of the avoid list (step 2) in the line, devotional or prayer, each word once per case | 57, in 23 of 36 | 0 |
| "Plainer" words (faithful, completely, tender, whisper, entirely, mercy…) | 130 | 0 |
| Words per sentence, devotional and prayer | median 12.4 | 15.7 (sentences of 9, 12 and 26) |
| Sentences over 25 words | 2 of 557 | 1 |

So sentence length is not the problem: the lead's own example has longer sentences than gen-v2.6. The problem is the register: formal grammar with no contractions, literary words, and lines written to be admired. These figures replace the plan's (median 6.4, worst 9.0, 13.7 words a sentence), which came from a different syllable count.

What gen-v2.6 wrote for the made-up entries (verbatim, from the saved runs):

- "God knows the geography of every heart." (`names-blessing`)
- "He is not surprised by corporate restructuring, nor is he distant from the ledger of your family’s expenses." (`anxiety-work`)
- "Grief is simply the echo of genuine love." (`grief-pet`)
- "He does not simply accompany you; he prepares the path ahead of your arrival." (`hope-new-start`, with a semicolon the instruction forbids)
- "It is entirely natural to rejoice over someone you cherish while simultaneously grieving the rhythms you shared." (`names-blessing`)
- The hook "Fourteen years of loyalty leave an enormous silence behind by the front door." (`grief-pet`)
- The line "Unpacking boxes in an unfamiliar city brings both quiet excitement and real apprehension for your family." (`hope-new-start`)
- The prayer "Lord, the God who guides every step, …" and "Grant me clear eyes to notice your goodness on these new streets." (`hope-new-start`)

The register the lead asked for, in his words: "Going through life all by yourself can be challenging. Sometimes you sit down and you wonder why life pulls you backward. And sometimes you look at your friends going forward, seeing that they've gone many steps ahead of you, and it seems like you are moving backwards."

What this step does not claim: that a reading grade measures warmth or truth, or that the grader hears what a person hears. The grade, the word counts and the grader are guards. The two people listening (step 5) decide.

### The second report: the wrong part of the day

The owner, the same day: "in the morning, it's giving me suggestions of me going to bed to sleep … in the night, it should not be saying anything about me waking up." The owner named two ways out: drop morning, afternoon and night and write words that fit any time, or use the time the person's device reads and bring only morning words in the morning.

| Where | Cause | Evidence |
| --- | --- | --- |
| The devotional's next step | The instruction's own example is "one thing to set down before God tonight". The model is never told the person's time (the user turn holds no time), so it copies "tonight". | `prompt.ts:48`; 26 of 36 gen-v2.6 devotionals say "tonight" |
| The closing prayer | "rest tonight" is among the petition examples | `prompt.ts:33`; 16 of 36 prayers name a part of the day |
| The affirmations | Written per hour: "a short word from God for that hour of this person's day", and "evening helps them set down tonight what they carried" | `prompt.ts:114`, `:117`; 34 of 36 reflections have one in an affirmation text and 8 in a headline ("Safety surrounds your night", "His faithfulness arrives with daybreak") |
| Where the app shows them | The Word Deck deals the word that has waited longest, and the word's own slot only breaks a tie, so an evening word reaches the 8:00 AM reminder. The Today card keeps the last reminder's word for up to 26 hours, Reflection shows the three affirmations together, and a devotional is often replayed hours later. | `src/utils/wordDeck.ts:157-173` |

In all, 35 of the 36 gen-v2.6 test reflections name a part of the day somewhere: 64 "tonight", 30 "morning", 16 "sleep" and more, counted with the exact rules of step 2's time check (the 36th, `unclear-marks`, fails the plain check instead).

## Goal

Every reflection (Reflection screen, the spoken devotional and its lock-screen playback, the affirmations on the lock screen and the Today card) sounds like a caring Christian friend talking to the person: everyday words, short sentences, contractions, God's truth said simply. A nine-year-old could follow it, and an adult never feels talked down to. Nothing it says depends on the time of day, because it may be heard or shown at any hour. Everything that protects the person stays as it is: the order of care, Faith, the never-say list, privacy, scripture kept separate, the heavy-moment rules, and the written fallback except its three affirmations (Decision 22).

## Decisions

1. **The voice.** A caring Christian friend at the kitchen table, not a pastor preaching. This replaces the owner's sermon voice of 2026-10-31 (Pastoral Tone Rules, "The voice") on purpose. AGENTS.md replaces that rule rather than adding a second one beside it.
2. **The level.** A nine-year-old understands every sentence the first time they hear it. Plain, never childish: the listener is an adult who is tired or hurting, so no baby talk and no exclamation marks. (The "never childish" part is added to the plan, for the audience of women aged 25 to 45.)
3. **Sentences (Revised).** Most sentences under 15 words, now and then a longer simple one joined with "and", and never over 25 words (today's cap). The plan said "most under 12, none over 18" and an average of 11 or less. The lead's own example has sentences of 9, 12 and 26 words and averages 15.7: an 18-word cap would refuse half of it, and sentences that are all short and the same length are one of the AI tells on the humanizer's list. The evaluation holds a range of 8 to 13 words a sentence instead (gen-v2.6 12.4).
4. **Contractions (new finding).** gen-v2.6 wrote no contraction in 36 devotionals, although asked. gen-v2.7 asks again with examples, and the evaluation measures it.
5. **Everyday words.** The instruction gets a swap list ("look, not gaze; tired, not weary; keeps his promises, not faithfulness …"). Code gets `PLAIN_AVOID_WORDS`, 107 word forms (about 70 roots) taken from gen-v2.6's own output and the humanizer's list of AI words (**Revised**: the plan said "about 40 literary words"). The list holds no word of the faith (God, Lord, Jesus, grace, mercy, faith, faithful, hope, love, peace, prayer…), no word of the written fallback, and no safe title or headline.
6. **The hook stays (flagged).** The owner's requirement of 2026-10-31 stands: the first sentence speaks into one concrete thing the person told, within five seconds. gen-v2.7 adds "said to them, with "you" or "your" in it" and drops "one picture". The lead's example opens with a general sentence ("Going through life all by yourself can be challenging."), which the hook rule forbids because it could open anyone's devotional. gen-v2.7 takes the lead's example for its words and its sound, not for its opening. The owner can reverse this.
7. **The passage.** The devotional and the prayer still never quote, paraphrase, cite or point to the passage. gen-v2.6's extra ban on sharing its key words goes (it drove the synonyms): an everyday word such as "near", "help" or "rest" may be shared; its sentences and phrases may not.
8. **The prayer.** It keeps its five moves, the first person, the despair rule and two or three petitions, in plain words. Move 1 no longer names God "by who he is for this need" (it gave "Lord, the God who guides every step"): the person talks to God the way they did in the entry. "Grant me" leaves the opener examples (old church English); move 4 "tells" one true thing instead of "declaring" it.
9. **Scope of the voice and of the plain check.** The voice covers everything a person reads or hears: the validation line, the devotional, the prayer and the affirmation texts. The plain check scans only the validation line, the devotional and the prayer: affirmation texts take words from their verse ("steadfast love"), and checking them would retry most replies for the Bible's own vocabulary. The evaluation reports the affirmation texts' list words without a bar. (The time check's wider scope is Decision 21.)
10. **Unchanged, word for word:** Faith and "Never write these" (Scholar copies both, `_shared/scholar/prompt.ts` `reflectionSection`), `HEAVY_INSTRUCTION` (frozen in `heavy_test.ts` and shared with Scholar's hard-moment answers, which the readers approved), the written fallback except its three affirmations (Decision 22), Input, The person, Variety, `IS_CRISIS`, every builder function, the user turn and the schema.
11. **The check (Revised).** One soft check, `plain_speech`: a word of `PLAIN_AVOID_WORDS` in the validation line, the devotional or the prayer (a word the entry itself uses, and the quoted echo, set aside), or a devotional whose reading grade is over 7.0. It is asked for once more with a note, and a reply no better is kept as written, with `salvaged:plain_speech` in the log. The plan said "grade above 6 or a sentence over 18 words". A sentence cap would flag the lead's own example, and gen-v2.6 had 2 sentences over 25 in 557. Grade 7.0 sits above the lead's example (5.83) with room, and the evaluation holds the stricter 6.5. On gen-v2.6 this check would have asked again for 24 of 36 replies, about 5 seconds each, so the evaluation requires gen-v2.7 to need it or the time check (Decision 21) on at most 6 of 37 first replies before anything is deployed.
12. **No new log field (Revised).** The plan added `readingGrade` to the log line. The line's 43 fields are asserted in about ten places. `salvaged:plain_speech` and `salvaged:time_of_day` in `reason`, and the existing `attempts` count, say how often the checks work in production.
13. **No humanizer after the model** (as planned). It would add 2 to 5 seconds to every reflection and could change words that already passed the safety and scripture checks. The humanizer's tells are used as rules in the instruction, the check and the grader instead.
14. **The evaluation.** Two new rubric criteria (`sounds_human`, `plain_words`); the three sermon criteria are rewritten for plain speech (`warm_and_sure`, `faith_said_plainly`, `every_line_counts`); `hook`, `prayer_meets_need` and `scripture_separate` are reworded to match. It compares with gen-v2.6 frozen, on the same cases, on both production models (`gemini-3.8-flash` writes, `gemini-3.1-flash-lite` writes every second attempt). One case joins: `left-behind`, the lead's own situation.
15. **The listening review (as planned).** Ten spoken samples. The owner and the lead each answer "Does this sound like a real person talking to me?", and whether anything about the time of day didn't fit when they listened. It ships when each says yes to the first question for at least 9 of 10, and no sample gets a time-of-day "yes".
16. **Cost.** About $2.50 of Gemini for two rounds on `gemini-3.8-flash`, one on `gemini-3.1-flash-lite` and the checks. Stop and ask the owner before the total passes $3 (a third round on `gemini-3.8-flash` would). The samples' speech (about 13,000 characters) is inside Cloud Text-to-Speech's free million a month.
17. **Delivery.** Server only. The owner deploys `process-entry` on development, checks it on the phone, then deploys it on production. Build 11's testers hear it at once. Rollback is one redeploy of gen-v2.6 (step 6).
18. **Versions.** `PROMPT_VERSION` becomes `gen-v2.7`. More than one section changes, so gen-v2.6 is frozen whole in `eval/prompt_v2_6.ts` (Versions rule), as step 36 froze gen-v2.2.

The time of day (the second report):

19. **Any hour (the owner's first way, recommended).** Nothing the model writes names a part of the day or guesses when it will be heard or read: no "tonight", "this morning", "before you sleep", "when you wake" or "as you start your day". "Today" and "right now" stay, because they are true whenever they are heard. A time the person told stays too ("you couldn't sleep last night"), because it is their fact. The second way, the device's time, is not chosen, for four reasons: a devotional is often heard hours after it was written; the Today card shows the last reminder's word until the next one fires (8 PM's word at 7 AM); the Reflection screen shows the three affirmations together; and it needs a new app build. Words written for any hour are right in every country and at every hour, with a server change only. The time of day stays only where the app reads the phone's clock as it shows something: the Today greeting ("Good morning") and the reminder times the person chose.
20. **The slots stay, as delivery times only.** The schema's `time_slot`, the database's one-per-slot rule, the reminders at the person's times and the Word Deck are unchanged. The model still fills `time_slot`, which now only says where a word is sent first. The three affirmations take three different sides of what the person shared (what they face, the worry they named, what they are carrying) instead of three hours.
21. **A second soft check, `time_of_day`.** It fires on a word of step 2's time list in the validation line, the devotional, the prayer, a headline or an affirmation text, with the person's own words and the echo set aside. It works like `plain_speech`: one retry, then a reply no better is kept as written, with `salvaged:time_of_day` in the log. Its scope is wider than the plain check's because the headlines are what the lock screen and the Today card show at other hours. On gen-v2.6 it would fire on 35 of 36 replies. The evaluation requires gen-v2.7 to need either check on at most 6 of 37 first replies.
22. **The written fallback's affirmations (needs the owner's yes).** The fallback must pass every check (`heavy_test.ts`). At present its evening headline "You are held tonight" and text "Let tonight be gentle …" also reach the morning reminder, and its morning and afternoon texts begin "Before this day asks anything of you" and "In the middle of this day". Its affirmations become, headline then text:
    - morning: "You are not alone today" (unchanged); "God is already here with you. Take one small step, and let someone take it with you."
    - afternoon: "God is with you here" (unchanged); "Right where you are, you are held. Reach out to someone you trust, even with just a few words."
    - evening: "You are held, even now"; "You’ve made it this far. Be gentle with yourself, and know that his love for you doesn’t change."

    Everything else in the fallback stays word for word: the title, the line, the devotional, the prayer and the passage. Without this yes, the time check cannot cover the affirmations (the fallback would fail it), and after a heavy moment's fallback the lock screen keeps showing "tonight" in the morning.
23. **Words saved before gen-v2.7** keep their part of the day, and the Word Deck deals them until they leave its pool (about a week for someone who writes most days). Only TestFlight testers have such words, because the app is not public yet, so no app change is made for them.

Ask-first items: no dependency, no migration, no RLS or storage change, no auth change, no RevenueCat change. One Edge Function deploy (`process-entry`), done by the owner. The written fallback's words (Decision 22) are the owner's to approve.

## Out of scope

- The crisis screening (`_shared/safety/`), the heavy section, the written fallback beyond its affirmations, and `DENIED_PASSAGES`. A change there needs the readers again.
- The app: the Word Deck's dealing, the Today card and the notifications stay as they are (Decisions 20 and 23). Showing only morning words in the morning would need a new build and would still be wrong on replay (Decision 19).
- Scholar (scholar-v3, its spoken block, its hard-moment section) and add-affirmation (add-v1 keeps its own instruction, copied from gen-v2.5; its texts are shown in the app and never read aloud, and it already writes "tied to no hour"). A plain-words add-v2 is a possible follow-up.
- The fixed spoken lines ("A reading from …", "Let's pray.", "Amen."), the passage's own text (the Berean Standard Bible, never changed), the voice (Aoede at 0.88).
- The schema's fields, the log line's fields, migrations, secrets.
- Tuning from live production logs, beyond counting the two new `salvaged:` reasons.
- A TestFlight build: none is needed, and none is started without the owner's own instruction.

## Steps

### 0. Baseline, freeze, red

1. `git status` and `git log -1`. HEAD is `ae541cd`, and `prompt.ts` there is gen-v2.6. The working tree has unrelated changes (the AGENTS.md split into `docs/`, images, `NUL`): leave all of them alone.
2. Run the Edge Function gates of AGENTS.md (Linting and Validation: every `deno check`, `deno lint`, `deno fmt --check`, the main `deno test` run, export-data's own run, `node supabase/tests/process-entry/parity.cjs`). Record the counts. No file in `src` changes, so the app's gates are not run: say so in the report.
3. **Freeze gen-v2.6 before any edit.** Generate `supabase/functions/process-entry/eval/prompt_v2_6.ts` with a script (in the scratchpad, not the repo) that imports today's `prompt.ts` and `schema.ts`, never by hand. The file:
   - opens with a FROZEN header like `prompt_v2_2.ts`'s (a verbatim copy of gen-v2.6's instruction, schema and user turn as deployed from 2026-11-11 to the gen-v2.7 deploy; never edit it; nothing deployed imports it);
   - imports nothing; holds the instruction as one string literal (JSON-escaped is fine), the schema as an object literal, and copies of `buildUserTurn`'s helpers with `STOPWORDS` copied in (`STOPWORDS_V2_6`), so a later change to `tone.ts` cannot move it;
   - exports `PROMPT_VERSION_V2_6` (`"gen-v2.6"`), `CLOSING_PRAYER_RULE_V2_6`, `buildSystemInstructionV2_6()`, `buildSchemaV2_6()`, `type RecentReflectionV2_6` and `buildUserTurnV2_6(entryText, recent, heavy = false, recentVerses = [])`.

   Prove it byte for byte against today's builders: the instruction string `===`, `JSON.stringify` of the schemas `===`, and the user turn `===` for six inputs (no recent; recent with all four lines; heavy; heavy with recent; recent verses only; an entry holding every trusted tag). Then write `eval/prompt_v2_6_test.ts`, which holds the SHA-256 (hex) of the instruction, of `JSON.stringify(buildSchemaV2_6())`, and of the six user turns joined with `"\n---\n"`, computed at this moment.
4. Write the new tests of steps 1 to 3 first. Run them and see each fail for the reason it names (record how many fail).

### 1. The instruction (`process-entry/prompt.ts`)

Keep every section name: "Role", "Input", "How to care", "Faith", "Never write these, or anything that means the same", "The person", "Voice", "The first line", "Written to be read aloud", "Scripture", "What to write", "Variety" and "A heavy moment". Add one section, "Any hour of the day", right after "Written to be read aloud". `heavy.ts` names "The person" and "The first line", `tone.ts`'s notes name "The first line", "What to write" and "A heavy moment", and Scholar's `reflectionSection` splits the instruction on `\n\n(?=## )`. Keep the house style: straight quotes and apostrophes in the instruction's own prose, curly apostrophes inside quoted spoken examples (as "It’s okay" and "Your son’s surgery" are today).

1. History comment: add `"gen-v2.7" on 2026-11-23: plain speech, the way a caring friend talks, in words a nine-year-old understands, where gen-v2.1 to gen-v2.6 asked for a sermon ("so structured … a human being does not talk like that", the project lead on build 11)`.
2. `PROMPT_VERSION = "gen-v2.7"`.
3. `## Role` becomes:

   > You write for one person through a private Christian prayer journal, the way a caring Christian friend talks to them across the kitchen table: simple, everyday words, warm and honest, and sure that God loves them. You are not a pastor giving a sermon, and not a writer making beautiful sentences. You are not a therapist, doctor or counselor.

4. `## How to care` becomes:

   > 1. Open inside their moment (see "The first line"). Then say what the person seems to feel, in plain words, and tell them it's real.
   > 2. Stay with that feeling for a few sentences before any hope. Do not turn with "but" right after naming it.
   > 3. Then tell them one true thing about who God is to them (that he is with them, that he cares, that he keeps his promises, that Jesus knows what hurting feels like), simply and surely, the way you would say it out loud. A truth, not a fix.
   > 4. End with one small, gentle next step that grows out of what they told you, such as a sentence to pray or one thing to hand over to God. Never a breathing or body exercise, and never a list of tasks. Let the last line be short and warm, never a slogan.
   > When the entry is mostly joy or gratitude, be glad with the person first, then thank God with them.

5. `## Voice` becomes:

   > The devotional and the closing prayer are read aloud to the person, and they read the line at the top of their screen and the affirmations. Write all of it the way a caring friend talks, never the way a book, a sermon or a greeting card reads. A nine-year-old should understand every sentence the first time they hear it. But you are talking to an adult who is tired or hurting: plain, never childish, never talking down, and no exclamation marks.
   > - Everyday words, the ones people say out loud. Look, not gaze. Stay, not linger, dwell or abide. Tired, not weary. Sad, not sorrowful. Hold, not cradle, embrace or enfold. Kind, not tender or compassionate. Always there, not steadfast, unwavering or unfailing. Keeps his promises, not faithfulness. Keeps you going, not sustains you. A safe place, not a refuge, a haven or a sanctuary. These days, not this season or this journey. Really, not truly or utterly. Never a big word, a church word or a business word when an everyday one says it.
   > - Short sentences with one idea each. Most are under 15 words. Now and then a longer one is fine when it is simple and joined with "and", the way people talk. Never over 25 words.
   > - Talk, don't write: use a contraction every time a person would say one, such as “don’t”, “doesn’t”, “isn’t”, “can’t”, “it’s”, “you’re”, “he’s” and “he’ll”. Write “God hasn’t left you”, never “God has not left you”.
   > - Say things straight. No word pictures that need explaining, such as "the map of your heart", "this new chapter" or "the storms of life". A picture is fine only when it comes from what they told you.
   > - No writing tricks: no "not this, but that" (“he doesn’t just stay; he leads”), no lists of three, no line built to sound wise or important, and no sentence that sounds like a saying (“tired is just love that worked too hard”).
   > - People and God do the things in your sentences, never ideas or feelings: “you keep checking the clock”, never “the worry fills the whole day”.
   > - Say what is true of God plainly and surely, without hedging words such as "maybe", "perhaps", "I think" or "hopefully". It belongs to who God is: never to commands to the person, and never to promises about outcomes.
   > - Talk to them and about God, never about yourself: no "I'm sorry" or "I know" in your own voice.
   > - Every sentence says something real to this person: no warm-up line, no generic sentence that could sit in any devotional, no repeating a point, and no summary at the end.

   The examples above come from no evaluation case (a test holds that): never add one taken from `eval/cases.json`. Neither the lead's example nor the plain sample of step 2 goes into the instruction: a whole example paragraph is a template the model copies (step 36, decision 6).

6. `## The first line`: keep the opening paragraph and every bullet, with these changes.
   - After the first bullet ("Build it from one concrete thing they told you …"), add:

     > - Say it to them, the way a friend would start talking to them, with "you" or "your" in it. Not a written scene (“The kitchen sits quiet while the kettle cools”), and never an idea or a feeling doing what a person does (“Ten years of hard work leave an empty desk”).

   - In "Keep it short and plain: …", replace "one picture" with "about one thing". Replace "Vary its shape: begin with the moment itself, something they did, the time it happened, or a word spoken straight to them." with "Vary its shape and its first word: begin with the moment itself, something they did, the time it happened, or “you”."
7. `## Written to be read aloud`: replace its first bullet with "- Use short, plain sentences as "Voice" asks: most under 15 words and never over 25, with a contraction every time a person would say one." Keep the other four bullets unchanged. Then add the new section right after it:

   > ## Any hour of the day
   > The person may hear the devotional hours after they wrote, and the app shows each affirmation at a different reminder time and on their Today screen at any hour. So nothing you write may depend on the time of day.
   > - Never name a part of the day or guess when they will hear or read this: no "this morning", "this afternoon", "this evening", "tonight", "before you sleep", "when you wake", "as you start your day" or "at the end of the day". Say "today" or "right now", or say nothing about time.
   > - Name a time only when it is part of what they told you: if they wrote that they couldn't sleep last night, you may say so.
   > - The next step, the prayer's petitions and every affirmation fit any hour: something they can do or pray whenever they hear it.

8. `## Scripture`: keep the first three bullets. Replace the fourth ("They also never borrow the passage's key words or images …") with:

   > - Say what is true about God in your own simple words. Sharing an everyday word with the passage, such as "near", "help" or "rest", is fine; repeating its sentences or its phrases is not.

9. `## What to write`:
   - `validation_line`: keep the bullet and add at its end: "Say it the way a friend would say it to them, in the plain words of "Voice"."
   - `affirmations`, the lead line, becomes:

     > - affirmations: three, one for each time_slot (morning, afternoon and evening): a short word from God for this person, carried by a verse of its own. Each one is a notification on their lock screen, the headline in bold and the verse with its reference under it, and the app shows them in turns at the person's reminder times and on their Today screen at any hour. So the time_slot only says where it is sent first: each affirmation fits any hour of the day (see "Any hour of the day"). Write each in this order.

   - `verse`: replace "not for the hour: never a verse about the morning only because it is the morning, or about sleep only because it is the evening." with "not for the hour: never a verse about the morning, the night or sleep unless what they shared is about it, because the app may show it at any hour." The rest of the bullet is unchanged.
   - `headline`: replace "the truth that verse holds for this person at that hour" with "the truth that verse holds for this person", and after "and never the verse's own phrases." add "It never names a part of the day." The rest of the bullet is unchanged.
   - `text` becomes:

     > - text: 12 to 30 words in the second person, in the plain words of "Voice": what its verse means for them, resting on what God does rather than on self-belief, and tied to what this person shared, each of the three from a different side: one about what they face, one about the worry they named, one about what they are carrying. None names a part of the day: each fits any hour. No name, no place. It is shown only inside the app.

   - Everything else in the section stays.
10. `CLOSING_PRAYER_RULE` becomes (the parts tests pin today are kept word for word where they still hold):

    > the person's own prayer, which they will hear read in a steady voice and can pray along with. Write it in the first person singular ("I", "my", "me"), never "we", "us" or "our" unless the person themselves prayed as "we" in the entry. When they pray for someone else, still pray as "I": "help me be patient with her", never "help us". Write it the way a person really prays when they're tired or worried: in the plain words of "Voice", with short sentences. It moves in five steps, in this order. (1) Talk to God the way the person talked to him in the entry ("Father", "Lord", "Jesus", "God"), or "Lord" if they did not, simply, as you would talk to someone right there with you. (2) Hand him the pain once, in their own plain words and with no quotation marks: what happened and what they feel, honestly, without dressing it up. (3) Ask him for two or three concrete things that meet the need beneath their words, each in a short sentence of its own that opens with the asking ("Help me", "Give me", "Show me", "Please"; never three asks strung through one sentence): strength for today, a clear head for the choice ahead, real rest, courage to make the call, the will to try again, enough for the rent. Every petition stays "me" and "my", also when it is for another person or for a shared home: "give me the right words for my wife", "help me find what my home needs", "soften my sister's heart toward me", never "us", "our" or "between us" unless the person themselves wrote "we" or "our". Pray for the need, never for a despairing wish itself: when the person says they want to drop out, give up, quit, walk away or disappear, do not ask God to let them, and do not argue with them; ask instead for rest and clear sight before any decision, and for his wisdom in it. Tie one petition to the next step the devotional offered, so the prayer prays what the devotional asked. (4) Tell him one true thing about who he is to them now, in simple words of your own, with no promised outcome: that he is with them in this, that he's already at work, that his care doesn't depend on how today went, never that the exam, the job, the test or the person will turn out well. (5) End with one line of trust in who God is, never with a promised outcome. 5 to 7 sentences, 50 to 75 words and never more. Do not write "Amen".

11. The schema does not change: its descriptions already state the lengths. The user turn does not change.

**Tests (`prompt_test.ts`), red first:**

- The version is `gen-v2.7`, and the heavy moment of gen-v2.4 is still written in full (update the existing test).
- Replace "the narrated voice and the first line are still asked for": the instruction holds "## Voice", "## The first line", "the way a caring Christian friend talks", "A nine-year-old should understand every sentence", "plain, never childish", "Most are under 15 words", "Never over 25 words.", "use a contraction every time a person would say one", "No writing tricks", "never to commands to the person, and never to promises about outcomes" and "Stay with that feeling for a few sentences before any hope.". It no longer holds "sermon", "preach", "rise and land", "riches of the faith", "quiet authority", "carries weight", "worth carrying into the day", "borrow the passage's key words", "name him by who he is", "Grant me", "one picture" or "mostly under 20 words". The stock-openings rule line still lists every `STOCK_OPENINGS` item in quotes, and the safety lines that test already lists are still there.
- The first-line test keeps its pins and adds "with "you" or "your" in it".
- Replace the gen-v2.6 prayer test with a gen-v2.7 one: the rule is still the exported constant; it holds "It moves in five steps, in this order.", "(1) Talk to God the way the person talked to him in the entry", "Hand him the pain once, in their own plain words and with no quotation marks", the petition sentence of move (3) up to "opens with the asking", "Every petition stays "me" and "my", also when it is for another person or for a shared home", "Pray for the need, never for a despairing wish itself", "do not ask God to let them, and do not argue with them", "Tie one petition to the next step the devotional offered", "(4) Tell him one true thing about who he is to them now", "never that the exam, the job, the test or the person will turn out well", "(5) End with one line of trust in who God is, never with a promised outcome." and "5 to 7 sentences, 50 to 75 words and never more."; and it no longer holds "the God who provides", "never the passage's", "Grant me" or "Declare one lifting truth".
- The gen-v2.3 "What to write" test keeps its pins except the three per-hour ones ("tied to this person's day: morning names, in general words, the first thing they face today", "afternoon steadies them in the worry they named", "evening helps them set down tonight what they carried"), which become "each of the three from a different side", "None names a part of the day: each fits any hour." and "So the time_slot only says where it is sent first". The gen-v2.5 affirmation test keeps "not for the hour" and drops "for that hour" if it pins it.
- New, the time of day: the instruction has a section "## Any hour of the day" right after "## Written to be read aloud", holding "nothing you write may depend on the time of day", "Name a time only when it is part of what they told you" and the forbidden phrases as listed in step 1.7. "How to care", `CLOSING_PRAYER_RULE` and the `affirmations` lead and `text` bullets hold none of "tonight", "this morning", "this evening", "sleep" or "for that hour".
- New: no example of four words or more quoted in "Voice" or "The first line" (the text between “ and ”) appears in any text of `eval/cases.json`, compared without case and with straight apostrophes. (Single words such as “don’t” are left out: the cases use them.)
- New, the guard of Decision 10: the sections "Input", "Faith", "Never write these, or anything that means the same", "The person", "Variety" and "A heavy moment" are byte for byte the same as in `buildSystemInstructionV2_6()` (split both on `\n\n(?=## )`). No existing test catches an edit to Faith or the never-say list: Scholar's `prompt_test.ts` compares its copy with the live reflection text, so both sides move together, and Scholar's heavy writer (which the readers approved) would change silently.
- `_shared/scholar/prompt_test.ts` passes unchanged.
- `heavy_test.ts` passes unchanged. Change only the comment at line 136 to "gen-v2.4 to gen-v2.7".
- `handler_test.ts` lines 1240 and 2347: `promptVersion` becomes `gen-v2.7`.

### 2. The checks and the measures (`process-entry/tone.ts`, `process-entry/output.ts`, `process-entry/heavy.ts`)

Add to `tone.ts`, in a new section "Plain speech (gen-v2.7)". The rules are exact: the evaluation's bars and the incident's numbers depend on them, so do not "improve" them.

```ts
// Syllables, by a rule of thumb that is consistent rather than exact ("create" counts 1, "everything" 4).
export function syllables(raw: string): number {
  const word = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/'s$/, "").replace(/[^a-z]/g, "");
  if (word === "") return 0;
  if (word.length <= 3) return 1;
  const trimmed = word.replace(/(?:[^laeiouy]es|[^laeiouydt]ed|[^laeiouy]e)$/, (end) => end[0]).replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]+/g) ?? []).length);
}
// A word for the grade: a whitespace token with a letter or a digit in it.
const gradeWords = (text: string) => text.trim().split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
// The Flesch-Kincaid grade, with `sentences` (the split this file already uses). 0 for an empty text.
export function readingGrade(text: string): number {
  const words = gradeWords(text);
  const count = sentences(text).length;
  if (words.length === 0 || count === 0) return 0;
  const syllableCount = words.reduce((sum, word) => sum + syllables(word), 0);
  return 0.39 * (words.length / count) + 11.8 * (syllableCount / words.length) - 15.59;
}
export const PLAIN_RETRY_GRADE = 7; // a devotional over this is asked for again
```

Fixtures the tests pin (`readingGrade`, rounded to 2 decimals): the lead's example (quoted in "The incident") 5.83; the plain sample below 2.54; the written fallback's devotional 2.96; and gen-v2.6's `grief-pet` opening, "Fourteen years of loyalty leave an enormous silence behind by the front door.\n\nYou keep expecting to hear familiar steps, and every quiet corner reminds you of what is missing. It never feels foolish to mourn something that gave you uncomplicated devotion for over a decade. Grief is simply the echo of genuine love.", 8.03. `syllables`: God 1, people 2, beautiful 3, faithfulness 3, everything 4, doesn’t 1, wanted 2, needed 2, lived 1, hoped 1, themselves 2, steadfast 2.

The plain sample (the register, never a template, never in the instruction): "You keep looking at your friends, and it feels like they're all moving ahead of you. Some days you sit down and wonder why your life feels stuck. That hurts, and it's okay to say so. God knows exactly where you are today. He hasn't left you behind, and he isn't comparing you to anyone. Tell him one thing you're scared about. He's listening." (It fits any hour: an earlier draft began its next step with "Tonight".)

The words, as two exported `ReadonlySet<string>` constants, lowercase:

- `PLAIN_AVOID_WORDS` (checked): abide, abides, abiding, amid, amidst, anchor, anchored, anchors, anguish, apprehension, beacon, behold, beloved, boundless, bountiful, bountifully, ceaseless, cherish, cherished, cherishes, countenance, cradle, cradled, cradles, cradling, dwell, dwelling, dwells, embark, enfold, enfolded, enfolds, envelop, enveloped, enveloping, envelops, everlasting, fortitude, fragment, fragments, furthermore, gaze, gazed, gazes, gazing, haven, hence, immeasurable, indeed, inhabit, inhabiting, inhabits, inherently, intercession, journey, journeys, linger, lingered, lingering, lingers, moreover, navigate, navigates, navigating, nevertheless, nonetheless, profound, profoundly, providence, realm, respite, sanctuary, serenity, simultaneously, solace, solitude, sovereign, sovereignty, steadfast, steadfastly, steadfastness, sustain, sustained, sustaining, sustains, tapestry, tenderly, tenderness, testament, thus, tranquil, tranquility, tumult, turmoil, unending, unfailing, unseen, unshakable, unshakeable, unwavering, utterly, vigor, weariness, whilst, yearn, yearning, yearns. (107)
- `PLAINER_WORDS` (measured only, never refused): burden, burdens, compassion, compassionate, compassions, completely, deeply, devotion, embrace, embraces, entirely, faithful, faithfulness, mercy, merciful, precious, renew, renews, restore, restores, sorrow, sorrowful, sorrows, surrender, tender, truly, weary, whisper, whispers. (29)

A word joins `PLAIN_AVOID_WORDS` only when a friend never needs it, it is not a word of the faith, and no fixed text holds it. A test holds that: the two sets share no word; neither holds a word of `FAITH_WORDS` (a test constant: god, lord, jesus, christ, holy, spirit, grace, mercy, faith, pray, prayer, prayed, hope, love, peace, heaven, forgive, forgiven, church, bible, amen, savior, father, gospel, cross); and `PLAIN_AVOID_WORDS` holds no word of `heavyFallback()`'s texts, `SAFE_TITLE`, `SAFE_HEADLINES` or the validation-line example of "What to write". (`faithful` and `mercy` are only measured: the fallback's prayer says "because you are faithful".)

The tokens and the scan:

```ts
const plainTokens = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)*/g) ?? [];
const QUOTED = /“[^”]*”|"[^"]*"/g; // the echo, the one quotation the spoken texts may hold
// The distinct words of the list in these texts, in the order first seen: the quoted echo and any word the entry itself uses
// are set aside (the person's own words are theirs to hear back).
export function avoidedWords(texts: readonly string[], entry: string): string[];
```

The check, a `SoftProblem` like the others:

```ts
export function plainSpeechProblem(
  reflection: { validationLine?: string | null; devotional: string; closingPrayer: string },
  entry: string,
): SoftProblem | null
```

It fires when `avoidedWords([line, devotional, prayer], entry)` is not empty, or `readingGrade(devotional) > PLAIN_RETRY_GRADE`. Its reason and salvage are `plain_speech`. Its note, exactly (`words` are the list's own words, at most eight, never the person's):

```ts
`Your last reply did not sound like a caring friend talking.${
  words.length ? ` It used words people don’t say out loud: ${words.slice(0, 8).map((word) => `“${word}”`).join(", ")}.` : ""
}${hard ? " Its devotional reads at a harder level than asked." : ""} Write the whole reply again in the plain words of "Voice": everyday words a nine-year-old knows, short sentences with one idea each, and a contraction every time a person would say one.`
```

The second check, for the time of day (Decisions 19 to 21):

```ts
// Parts of the day, sleep and waking: a word the person did not write means the text guessed when it would be heard.
export const TIME_WORDS: ReadonlySet<string> = new Set([
  "morning", "mornings", "afternoon", "afternoons", "evening", "evenings", "tonight", "night", "nights", "nighttime",
  "overnight", "midnight", "bedtime", "bed", "sleep", "sleeps", "sleeping", "slept", "asleep", "awake", "wake", "wakes",
  "waking", "woke", "sunrise", "sunset", "dawn", "daybreak", "daylight", "nightfall", "dusk",
]);
const TIME_PHRASES =
  /\b(?:start|starting|begin|beginning)\s+(?:your|the|this)\s+day\b|\b(?:end|close)\s+of\s+(?:your|the|this)\s+day\b|\blay\s+your\s+head\b/gi;
// The distinct time words and phrases in these texts, in the order first seen. The quoted echo is set aside; a word is set
// aside when the entry uses it (tokens as `plainTokens`, each without a trailing "'s", so "tonight’s" counts as "tonight");
// a phrase is set aside when the entry holds the same phrase.
export function timeWords(texts: readonly string[], entry: string): string[];
export function timeOfDayProblem(
  reflection: {
    validationLine?: string | null;
    devotional: string;
    closingPrayer: string;
    affirmations: readonly { headline: string; text: string }[];
  },
  entry: string,
): SoftProblem | null
```

It fires when `timeWords([line, devotional, prayer, ...headlines, ...texts], entry)` is not empty. Its reason and salvage are `time_of_day`. Its note, exactly (each found word is the list's own or a phrase the model wrote, never the person's):

```ts
`Your last reply named a part of the day (${found.slice(0, 8).map((word) => `“${word}”`).join(", ")}), but the person may hear or read it at any hour. Write the whole reply again so that nothing in it depends on the time of day, as "Any hour of the day" asks: say "today" or "right now", or say nothing about time.`
```

The written fallback, after the owner's yes to Decision 22: in `heavy.ts`, `heavyFallback()` changes only its three affirmation texts and its evening headline, to Decision 22's words, with typographic apostrophes. Its comment adds that the affirmations fit any hour since gen-v2.7, with the owner's approval. `heavy_test.ts`'s targets still hold: the texts have 17, 19 and 18 words (12 to 30 asked), and every headline is under 38 characters.

Wire it:

- `SalvageReason` gains `"plain_speech"` and `"time_of_day"`. Neither salvage replaces anything: the reply is kept as written (`salvageOf` already does that for a fault that is not a private word or the line).
- `checkTone` runs the plain check, then the time check, after `personalProblems` and before the hook guard. Every soft note is joined into one retry as today, and the first fault names the salvage.
- `ParseContext` gains `gen27Checks?: boolean` (default `true`), passed to `checkTone` as a last argument `{ gen27Checks = true } = {}`. `false` turns both checks off. Only the evaluation passes `false`, for gen-v2.6 and older versions. Production never does.
- The written fallback passes both, after Decision 22 (`heavy_test.ts` already runs every check on it, whatever the entry).

`StyleMeasures` gains, never a reason to refuse:

| Field | What | On |
| --- | --- | --- |
| `readingGrade` | `readingGrade(devotional)` | devotional |
| `prayerGrade` | `readingGrade(closingPrayer)` | prayer |
| `wordsPerSentence` | `gradeWords` ÷ `sentences` | devotional + "\n\n" + prayer |
| `avoidWords` | `avoidedWords([line, devotional, prayer], entry).length` | as the check |
| `avoidWordsElsewhere` | the same scan of the title, headlines and affirmation texts | reported only |
| `plainerWords` | tokens in `PLAINER_WORDS` (every occurrence), quotes removed | devotional + prayer |
| `contractions` | matches of `CONTRACTION`, quotes removed | devotional |
| `uncontracted` | matches of `UNCONTRACTED`, quotes removed | devotional |
| `contrastFrames` | matches of `CONTRAST` | devotional + prayer |
| `timeWords` | `timeWords([line, devotional, prayer, ...headlines, ...texts], entry).length` | as the time check |

```ts
const CONTRACTION =
  /(?<![\p{L}\p{N}])(?:\p{L}+n['’]t|(?:i|you|we|they|who)['’](?:re|ve|ll|d)|i['’]m|(?:it|he|she|that|there|what|who|here)['’](?:s|ll|d)|let['’]s)(?![\p{L}\p{N}])/giu;
const UNCONTRACTED = /\b(?:do|does|did|is|are|was|were|have|has|had|will|would|could|should)\s+not\b|\bcannot\b/gi;
const CONTRAST =
  /\bnot\s+(?:just|only|simply|merely)\b|\bnot\b[^.!?;]{0,80},\s*but\b|\bnot\b[^.!?;]{0,80};\s*(?:he|she|it|you|god)\b|\brather than\b/gi;
```

**Cross-check before going on.** Run the new measures once on the saved gen-v2.6 reflections (a scratch script that imports `tone.ts`, made-up entries only). It must give the incident's numbers to the digit: devotional grade median 6.30 and max 8.83 (17 over 6.5); prayer max 6.00; 0 contractions and 69 uncontracted; `avoidWords` 57 in 23 cases; `plainerWords` 130; 4 contrast frames; 2 sentences over 25; and the plain check firing on 24 of 36. The time check fires on 35 of 36 (the line on 1, the devotional on 28, the prayer on 16, the headlines on 8, the texts on 34; 99 distinct words in all), and the two checks together on 36 of 36. A difference means the rules were not copied exactly: fix the code, not the numbers.

**Tests (`tone_test.ts`, `output_test.ts` or a new `plain_test.ts`, `handler_test.ts`), red first:**

- The syllable and grade fixtures above.
- `avoidedWords`: finds "steadfast" in the devotional; ignores it inside an echo in curly or straight quotes; ignores it when the entry says "steadfast"; matches whole words only ("gazebo" and "sustainable" are not hits); keeps the first-seen order and each word once.
- `plainSpeechProblem`: null for a devotional made of the lead's example and for the plain sample; fires on one list word; fires on a devotional graded over 7 (the `grief-pet` paragraph above, 8.03) with no list word; its note names the list words found, at most eight, and holds no word of the entry (use an entry with a name and a place).
- `timeWords`: finds "tonight" in a devotional and "tonight’s" as "tonight"; finds "start your day"; ignores a word inside an echo; ignores "night" when the entry says "night shift" and "sleep" when the entry says it couldn't sleep; ignores "today" and "now"; matches whole words only ("knight", "bedrock" and "awaken" are not hits).
- `timeOfDayProblem`: fires on "Tonight, tell God …" in a devotional, on the headline "Safety surrounds your night" and on an affirmation text with "this morning"; null on Decision 22's fallback; its note names the words found and holds no word of the entry.
- `checkTone`: a reply whose only fault is plain speech fails with reason `plain_speech` and a salvage equal to the reply with `salvaged: "plain_speech"`, and likewise `time_of_day`; a reply with both faults is `plain_speech` first, with both notes; with a private word in the title too, the reason is `title_private` and the note holds every note; with `gen27Checks: false` neither check runs; the written fallback passes for every entry `heavy_test.ts` uses.
- The two lists: the rules of the paragraph above.
- `styleMeasures`: each new field on a small fixture (an echo with a list word in it is not counted; "God’s" is not a contraction; "doesn’t", "it’s", "you’re", "I’m" and "let’s" are).
- **Fixtures that would trip the new checks.** The fake model reply most `process-entry` tests parse holds two time words: `testing/fakes.ts` `readyOutput()`'s prayer ends "… on my heart tonight." and its morning text is "Begin the day knowing you are held." (a `TIME_PHRASES` match). Eight of the nine `AFFIRMATION_SETS` name a part of the day in a headline. Left as they are, every test that makes a reflection would retry and change meaning. Make them fit any hour, and change nothing else in them:
  - the prayer becomes "… settle on my heart. Amen." (and `output_test.ts:47` then expects it to end "my heart.");
  - the text becomes "Know today that you are held." in `readyOutput()` and `affirmationSet()`;
  - the sets become: 1 "New mercy meets you", "Your steps are kept today", "Quiet trust carries you"; 2 "Mercy walks beside you today", "Your needs are known to him", "Steady love keeps you"; 3 "Strength waits for you", "His hand steadies your day", "Your rest is his gift"; 4 "Grace greets you", "His peace guards your hours", "Faithful love holds you"; 5 "Light finds you early", "God goes ahead of you", "Calm settles over you"; 6 "Hope rises with the day", "Kindness surrounds your work", "Shelter is near you"; 7 "Each day is his gift", "Courage meets you", "Nothing is a stranger to him"; 8 "Today brings his care", "Your path is lit today", "He keeps watch over you". Set 0 is unchanged.

  Then run the whole suite. Fix each other failure that a fixture's time word or list word causes in the same way, in its own test file, where the test is not about that word: `output_test.ts`, `handler_test.ts`, `gemini_test.ts` and `tone_test.ts` hold more ("tonight" in a prayer or a text, "Begin the day" in a text; `tone_test.ts`'s shared `reflection()` names "tonight" three times). Never weaken a check to make a fixture pass. Tests of a hard check that hold "tonight" ("You will not die tonight." → `dying`, "Put the pills away tonight." → `method`) stay as they are: hard checks run first, so those replies fail for the hard reason before any soft check runs. Record in the report how many fixtures changed, and where.
- `handler_test.ts`, the pattern of the "we prayer twice" test at line 2416: a reply with "steadfast" twice → the reflection is kept as the second reply wrote it, and the log line says `status` 200, `reason` `salvaged:plain_speech`, `attempts` 2; a reply with "Tonight," in its devotional twice → `salvaged:time_of_day`; and a reply with "steadfast" and then a clean one → `reason` null, `attempts` 2.

### 3. The evaluation (`process-entry/eval/`)

1. **Versions.** Add `"v26"` to `Version`. It is written with `buildSystemInstructionV2_6()`, `buildUserTurnV2_6()` and `buildSchemaV2_6()`, and read by `parseReflection` with `gen27Checks: false` (gen-v2.6's own rules). `compareWith` writes a case gen-v2.6 never wrote for a model (as it does for gen-v2.2). Remove the `v25` rebuild (`CLOSING_PRAYER_RULE_V2_5`, `buildSystemInstructionV2_5`, `buildSchemaV2_5`): it swapped one bullet in today's instruction, which is no longer gen-v2.6. `--compare gen-v2.5` still grades gen-v2.5's saved reflections and writes none. Update the header comment.
2. **The rubric** (`RUBRIC`, order kept, 17 criteria). Replace `sermon_flow` with `sounds_human` and add `plain_words` right after it; replace `warm_authority` with `warm_and_sure` and `spiritual_depth` with `faith_said_plainly`; reword `every_line_counts`, `hook`, `prayer_meets_need`, `scripture_separate` and `affirmation_grounded`:
   - `affirmation_grounded`: "5: the affirmations speak to the person as 'you', rooted in God's faithfulness rather than self-belief, and each text is tied to what this person shared, the three from different sides (what they face, the worry they named, what they carry); none names a part of the day, so each fits any hour. 3: true but generic or partly self-help, or one assumes a time of day. 1: generic self-help slogans."
   - `sounds_human`: "The devotional and the prayer are read aloud to the person (gen-v2.7). 5: it sounds like a caring friend talking to them out loud: everyday words, contractions, short sentences of different lengths, simple and direct; no speech-making, no line built to sound wise or important, no 'not this, but that', no lists of three, no sentence that sounds like a saying. 3: mostly natural, with a few written, formal or showy lines. 1: it sounds like a sermon, an essay, a greeting card or a business email."
   - `plain_words`: "5: a nine-year-old would understand every sentence the first time they heard it: everyday words, one idea a sentence, no big, literary, church or business words, no word picture that needs explaining; plain without talking down to an adult. 3: mostly plain, with a few hard words or written phrases. 1: written for an adult reader, or childish and talking down."
   - `warm_and_sure`: "5: warm toward the person and sure about God, in plain words: says what is true of him simply, without hedging, and never commands, scolds or promises an outcome. 3: warm but unsure, or sure but cool. 1: preachy, cold or vague."
   - `faith_said_plainly`: "5: says one clear, true thing about God for this person (his presence, his love, his care, that Jesus understands, grace that is not earned) in simple words, and it is the historic Christian faith, not general spirituality. 3: true but thin or vague. 1: no real word about God, or spirituality any belief could say."
   - `every_line_counts`: "5: every sentence says something real to this person: no warm-up line, no generic sentence that could sit in any devotional, no repeated point, no summary at the end, and no line that is there to sound good. 3: one or two filler or showy lines. 1: padded, vague or showy."
   - `hook`: as today, with "in fresh words and in about 14 words or fewer" becoming "said to them in everyday words, the way a friend starts talking, in about 14 words or fewer", and level 3 adding "written like a scene".
   - `prayer_meets_need`: as today, with "it addresses God by who he is for this need" becoming "it talks to God plainly, the way the person does", "declares one lifting truth about God" becoming "says one true thing about God that lifts them", "all in words a tired person would really pray" added to level 5, and "or sounds written rather than prayed" added to level 3.
   - `scripture_separate`: "5: the devotional and the prayer neither quote, paraphrase, cite nor point to the passage; sharing an everyday word with it (near, help, rest) is not an echo. 3: a phrase that repeats the passage's own wording. 1: they quote, paraphrase or cite it."
   - `GRADER_INSTRUCTION`'s first line: "You are an experienced pastor and a plain-language editor reviewing reflections that a private Christian prayer journal wrote for a person's journal entry: you know good care and sound faith, and you know how real people talk." The rest of that line is unchanged.
3. **First replies.** `Attempt` gains `gen27: { plain: boolean; time: boolean } | null`: in `validate`, every reply that has the right shape is also read with `readReflection`, and whether `plainSpeechProblem` and `timeOfDayProblem` would fire is recorded, whatever fault comes first (null when the shape is wrong). That counts what the two checks cost in production.
4. **The report** gains three lines per model, beside its gen-v2.6 column: "plain speech: devotional grade median, max, over 6.5 | prayer grade max | words a sentence median and max | over 25", "words: list words in the final line, devotional and prayer, cases | first replies the plain check would ask again | plainer words | contractions median, uncontracted total | contrast frames | list words in titles, headlines and texts", and "time of day: cases with a time word in the final line, devotional, prayer, headlines and texts (each counted) | first replies the time check would ask again | verses whose text speaks of a part of the day or sleep". The list's own words may be printed in a per-word tally (they are the code's, never the reflection's sentences). The style flags per case add "grade N", "list words N", "time words N" and "no contractions".
5. **The pass bar** (it decides, on each model, against that model's own gen-v2.6 on the same cases; it replaces step 36's section 5.3 bar in the code, whose inherited items are below):
   - A. Plain speech, absolute:
     1. Devotional reading grade median ≤ 5.0 and none over 6.5; no prayer over 6.5.
     2. No list word in any final validation line, devotional or prayer, and no time word in any final line, devotional, prayer, headline or affirmation text (the entry's own and the echo set aside). At most 6 of 37 first replies on `gemini-3.8-flash` (at most 8 on `gemini-3.1-flash-lite`) fail either check of step 2: each retry costs about 5 seconds before the reflection is ready.
     3. `plainerWords` at most half of gen-v2.6's total.
     4. Contractions: a median of at least 3 per devotional; `uncontracted` at most a quarter of gen-v2.6's total.
     5. Words a sentence: the median of the per-case averages between 8.0 and 13.0, and no case over 15.0; no sentence over 25 words.
     6. `contrastFrames` at most 3 in all cases together.
     7. `sounds_human` and `plain_words` each average at least 4.5 with no case at 1 or 2, and gen-v2.6's average on each is at least 0.5 lower. When it is not, the grader cannot tell the two apart: stop and report, and do not tune against it.
   - B. Care, faith and safety, as today and no worse than gen-v2.6:
     8. Every case made, graded and swap-tested; the swap test right on at least 34 of 37.
     9. Every other criterion at or above gen-v2.6's average minus 0.05.
     10. `prayer_meets_need` never 1 or 2; at least two petitions in every prayer; no stock opening; no two openings alike; no shared validation line; the four-entry series; no name or place in a title, headline or line; affirmation verses on at least 95%; the headline bars of step 37. The prayer's voice, grounding at its threshold, the line passing as written, and headlines beginning alike count as misses only when gen-v2.6 does better on the same run and model (on 2026-11-10 gen-v2.6 itself missed the voice on one case, grounding on `injection`, the line on one case, and headlines alike on five).
   - C. Time and length: median under 12 s per reflection on `gemini-3.8-flash` (gen-v2.6 9.4 s); devotionals of 110 to 150 words on at least 30 of 37; median estimated audio 75 to 105 s.
6. **`--speak-ids id,id`.** It reads the named cases of the first model aloud, in the order given, into `tone-eval/listening/sample-01.wav` and onward, with `key.txt` (sample number, case id) and `sheet.md` (each sample with "Does this sound like a real person talking to you? yes / no", "Did it say anything about the time of day that didn't fit when you listened? yes / no" and "If anything was wrong, which sentence?", in two columns, owner and lead). It prints each sample's seconds. `--speak N` stays. `SHEET_IDS` becomes the ten listening ids, so the review sheet matches the audio.
7. **The new case.** Append to `cases.json`, as the 37th:

   ```json
   {
     "id": "left-behind",
     "topic": "setbacks",
     "text": "I’m 31 and everyone around me seems to be moving forward. My friends are getting married, buying houses and getting promoted, and I’m still in the same job, still renting, still single. Some evenings I sit in my car after work and wonder why my life feels stuck. I don’t even know what to ask God for anymore.",
     "names": [],
     "notes": "The project lead's own example of how a friend talks (2026-11-23): stuck while friends move ahead. The devotional and the prayer should sound like a caring friend, in words a nine-year-old knows; the first listening sample."
   }
   ```

   `cases_test.ts`: 37 cases; a gen-v2.7 test that `left-behind` is the 37th, on `setbacks`, with no name; "no case is a crisis" and "every topic has a partner" still pass.
8. `live_check.ts`: print one more line per reflection case, numbers only: grade, list words, contractions.

### 4. The run (made-up text only)

Commands from the repo root. Each prints its spend; keep a running total.

1. Round 1, the production writer, with the ten listening samples (`--speak-ids` costs no Gemini: about 13,000 characters of speech a round, inside the free million a month):

   ```bash
   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
     --allow-net --allow-env --allow-read --allow-write=tone-eval --env-file=supabase/functions/.env.local \
     supabase/functions/process-entry/eval/run_tone_eval.ts --models gemini-3.8-flash --grader gemini-3.8-flash \
     --compare gen-v2.6 --variety \
     --speak-ids left-behind,exam-dropout,anxiety-work,grief-parent,weary-parenting,loneliness,hope-new-start,gratitude-answered-prayer,pidgin-work,prayer-for-friend \
     --budget 1.2
   ```

   About $0.90: 37 reflections with retries about $0.50, 74 grader calls about $0.22, the 36 saved gen-v2.6 reflections regraded under the new rubric plus `left-behind` written by gen-v2.6 about $0.12, the series about $0.04. The saved gen-v2.6 files exist only on this PC (git ignores `tone-eval/`): without them `--compare gen-v2.6` writes all 37, about $0.40 more.
2. Read the misses. Change the wording of steps 1 and 2 only where a miss points. Never add an example taken from a case, never touch Faith, the never-say list or the heavy section, and never move a bar. Record each round's changes.
3. Round 2 on `gemini-3.8-flash`, if needed: the same command with `--budget 1.0`, about $0.75 (gen-v2.6's regrades are kept while the rubric is unchanged). Each round overwrites `tone-eval/listening/`, so the samples always come from the newest wording.
4. The fallback model, once `gemini-3.8-flash` meets the bar: the same command with `--models gemini-3.1-flash-lite`, without `--speak-ids`, and `--budget 1.0`. About $0.75: its gen-v2.7 and gen-v2.6 reflections about $0.30 (gen-v2.6 never ran on it, so all 37 are written with the frozen instruction) and 148 grader calls about $0.45. A wording change needed here is a change for both models: run `gemini-3.8-flash` again after it.
5. The crisis evaluation (`_shared/safety/eval/run_eval.ts`), once as it is and once with `GEMINI_SCREENING_MODEL=gemini-3.1-flash-lite` on the command line: every crisis case flagged, at most 3 of 16 clear cases flagged, none unanswered (about $0.02). The screening did not change; AGENTS.md asks for it after any instruction change.
6. `live_check.ts` with no option: every case as expected, the three heavy cases written whole with no hard check failing (about $0.02).
7. Stop and ask the owner before the total passes $3. After the third round, stop and report with the numbers whether or not the bar is met.

### 5. The listening review (the owner and the lead)

1. Make the ten samples small enough to send: `ffmpeg -i sample-01.wav -c:a aac -b:a 96k sample-01.m4a` for each (ffmpeg is installed on this PC). They are made-up entries, so nothing private leaves.
2. Give the owner `tone-eval/listening/` (the m4a files and `sheet.md`). The owner listens and sends the samples to the lead. Each answers, for each sample: "Does this sound like a real person talking to me?" yes or no; whether anything about the time of day didn't fit when they listened; and, for anything wrong, the sentence. Listening at different hours (some in the morning, some at night) tests the time of day best.
3. It ships when each listener says yes to the first question for at least 9 of the 10, and no sample has a time of day that didn't fit. Otherwise the sentences named shape one more round (step 4.2), within the $3, or with the owner's yes beyond it.
4. Optional, and the owner's call: a pastor reads `tone-eval/review-sheet.md` (the same ten cases). As for gen-v2.6, it does not block.

### 6. Deploy and rollback (the owner's)

The agent never deploys and never holds a management token.

1. Development: `npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <dev-project-ref> --use-api`, then the four probes with no sign-in: 401 with no token, 401 with a made-up one, 405 for a GET, 204 for the preflight. Then the phone walk-through B0 to B4.
2. Production, only after B1 to B4 pass: the same command with `<prod-project-ref>` and the same four probes. Then B5 and B6. No secret, migration or app build is involved, and build 11's testers hear gen-v2.7 at once.
3. Rollback, on either project: make a temporary worktree of the last commit whose `prompt.ts` is gen-v2.6 (`ae541cd` until gen-v2.7 is committed) with `git worktree add <a temp folder outside the repo> ae541cd`, deploy `process-entry` from that folder with the same command, then `git worktree remove` it. Nothing else changes back: the app and the database never knew the version.

## Verification

Part A, before the walk-through:

1. Every Edge Function gate of AGENTS.md passes: the `deno check` list, lint, fmt, the main test run (record the new count against step 0's) and export-data's run, and `parity.cjs`.
2. `eval/prompt_v2_6_test.ts` passes, and the frozen file was proven byte for byte before the edit (step 0.3).
3. The cross-check of step 2 gives the incident's numbers to the digit.
4. The evaluation meets the bar of step 3.5 on both models, or the report says which bars miss and the owner decides. The crisis evaluation and `live_check.ts` pass.
5. The listening review: each listener at 9 of 10 or better, and no time of day that didn't fit.

Breakages to prove, each in a scratch copy of `supabase/functions` (never the repo; a control run first; compare the copy with the repo afterwards, then delete it). Each must be caught by a named test:

1. `PROMPT_VERSION` not bumped.
2. "preaches" left in the Role.
3. "sermon" back in Voice.
4. "rise and land" back.
5. The contractions bullet dropped.
6. The swap list dropped.
7. The 25-word cap removed from Voice or from "Written to be read aloud".
8. "never to commands to the person, and never to promises about outcomes" dropped.
9. "Stay with that feeling for a few sentences before any hope." dropped.
10. The Scripture no-quote rule dropped.
11. The old key-words ban left in.
12. The prayer's naming device left in.
13. The despair rule dropped from `CLOSING_PRAYER_RULE`.
14. "Grant me" back among the openers.
15. The first-person rule dropped.
16. "one picture" left in the hook bullet.
17. A `STOCK_OPENINGS` item missing from the rule line.
18. One word changed in Faith, and separately in "The person" (the new section guard of step 1).
19. One word changed in `HEAVY_INSTRUCTION` (`heavy_test.ts`).
20. An example sentence copied from a case into Voice.
21. The silent-e step dropped from `syllables`.
22. A coefficient of `readingGrade` changed.
23. "faithful" added to `PLAIN_AVOID_WORDS`.
24. "burden" added to `PLAIN_AVOID_WORDS` (the list test and the fallback test).
25. The entry-word exclusion removed.
26. The echo exclusion removed.
27. `PLAIN_RETRY_GRADE` set to 5 (the lead's example then fails).
28. The plain check moved after the hook guard (the first-fault test).
29. An entry word in the note.
30. The salvage changing the devotional.
31. The plain check left out of `checkTone` (the handler test).
32. `gen27Checks: false` ignored.
33. One character changed in `eval/prompt_v2_6.ts`.
34. `left-behind` missing, or given a topic with no partner, or a name.
35. "tonight" back in the next step of "How to care".
36. "for that hour of this person's day" back in the `affirmations` lead line.
37. The "Any hour of the day" section dropped.
38. The time check left out of `checkTone` (the handler test).
39. The headlines or the affirmation texts left out of the time check's scope.
40. The time check's entry exclusion removed (the "night shift" test).
41. The trailing "'s" not removed, so "tonight’s" passes.
42. The fallback's old evening headline "You are held tonight" back (the fallback test, through `checkTone`).

## Phone walk-through

Before B0:

- **Restart:** nothing in the app changed. Start the dev server with `npx expo start --dev-client` (no `-c`) only so the agent can read the app. The owner has deployed `process-entry` on development (step 6.1).
- **Account:** the owner's own, on the development project, with the AI permission given and a reflection left this week (Pro or trial; a free account uses two of its three).
- **Cost:** two reflections, about $0.02 of Gemini and 3,000 characters of speech; one more on production in B5.
- **The app** stays open, in front and connected to the dev server while the agent reads. The agent reads numbers only: never the person's words, the devotional or the prayer. It computes the measures on the phone with a copy of step 2's rules inside the probe.

B0. Starting state.
- **Do:** open the GraceHush development build on Today, signed in.
- **Expect:** Today shows.
- **Read:** `typeof __r` is a function; the data source is `supabase`; signed in; the AI permission given; the outbox holds nothing.

B1. A written reflection.
- **Do:** tap the pen, write three or four sentences about something real or made up, and Submit. Stay on Reflection until it fills in.
- **Expect:** within about 30 seconds the reflection appears, and its first line reads like something a friend would say.
- **Read:** the entry is `ready`; devotional 110 to 150 words; grade 6.5 or under; no sentence over 25 words; no list word (the entry's own set aside); no time word in the line, the devotional or the prayer (the entry's own set aside); at least 2 contractions; at most 1 uncontracted negative; prayer 50 to 75 words.

B2. Listen.
- **Do:** tap play on the mini player and listen to everything: the devotional, the reading and the prayer.
- **Expect:** a caring friend talking in everyday words; nothing that sounds like a sermon, a greeting card or a business email; nothing about the time of day (no "tonight", "this morning", sleeping or waking, unless you wrote about it); "A reading from …" and "Let's pray." as before.
- **Read:** the player reached the end (agent); the owner's answer, yes or no, and for a no, the sentence.

B3. A spoken reflection, at another time of day.
- **Do:** at a different part of the day from B1 if you can (B1 in the morning, B3 at night, or the other way round), tap the mic, speak 20 to 40 seconds about something on your mind, and Finish. Then listen as in B2.
- **Expect:** as B1 and B2.
- **Read:** as B1, and the owner's answer.

B4. The affirmations.
- **Do:** on the reflection of B1, open the Affirmations tab and read the three.
- **Expect:** plain words; each headline one bold line; none names a part of the day.
- **Read:** each headline 38 characters or fewer; each text 12 to 30 words; no time word in any headline or text; list words in the texts (reported, no bar).

B5. Production.
- **Do:** after the owner deploys on production, make one reflection on TestFlight build 11 and listen to it.
- **Expect:** as B2.
- **Read:** the owner's answer. In the production project's Supabase dashboard (Edge Functions, `process-entry`, Logs), the newest request's line shows `"promptVersion":"gen-v2.7"`: the owner reads it, because the agent cannot reach production or a release build.

B6. The lead.
- **Do:** the lead makes one reflection on build 11 and listens.
- **Expect:** "it sounds like a real person", and nothing about the time of day that doesn't fit.
- **Read:** the lead's answer, through the owner.

B7. The next reminders (development, the day after B1).
- **Do:** nothing new. Over the next day, look at the GraceHush reminders on the lock screen at your three reminder times, and at the word on Today when you open the app.
- **Expect:** the words of B1 and B3 fit whatever hour they arrive. A word saved before the deploy may still name a part of the day (Decision 23).
- **Read:** the owner's answer. With the app open, the agent reads the Word Deck's calendar (which affirmation each reminder carries, by id only) and counts time words in those words: none for the words made after the deploy.

Not verified on the phone, with where it is covered:

- A heavy moment: `live_check.ts`'s three made-up heavy cases and the hard checks. Do not ask the owner to write one.
- The retry that production sends to `gemini-3.1-flash-lite`: the evaluation runs each model alone, so a mixed reply is not measured.
- Android: no build, but the change is server-side, so both platforms get the same words.
- Words saved before gen-v2.7: they keep their part of the day until they leave the Word Deck (Decision 23).

## AGENTS.md updates

Edit the root `AGENTS.md`, then copy it to `prompts/AGENTS.md` and check the two are identical. Rules only; the history goes to `docs/build-log.md`. Check the size stays under 800,000 characters.

1. **Instructional Memory**, a new bullet: "**A reflection speaks like a caring friend, in words a nine-year-old understands (2026-11-23).** The project lead tested TestFlight build 11 and found the voice natural but the words a sermon ("so structured, so organized … a human being does not talk like that"). The owner asked for the reflection to be "as human as possible, like a real human that a 9 years old can understand". So since gen-v2.7 everything a reflection says or shows is plain speech (Pastoral Tone Rules, "Plain speech"), which replaces the sermon voice of 2026-10-31. A later change to the reflection's instruction keeps it plain and runs the plain-speech bar and the listening review again."
   A second new bullet: "**Nothing a reflection says depends on the time of day (2026-11-23).** The owner found bedtime advice in the morning and waking-up words at night. The instruction's own examples said "tonight", the affirmations were written per hour, and the Word Deck shows any word at any reminder. Since gen-v2.7 every line the model writes fits any hour ("Any hour of the day" in the instruction, and the `time_of_day` check). The time of day lives only where the app reads the phone's clock as it shows something: the greeting and the reminder times. The owner chose this over words timed by the device, which would still be wrong when a devotional is replayed later or a word stays on the Today card."
2. **Pastoral Tone Rules:**
   - The opening line: `PROMPT_VERSION` `gen-v2.7` since the deploy date, plain speech and any hour.
   - A new bullet, "**Any hour of the day (gen-v2.7).**", stating Decisions 19 to 21 in a few lines.
   - Replace the bullet "The affirmation text names their day (decision 8)" with the three sides of Decision 20: what they face, the worry they named, and what they carry, none naming a part of the day.
   - "A verse under each affirmation": drop any "at that hour", and say the verse never speaks of the morning, the night or sleep unless the person's words do.
   - Replace the bullet "The voice (the user's strict rules, 2026-10-31)" with a bullet "**Plain speech (gen-v2.7; it replaced the sermon voice of 2026-10-31).**" that states, in a few lines: Decisions 1 to 5, 7 and 8; the check of Decision 11 (`plainSpeechProblem`, `PLAIN_AVOID_WORDS`, `readingGrade` over 7.0, one retry, `salvaged:plain_speech`); and that Faith, the never-say list, the heavy section and the fallback are unchanged.
   - "The order of care": "declare one truth … plainly and with conviction" becomes "tell them one true thing about who God is to them, simply and surely"; the next step's example is "one thing to hand over to God", with no "tonight"; the last line is "short and warm, never a slogan".
   - "The first line is a hook": add "said to them, with "you" or "your" in it (gen-v2.7)" and drop "one picture".
   - "Written for the voice": "most under 15 words and never over 25, with a contraction every time a person would say one".
   - "The prayer is the person's own …": moves (1) and (4) as in `CLOSING_PRAYER_RULE`, no naming device, no "Grant me".
   - "Hard checks and style measures": add the plain-speech and time-of-day soft checks, run in that order after the echo and before the hook guard.
   - "A retry is told what to fix": the plain and time notes name only words of the code's lists or a phrase the model wrote, never the person's words.
   - "Versions": gen-v2.7 froze gen-v2.6 in `eval/prompt_v2_6.ts`, and gen-v2.5 is compared only through its saved reflections.
   - "The evaluation": 37 cases (`left-behind`); 17 criteria; the bar of step 3.5 of this prompt; the listening review.
3. **Edge Function Rules**, the log bullet: add `salvaged:plain_speech` and `salvaged:time_of_day` to the list of 200 reasons. **Crisis Safety Rules**, the written fallback: since gen-v2.7, with the owner's approval, its affirmations fit any hour (Decision 22). **Notification Rules**, the Word Deck: since gen-v2.7 every word fits any hour, so a word's slot only says where it is sent first; words saved before it keep their part of the day.
4. **Linting and Validation**, the tone evaluation command: add `[--speak-ids id,id]`.
5. `docs/architecture-tree.md`: name `eval/prompt_v2_6.ts` and its test in the `process-entry` line.
6. `docs/build-log.md`: append the gen-v2.7 entry: what was built; the measures before and after on both models; each round's wording changes; the bar; the crisis and live checks; the listening results; the spend; the breakages; what was not verified; and the hand-offs. Then, after the walk-through, its B0 to B6 lines.
