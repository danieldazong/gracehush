import { daysAgo, minutesAgo } from "@/data/mock/dates";
import { bsb, type BsbReference } from "@/data/mock/scripture";
import { MOCK_USER_ID } from "@/data/mock/users";
import type { EmotionKey, InputType, PrayerCategory } from "@/types";
import type { JournalEntryRow } from "@/types/database";

export const ANXIOUS_ENTRY_ID = "entry-anxious-yesterday";
export const CRISIS_ENTRY_ID = "entry-crisis-six-days-ago";

// Fixed UUID v4 strings, as step 19 requires for client_entry_id.
const CLIENT_IDS = {
  processing: "3f6c1b2e-8a4d-4c1e-9b7a-2d5e6f708192",
  pending: "7d2a9e41-5b3c-4f8a-a6d1-0c9e8b7a6f55",
  failed: "c84e1f20-9a6b-4d3e-8f12-b5a7c6d9e031",
  offlineNewest: "e19b5c73-2d4a-4b8f-b3c6-7a8d9e0f1a24",
  offlineOlder: "5a0d7f68-c3e1-4a92-8d57-1f2b3c4d5e6a",
};

// Step 18 layout: {userId}/raw/{clientEntryId}.m4a. Playback is mocked, so no file needs to exist.
const rawAudioPath = (clientEntryId: string) => `${MOCK_USER_ID}/raw/${clientEntryId}.m4a`;

// A row with every column set, so only what differs from an empty text entry is written per entry.
function entryRow(id: string, createdAt: Date, fields: Partial<JournalEntryRow>): JournalEntryRow {
  const created = createdAt.toISOString();
  return {
    id,
    user_id: MOCK_USER_ID,
    created_at: created,
    input_type: "text",
    transcript: null,
    dominant_emotion: null,
    scripture_reference: null,
    scripture_text: null,
    devotional_script: null,
    is_active_prayer: false,
    is_answered: false,
    answered_at: null,
    client_entry_id: null,
    processing_status: "ready",
    error_code: null,
    is_crisis: false,
    audio_path: null,
    devotional_audio_path: null,
    devotional_duration_ms: null,
    scripture_verified: false,
    devotional_title: null,
    closing_prayer: null,
    prayer_title: null,
    prayer_category: null,
    prayer_summary: null,
    answered_notes: null,
    updated_at: fields.answered_at ?? created,
    ...fields,
  };
}

interface ReadyEntrySpec {
  id: string;
  createdAt: Date;
  input: InputType;
  emotion: EmotionKey;
  transcript: string;
  reference: BsbReference;
  title: string;
  script: [string, string]; // two paragraphs
  closing: string; // without the final "Amen"
  // null: the voice could not be generated (TTS_FAILED). The entry stays ready and the text still shows.
  durationMs: number | null;
  // A tracked prayer. `answered` makes it an answered one.
  prayer?: {
    title: string;
    category: PrayerCategory;
    summary: string;
    answered?: { at: Date; note: string };
  };
}

// A finished entry: verified scripture, a devotional and, when the spec has one, a prayer.
function readyEntry(spec: ReadyEntrySpec): JournalEntryRow {
  const hasAudio = spec.durationMs !== null;
  return entryRow(spec.id, spec.createdAt, {
    input_type: spec.input,
    transcript: spec.transcript,
    dominant_emotion: spec.emotion,
    scripture_reference: spec.reference,
    scripture_text: bsb[spec.reference],
    scripture_verified: true,
    devotional_title: spec.title,
    devotional_script: spec.script.join("\n\n"),
    closing_prayer: spec.closing,
    devotional_audio_path: hasAudio ? `${MOCK_USER_ID}/devotionals/${spec.id}.wav` : null,
    devotional_duration_ms: spec.durationMs,
    error_code: hasAudio ? null : "TTS_FAILED",
    is_active_prayer: spec.prayer !== undefined,
    prayer_title: spec.prayer?.title ?? null,
    prayer_category: spec.prayer?.category ?? null,
    prayer_summary: spec.prayer?.summary ?? null,
    is_answered: spec.prayer?.answered !== undefined,
    answered_at: spec.prayer?.answered?.at.toISOString() ?? null,
    answered_notes: spec.prayer?.answered?.note ?? null,
  });
}

// The default scenario: 24 entries. 20 are finished (4 featured cards, 4 active and 12 answered
// prayers), plus one each that is processing, pending, failed and a crisis.
export function buildEntries(now: Date): JournalEntryRow[] {
  const at = (days: number, hour: number, minute: number) => daysAgo(days, hour, minute, now);
  const ago = (minutes: number) => minutesAgo(minutes, now);

  return [
    // Featured journal cards (1, 2, 3 and 7), copy from the Journal and Reflection designs.
    readyEntry({
      id: ANXIOUS_ENTRY_ID,
      createdAt: at(1, 20, 45),
      input: "audio",
      emotion: "anxious",
      transcript:
        "Lord, work has been so overwhelming lately and I feel like I’m dropping every ball. Help me remember where my peace comes from. I woke up with my heart pounding and I just need to breathe.",
      reference: "Philippians 4:6–7",
      title: "Peace in the Midst",
      script: [
        "Sarah, your spirit feels weary because you’ve been carrying responsibilities meant for hands far larger than your own. Taking a breath right now isn’t quitting—it is reverence.",
        "Peace isn’t the absence of tomorrow’s unanswered questions; it is the presence of an unwavering Shepherd sitting with you in this very hour. Rest your palms open.",
      ],
      closing:
        "Lord, take what is unraveled inside me and lay it flat under Your quiet hand. When my chest tightens, remind me that my breath belongs to You, and my tomorrow is already held in peace.",
      durationMs: 75000,
      prayer: {
        title: "Wisdom for what is mine to carry",
        category: "GUIDANCE",
        summary:
          "Asking for wisdom to sort what is mine to carry from what is not, and for a steady heart while the workload feels heavy.",
      },
    }),
    readyEntry({
      id: "entry-weary-three-days-ago",
      createdAt: at(3, 7, 15),
      input: "audio",
      emotion: "weary",
      transcript:
        "Just feeling exhausted down to my bones this morning. Give me strength for the tasks today and quiet my restless thoughts. I keep waking before the alarm with my mind already running.",
      reference: "Matthew 11:28–30",
      title: "Rest for the Weary",
      script: [
        "You do not have to be strong before you come to Him. Weariness is not a failure of faith; it is simply the weight of a long road.",
        "Set the day’s list down for a moment. His yoke is easy because He carries the heavier end beside you.",
      ],
      closing:
        "Lord, I come tired and without answers; give me Your rest and steady my restless thoughts.",
      durationMs: 88000,
    }),
    readyEntry({
      id: "entry-grateful-five-days-ago",
      createdAt: at(5, 21, 20),
      input: "text",
      emotion: "grateful",
      transcript:
        "Thank you for the unexpected kindness from my sister today. It felt like cool water in the desert after such a dry week. I want to remember how good it is to be noticed.",
      reference: "Psalm 103:1–5",
      title: "A Grateful Heart",
      script: [
        "Gratitude is a quiet way of seeing what was already given. Today a small kindness reached you, and you let it in without hurry.",
        "Bless the Lord with your whole self, even in a dry season, and let yourself remember His kindnesses one by one.",
      ],
      closing:
        "Thank You, Lord, for the kindness that found me this week, and teach me to notice Your hand in it.",
      durationMs: 58000,
    }),
    readyEntry({
      id: "entry-hopeful-four-days-ago",
      createdAt: at(4, 18, 5),
      input: "audio",
      emotion: "hopeful",
      transcript:
        "I got news today that things may finally be turning. I’m afraid to hope too much, but I want to lean toward it anyway.",
      reference: "Romans 15:13",
      title: "Hope Ahead",
      script: [
        "Hope is not a guarantee about tomorrow; it is leaning toward the God who holds it. You are allowed to lean, even with a trembling heart.",
        "Let this small light be enough for tonight. He fills what you cannot, with joy and peace as you trust Him.",
      ],
      closing:
        "Lord, thank You for this small light; help me hold hope gently and trust You with what comes next.",
      durationMs: null,
    }),

    // Entries that did not finish, and the crisis entry.
    entryRow("entry-processing-today", ago(40), {
      input_type: "audio",
      processing_status: "processing",
      client_entry_id: CLIENT_IDS.processing,
      audio_path: rawAudioPath(CLIENT_IDS.processing),
    }),
    entryRow("entry-pending-today", ago(12), {
      processing_status: "pending",
      client_entry_id: CLIENT_IDS.pending,
      transcript:
        "The uncertainty about our family decision has felt heavy all afternoon. I don’t have the words yet, only the weight of it.",
    }),
    entryRow("entry-failed-two-days-ago", at(2, 17, 30), {
      input_type: "audio",
      processing_status: "failed",
      error_code: "AI_UNAVAILABLE",
      client_entry_id: CLIENT_IDS.failed,
      audio_path: rawAudioPath(CLIENT_IDS.failed),
    }),
    entryRow(CRISIS_ENTRY_ID, at(6, 22, 30), {
      is_crisis: true,
      transcript:
        "I don’t know how much longer I can keep carrying all of this. Everything feels too heavy.",
    }),

    // Active prayers (with the anxious entry above, five). Copy from the Prayers design.
    readyEntry({
      id: "entry-prayer-family-24-days",
      createdAt: at(24, 7, 40),
      input: "audio",
      emotion: "grieving",
      transcript:
        "Lord, be near my mom this season. Give her rest in the evenings and give her caregivers a gentle spirit.",
      reference: "Psalm 91:4",
      title: "Under His Wings",
      script: [
        "You are carrying someone you love, and love this tender can feel heavy. Even now, you are not holding her alone.",
        "He covers with His feathers and shelters under His wings. Let that refuge be hers tonight, and yours, and rest where you can.",
      ],
      closing: "Father, wrap my mother in Your peace tonight, and steady those who care for her.",
      durationMs: 62000,
      prayer: {
        title: "Mom’s recovery and peaceful transition",
        category: "FAMILY & HEALING",
        summary:
          "Lifting up her evening strength and asking for soft rest without sudden breathlessness. Praying for gentle spirit among caregivers.",
      },
    }),
    readyEntry({
      id: "entry-prayer-work-11-days",
      createdAt: at(11, 12, 20),
      input: "text",
      emotion: "weary",
      transcript:
        "Deadlines keep stacking up and my patience is thin with everyone around me. I want to meet my colleagues with grace, not frustration.",
      reference: "Colossians 3:12",
      title: "Clothed in Patience",
      script: [
        "Patience is not something you have to produce on your own. You are already clothed for it, one small choice at a time.",
        "When the next deadline presses in, pause for a single breath. Let kindness and gentleness be the first thing you put on.",
      ],
      closing: "Lord, clothe me in kindness and patience today, and let it reach everyone I work beside.",
      durationMs: 58000,
      prayer: {
        title: "Patience in daily work responsibilities",
        category: "VOCATION & CALLING",
        summary:
          "Asking for quiet wisdom when deadlines feel rushed, and grace toward colleagues during tough negotiations.",
      },
    }),
    readyEntry({
      id: "entry-prayer-sleep-4-days",
      createdAt: at(4, 22, 10),
      input: "text",
      emotion: "anxious",
      transcript:
        "The house is quiet and my thoughts are not. I want to lie down without rehearsing tomorrow.",
      reference: "Proverbs 3:24",
      title: "Sweet Sleep",
      script: [
        "The night does not need you to solve tomorrow. Lay the day down piece by piece, and let the quiet hold what you cannot.",
        "When you lie down, you will not be afraid. Let that promise be softer than your racing thoughts tonight.",
      ],
      closing: "Father, quiet my mind tonight and give me sleep that is sweet and unafraid.",
      durationMs: 51000,
      prayer: {
        title: "Restful sleep through anxious evenings",
        category: "INNER PEACE",
        summary:
          "Quieting racing thoughts when the house is still. Entrusting tomorrow’s unseen turns to God’s safe keeping.",
      },
    }),
    readyEntry({
      id: "entry-prayer-home-2-days",
      createdAt: at(2, 8, 5),
      input: "text",
      emotion: "hopeful",
      transcript:
        "Things have been tense with my daughter and we keep ending up in the same argument. I want to listen first and speak gently.",
      reference: "Romans 12:18",
      title: "Living at Peace",
      script: [
        "Reaching for peace at home is a quiet kind of courage. You do not need the perfect words, only a willing heart and a slower pace.",
        "If it is possible on your part, live at peace. Do your part gently, and leave the rest in His hands.",
      ],
      closing: "Lord, soften my words and open my ears so peace can grow in our home.",
      durationMs: 47000,
      prayer: {
        title: "Gentler conversations with my daughter",
        category: "RELATIONSHIPS",
        summary:
          "Asking for patience and open ears so my daughter and I can talk without the old arguments, and for peace in our home.",
      },
    }),

    // Answered prayers (twelve). The first three are from the Prayers design.
    readyEntry({
      id: "entry-answered-caregiving",
      createdAt: at(40, 19, 30),
      input: "audio",
      emotion: "anxious",
      transcript:
        "We have to decide how to share the care for Mom and I can’t see the right answer yet. Please show us a way that is fair and kind to everyone.",
      reference: "Philippians 4:19",
      title: "Supplied in Time",
      script: [
        "You have been asked to decide what feels too big to decide. Your needs, and your family’s, are known to Him.",
        "He supplies what is needed, often through the people already beside you. Look for the quiet answer, and let others help.",
      ],
      closing: "Lord, show us a way to share this care with love, and supply what we cannot see yet.",
      durationMs: 69000,
      prayer: {
        title: "Clarity on family caregiving choices",
        category: "FAMILY & HEALING",
        summary:
          "Asking for clarity about how to share the care of a family member, and for peace in whatever we decide together.",
        answered: {
          at: at(22, 9, 15),
          note: "Sister called and offered to take the weekend shifts. God provided peace beyond what we could orchestrate.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-review",
      createdAt: at(68, 8, 50),
      input: "text",
      emotion: "anxious",
      transcript:
        "My quarterly review is this week and my stomach is in knots. I want to walk in steady and listen well.",
      reference: "Isaiah 26:3",
      title: "A Steady Mind",
      script: [
        "Nerves before an important day do not mean you are unprepared. They mean this matters to you, and that is allowed.",
        "He keeps in perfect peace the steadfast of mind. Fix your attention on Him for a moment, and walk in with a steady step.",
      ],
      closing: "Lord, keep my mind fixed on You, and let me listen well and answer with a calm heart.",
      durationMs: 54000,
      prayer: {
        title: "Peace during quarterly review",
        category: "VOCATION & CALLING",
        summary:
          "Walking into the quarterly review with a calm mind, and asking for honest feedback and healthy boundaries.",
        answered: {
          at: at(36, 17, 20),
          note: "Felt calm walking into the room. Received encouraging feedback and healthy boundaries.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-exhaustion",
      createdAt: at(63, 21, 45),
      input: "audio",
      emotion: "weary",
      transcript:
        "I have been running on empty for weeks and I can’t seem to sleep through the night. Please restore me, Lord.",
      reference: "Psalm 23:2",
      title: "Quiet Waters",
      script: [
        "Exhaustion is the body asking for what only rest can give. You are allowed to stop and be tended, even if the list is still long.",
        "The Shepherd makes you lie down in green pastures and leads you beside quiet waters. Let Him lead you slowly tonight.",
      ],
      closing: "Good Shepherd, restore my strength and lead me to the quiet waters I cannot find alone.",
      durationMs: 72000,
      prayer: {
        title: "Healing from season of exhaustion",
        category: "INNER PEACE",
        summary:
          "Asking for restoration after a long season of exhaustion, and for sleep that truly restores.",
        answered: {
          at: at(56, 7, 30),
          note: "Finally sleeping through the night without racing thoughts. Thank you Lord for restoration.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-car-repair",
      createdAt: at(14, 7, 25),
      input: "text",
      emotion: "anxious",
      transcript:
        "The car needs a repair we did not plan for and I am worried about how we will cover it. Please provide, Lord.",
      reference: "Matthew 6:26",
      title: "Cared For",
      script: [
        "A sudden expense can make everything feel uncertain at once. It is okay to say that this worries you, and to ask for help.",
        "Look at the birds of the air: your heavenly Father feeds them. You are far more valuable to Him than they are.",
      ],
      closing: "Father, You see this need; provide what we lack and keep my heart from panic.",
      durationMs: 49000,
      prayer: {
        title: "Provision for the unexpected car repair",
        category: "PROVISION",
        summary:
          "Asking for provision after an unexpected car repair, and for a calm heart while the cost is still unknown.",
        answered: {
          at: at(5, 12, 40),
          note: "The repair cost far less than we feared, and a friend offered to drive me to work in the meantime.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-new-role",
      createdAt: at(85, 20, 15),
      input: "audio",
      emotion: "hopeful",
      transcript:
        "I was offered a new role and I keep going back and forth. I want to choose with a clear mind, not out of fear.",
      reference: "Proverbs 3:5–6",
      title: "Straight Paths",
      script: [
        "Two good options can leave you stuck, and the waiting can feel long. You do not have to figure it out by understanding alone.",
        "Trust in the Lord with all your heart, and acknowledge Him in your ways. He will make your paths straight, in His time.",
      ],
      closing: "Lord, I trust You with this choice; show me the next step and give me peace in it.",
      durationMs: 66000,
      prayer: {
        title: "Wisdom about the new role",
        category: "GUIDANCE",
        summary:
          "Asking for wisdom about whether to accept a new role, and for clear peace about the decision.",
        answered: {
          at: at(60, 8, 50),
          note: "After weeks of waiting I felt settled about staying where I am, and I am at peace with the decision.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-neighbor",
      createdAt: at(30, 18, 10),
      input: "text",
      emotion: "weary",
      transcript:
        "Things have been tense with the neighbor over the fence line. I don’t want to answer sharply when we speak.",
      reference: "Proverbs 15:1",
      title: "A Gentle Answer",
      script: [
        "Tension with someone nearby wears on you more than it seems. You can choose how you answer, even when you feel stung.",
        "A gentle answer turns away wrath. Let your next words be small, kind, and unhurried, and trust Him with the rest.",
      ],
      closing:
        "Lord, guard my tongue and soften my heart so that peace can find its way between us.",
      durationMs: 56000,
      prayer: {
        title: "Peace with my neighbor",
        category: "RELATIONSHIPS",
        summary:
          "Asking for a gentle way to ease the tension with a neighbor, and for softer words from both of us.",
        answered: {
          at: at(12, 10, 5),
          note: "We talked over the fence last weekend and cleared the air. The kindness went both ways.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-new-school",
      createdAt: at(52, 6, 55),
      input: "audio",
      emotion: "anxious",
      transcript:
        "My son starts at a new school tomorrow and I can’t stop worrying for him. Please go ahead of him and let him feel safe.",
      reference: "Isaiah 41:10",
      title: "I Am With You",
      script: [
        "Sending a child into something new is its own kind of trust. Your worry is a sign of how much you love him.",
        "Do not fear, for He is with you. He will strengthen, help, and uphold, and He goes ahead of your son too.",
      ],
      closing: "Father, go ahead of my son into this new place, and let both of us feel Your nearness.",
      durationMs: 61000,
      prayer: {
        title: "A smooth start at the new school",
        category: "FAMILY & HEALING",
        summary:
          "Praying for my son’s first weeks at a new school, that he would find friends and feel safe and known.",
        answered: {
          at: at(31, 15, 30),
          note: "He came home smiling and told us about the friend he sat beside at lunch.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-test-results",
      createdAt: at(20, 22, 0),
      input: "text",
      emotion: "anxious",
      transcript:
        "I have been waiting days for test results and my mind keeps running to the worst places. Please hold my anxiety for me.",
      reference: "1 Peter 5:7",
      title: "Handing It Over",
      script: [
        "Waiting for answers can make the mind run to the hardest places. You can say plainly how afraid you are, and you do not have to wait in silence.",
        "Cast all your anxiety on Him, because He cares for you. Hand it over again each time it returns.",
      ],
      closing:
        "Lord, I place this waiting in Your hands; hold my anxiety and keep me steady until I know.",
      durationMs: 74000,
      prayer: {
        title: "Peace while waiting for test results",
        category: "INNER PEACE",
        summary:
          "Asking for a quiet heart while waiting for medical test results, and for strength to receive whatever comes.",
        answered: {
          at: at(10, 11, 45),
          note: "The results came back clear. I am thankful, and I am keeping the quiet I learned while I waited.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-colleague",
      createdAt: at(100, 12, 35),
      input: "audio",
      emotion: "anxious",
      transcript:
        "I have to have a difficult conversation with a colleague tomorrow. Please give me the right words and a calm voice.",
      reference: "James 1:5",
      title: "Wisdom Freely Given",
      script: [
        "A hard conversation can feel like walking into wind. You do not have to have every word ready, only a willing and listening heart.",
        "If any of you lacks wisdom, ask God, who gives generously without finding fault. Ask, and then speak slowly and kindly.",
      ],
      closing: "Lord, give me wisdom for this conversation and a calm voice to use it.",
      durationMs: 53000,
      prayer: {
        title: "Wisdom for a hard conversation at work",
        category: "VOCATION & CALLING",
        summary:
          "Asking for wisdom and a calm voice for a hard conversation with a colleague, and for it to end in understanding.",
        answered: {
          at: at(77, 16, 10),
          note: "We found common ground faster than I expected, and the conversation ended with a handshake.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-short-month",
      createdAt: at(120, 7, 5),
      input: "text",
      emotion: "weary",
      transcript:
        "This month is going to be tight and I keep running the numbers in my head. Please help us trust You with what we need.",
      reference: "2 Corinthians 9:8",
      title: "Enough for Today",
      script: [
        "Running the numbers at night rarely brings peace. It is allowed to name the shortage out loud.",
        "God is able to make all grace abound to you, so that you have all you need at all times. Take today’s step, and trust Him with the rest.",
      ],
      closing:
        "Father, You know what we need before we ask; meet it, and keep fear from ruling this month.",
      durationMs: 64000,
      prayer: {
        title: "Provision for a short month",
        category: "PROVISION",
        summary:
          "Asking for provision to cover a short month, and for trust that our needs will be met without panic.",
        answered: {
          at: at(90, 9, 25),
          note: "An unexpected refund arrived the same week and covered what we were short. We felt carried.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-moving",
      createdAt: at(75, 19, 50),
      input: "audio",
      emotion: "hopeful",
      transcript:
        "We keep talking about moving closer to family and neither of us is sure. Please show us the way and the right timing.",
      reference: "Psalm 32:8",
      title: "The Way Ahead",
      script: [
        "Not knowing which way to go can feel like standing at a crossroads in fog. You are not meant to find the way alone.",
        "He promises to instruct you and teach you the way you should go, to give counsel, and to watch over you.",
      ],
      closing: "Lord, make the way clear in Your time, and keep my heart at rest while I wait.",
      durationMs: 70000,
      prayer: {
        title: "Clarity about moving closer to family",
        category: "GUIDANCE",
        summary:
          "Asking for clear direction on whether to move closer to family, and for peace about the timing.",
        answered: {
          at: at(48, 13, 15),
          note: "We decided to stay one more year, and both of us felt at ease about it.",
        },
      },
    }),
    readyEntry({
      id: "entry-answered-friendship",
      createdAt: at(9, 20, 40),
      input: "text",
      emotion: "hopeful",
      transcript:
        "A misunderstanding has left my friend and me distant for weeks. Please give me humility and warmth to make it right.",
      reference: "Proverbs 17:17",
      title: "A Friend at All Times",
      script: [
        "A strained friendship can ache quietly for a long time. Wanting it mended says something good about you, even if it feels risky.",
        "A friend loves at all times. Begin with humility and warmth, and let kindness do the first work, and leave the outcome with Him.",
      ],
      closing: "Lord, give me humility and warmth to repair what has been strained between us.",
      durationMs: 48000,
      prayer: {
        title: "Restoring a strained friendship",
        category: "RELATIONSHIPS",
        summary:
          "Asking for humility and warmth to repair a friendship that has felt strained since a misunderstanding.",
        answered: {
          at: at(3, 9, 50),
          note: "She called me first, and we laughed for an hour. The friendship feels mended.",
        },
      },
    }),
  ];
}

// The offline scenario adds two entries saved on this device that are waiting to sync (the newest).
export function buildOfflineEntries(now: Date): JournalEntryRow[] {
  return [
    entryRow("entry-offline-newest", minutesAgo(1, now), {
      processing_status: "pending",
      client_entry_id: CLIENT_IDS.offlineNewest,
      transcript:
        "Tonight I am asking for patience with the people closest to me, and for a gentler tone at the end of a long day.",
    }),
    entryRow("entry-offline-older", minutesAgo(3, now), {
      processing_status: "pending",
      client_entry_id: CLIENT_IDS.offlineOlder,
      transcript:
        "A quiet moment on the way home reminded me how much I have been given. I want to remember it.",
    }),
  ];
}
