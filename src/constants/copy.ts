import type { AmbientSound, OutboxStatus, PlaybackError, PlaybackRate, TimeSlot } from "@/types";

// "1 day", "7 days". The paywall's trial lines and disclosures share it.
const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

// What the mini player and Now Playing say when a devotional's audio could not be had (step 26). Tapping play tries again.
const playbackErrors = {
  offline: "Audio needs a connection.",
  unavailable: "We couldn’t load the audio. Tap play to try again.",
} satisfies Record<PlaybackError, string>;

export const copy = {
  onboarding: {
    stepCounter: (step: number, total: number) => `${step} of ${total}`,
    stepLabel: (step: number, total: number) => `Step ${step} of ${total}`,
    welcome: {
      wordmark: "Gracehush",
      tagline: "Audio Sanctuary",
      title: "A quiet place for your heart.",
      subtitle:
        "Speak or write what you’re carrying. Receive scripture, a spoken devotional, and gentle reminders through your day.",
      primary: "Get Started",
      signIn: "I already have an account",
    },
    rhythm: {
      eyebrow: "Your rhythm",
      title: "When would you like a gentle word?",
      subtitle: "Three short affirmations, drawn from your own prayers, at the times you choose.",
      slots: {
        morning: { name: "Morning", descriptor: "Dawn stillness & focus" },
        afternoon: { name: "Afternoon", descriptor: "Midday breather & peace" },
        evening: { name: "Evening", descriptor: "Rest & surrender" },
      },
      helper: "You can change these anytime in Settings.",
      primary: "Continue",
      back: "Back",
      done: "Done",
      changeTime: (slot: string, time: string) => `${slot} reminder, ${time}, change time`,
    },
    permissions: {
      eyebrow: "Before we begin",
      title: "Two small things to make Gracehush work",
      subtitle: "We’ll only ask once. You can change these in your device settings.",
      microphone: {
        title: "Microphone",
        body: "So you can pray out loud. Your recording is used only to create your reflection.",
      },
      notifications: {
        title: "Notifications",
        body: "For your three daily affirmations. Never ads or spam.",
      },
      privacy: "Your words stay private. You can export or delete everything anytime.",
      primary: "Allow & Continue",
      later: "Maybe later",
    },
  },
  common: {
    close: "Close",
    dismiss: "Dismiss",
    today: "Today",
    yesterday: "Yesterday",
    defaultDevotionalTitle: "Your devotional",
  },
  tabs: {
    journal: "Journal",
    prayers: "Prayers",
    profile: "Profile",
    // iOS only: with the new architecture React Native speaks no role for a tab, so the label says it.
    a11yLabel: (name: string, position: number, total: number) =>
      `${name}, tab, ${position} of ${total}`,
  },
  header: {
    eyebrow: "Gracehush",
    openProfile: "Open profile",
  },
  dock: {
    write: "Write a reflection",
    speak: "Speak a reflection",
  },
  auth: {
    back: "Go back",
    stepLabel: "Step 1 of 1",
    title: "Your sanctuary is waiting.",
    subtitle: "Sign in to keep your reflections safe and synced across your devices.",
    apple: "Continue with Apple",
    google: "Continue with Google",
    email: "Continue with email",
    or: "or",
    privacy: {
      title: "Your entries are private",
      body: "AI helps write and organize your reflections; you can export or permanently delete everything at any time.",
    },
    sheet: {
      emailTitle: "Continue with email",
      emailBody: "We’ll send a 6-digit code. No password needed.",
      emailLabel: "Email address",
      emailPlaceholder: "you@example.com",
      send: "Send code",
      codeTitle: "Check your inbox",
      codeBodyBefore: "Enter the 6-digit code we sent to ",
      codeBodyAfter: ".",
      codeLabel: "Verification code, 6 digits",
      verifying: "Verifying…",
      resend: "Resend code",
      resendIn: (seconds: number) => `Resend in 0:${String(seconds).padStart(2, "0")}`,
      changeEmail: "Use a different email",
    },
    errors: {
      invalidEmail: "That email address doesn’t look right. Please check it and try again.",
      invalidCode: "That code didn’t work. Please try again.",
      network: "We couldn’t connect. Please check your internet and try again.",
      unknown: "Something went wrong. Please try again.",
      extraVerification: "We couldn’t finish signing you in. Please try another way to continue.",
      providerUnavailable:
        "That sign-in option isn’t available right now. Please try another way to continue.",
      codeExpired: "That code has expired. Please request a new one.",
      rateLimited: "Please wait a moment before trying again.",
    },
  },
  notifications: {
    // The Android channel name, shown in the system notification settings.
    channelName: "Daily affirmations",
    // An affirmation notification's title, the same words as the Journal card's eyebrow: "Morning affirmation". Its body is
    // the affirmation's headline (step 28): the lock screen shows nothing else.
    affirmationTitle: (slotName: string) => `${slotName} affirmation`,
  },
  journal: {
    greeting: (period: TimeSlot, name: string | null) =>
      name ? `Good ${period}, ${name}` : `Good ${period}`,
    reflectionDays: (count: number) =>
      count === 1 ? "1 day of reflection" : `${count} days of reflection`,
    affirmation: {
      eyebrow: (slotName: string) => `${slotName} affirmation`,
      save: "Save affirmation",
      unsave: "Remove from saved",
      // Shown under the card when saving the heart failed and the heart went back (step 25).
      saveError: "We couldn’t save that. Please try again.",
      footer: (time: string, source: string | null) =>
        source ? `${time} • Tied to ${source}` : time,
      sourceToday: "today’s prayer",
      sourceYesterday: "yesterday’s prayer",
      sourceOn: (date: string) => `your ${date} prayer`,
    },
    section: {
      title: "Your Reflections",
      entryCount: (count: number) => (count === 1 ? "1 entry" : `${count} entries`),
      filter: "Filter",
      filterOn: "Filter · 1",
    },
    filter: {
      title: "Filter reflections",
      showing: (name: string) => `Filter reflections, showing ${name}`,
      chips: {
        all: "All",
        anxious: "Anxious",
        weary: "Weary",
        grateful: "Grateful",
        grieving: "Grieving",
        hopeful: "Hopeful",
        prayers: "Prayer requests",
      },
      show: (count: number) => (count === 1 ? "Show 1 reflection" : `Show ${count} reflections`),
      reset: "Reset",
    },
    card: {
      // Curly quotes around the transcript excerpt.
      quote: (text: string) => `“${text}”`,
      voiceReflection: "Voice reflection",
      crisis: "A heavy moment. Tap to see support.",
      textOnly: "Text only",
      preparing: "Preparing your devotional…",
      saving: "Saving your reflection…",
      waiting: "Waiting to sync",
      failed: "We couldn’t finish this one.",
      tryAgain: "Try again",
      support: "Support resources",
      // A reflection that is only on this phone never shows its words.
      writtenReflection: "Written reflection",
      review: "Review",
      reviewLabel: "Review this reflection",
      seePlans: "See plans",
      seePlansLabel: "See plans to prepare this reflection",
      // The screen-reader action of a card with a play pill (step 26). The pill is not a stop of its own: the card is the one
      // element, and this is an action on it.
      playAction: "Play devotional",
      // The status line of a reflection that is saved on this phone and has not been prepared yet (step 24). The card shows
      // it and a screen reader speaks it. `weekday` is when the free limit's week ends.
      pendingLine: (status: OutboxStatus, online: boolean | null, weekday: string | null) => {
        switch (status) {
          case "queued":
            return online === false
              ? "Saved on this phone · Waiting to connect"
              : "Preparing your reflection…";
          case "sending":
            return "Preparing your reflection…";
          case "needs_action":
            return "We couldn’t finish this one.";
          case "limit_reached":
            return weekday ? `Saved · Unlocks with Pro or on ${weekday}` : "Saved · Unlocks with Pro";
          case "paused_auth":
            return "Saved · Sign in to continue";
        }
      },
      // The parts of a card's spoken summary. The transcript is never part of it.
      a11y: {
        from: (timestamp: string) => `Reflection from ${timestamp}`,
        emotion: (emotion: string) => `Emotion: ${emotion}`,
        devotional: (spoken: string) => `Devotional ${spoken}`,
        devotionalAudio: "Devotional audio",
        preparing: "Preparing your devotional",
        saving: "Saving your reflection",
        failed: "We couldn’t finish this one",
        support: "Support resources are available",
      },
    },
    offline: {
      title: "Offline mode",
      body: (unsynced: number) =>
        unsynced === 0
          ? "You’re offline. New reflections will be saved on this device."
          : unsynced === 1
            ? "You’re offline. 1 reflection is saved and will be prepared when you reconnect."
            : `You’re offline. ${unsynced} reflections are saved and will be prepared when you reconnect.`,
    },
    // What "Review" on a refused reflection offers (one ConfirmDialog with two steps).
    review: {
      title: "We couldn’t finish this one",
      edit: "Edit and resend",
      deleteAction: "Delete",
      close: "Close",
      delete: {
        title: "Delete this reflection?",
        bodyText: "It will be deleted from this phone.",
        bodyAudio: "The recording will be deleted from this phone.",
        confirm: "Delete",
        cancel: "Keep",
      },
    },
    // The calm line New Entry leaves on Journal after it saved something that has not been prepared yet. It stays until
    // it is dismissed or the list is refreshed, never on a timer.
    notes: {
      offline: "Saved. We’ll prepare your reflection when you’re back online.",
      retry: "Saved. We’ll finish your reflection as soon as we can.",
    },
    // A text link under either note: the reflection has not been screened yet (offline, or the service had no answer),
    // so a way to reach someone stays one tap away. It opens Support Resources, which works offline (step 25 follow-up).
    noteSupport: "Support resources",
    synced: "All reflections synced",
    empty: {
      title: "No reflections yet",
      body: "Tap the mic to voice your heart, or the pen to write.",
      action: "Record your first prayer",
    },
    filteredEmpty: {
      message: "No reflections match this filter.",
      clear: "Clear filter",
    },
    loading: "Loading your reflections",
    // The small spinner under the last card while older reflections come.
    loadingMore: "Loading more reflections",
    error: {
      message: "We couldn’t load your reflections.",
      retry: "Try again",
    },
  },
  newEntry: {
    header: {
      title: "New Reflection",
      private: "Private",
    },
    modes: {
      label: "Reflection mode",
      speak: "Speak",
      write: "Write",
    },
    speak: {
      eyebrow: "Sanctuary of voice",
      title: "What’s on your heart today?",
      helper: "Take a breath. Speak freely — there is no wrong way to pray.",
      // The caption under the orb follows the state. After a recording it says how long it was (`recorded`).
      captionIdle: "Tap to begin",
      captionRecording: "Tap to stop",
      captionPaused: "Tap to resume",
      recorded: (time: string) => `Recorded ${time}`,
      recordAgain: "Record again",
      start: "Start recording",
      stopLabel: (spoken: string) => `Stop recording, ${spoken} recorded`,
      resumeLabel: (spoken: string) => `Resume recording, ${spoken} recorded`,
      started: "Recording started",
      stopped: (spoken: string) => `Recording stopped, ${spoken} recorded`,
      timerLabel: (elapsed: string, total: string) => `${elapsed} of ${total}`,
      // Said when the app was left, or a call or Siri took the microphone, while recording. The take is kept.
      paused: "Recording paused while you were away.",
      warning: "30 seconds left",
      limit: "Your 5 minutes are up. You can finish your reflection now.",
      errors: {
        start: "We couldn’t start recording. Please try again.",
        save: "We couldn’t save that recording. Please try again.",
        resume: "We couldn’t resume recording. You can finish what you have.",
      },
      denied: {
        title: "Microphone access is off",
        body: "Turn it on in Settings to pray out loud, or switch to Write.",
        settings: "Open Settings",
        writeInstead: "Write instead",
      },
      info: {
        title: "Whisper or speak aloud",
        body: "Gracehush listens for what you’re carrying and shapes a short devotional and scripture just for you.",
      },
    },
    write: {
      title: "Pour out your heart",
      helper: "Written prayers hold the quiet weight of honest thoughts.",
      // Not "Pour out your heart…": the title above the field already says it.
      placeholder: "Type freely. Share your worries, praises or questions, without judgment.",
      inputLabel: "Your reflection",
      words: (count: number) => (count === 1 ? "1 word" : `${count} words`),
      limit: (count: number, max: number) =>
        `${count.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`,
    },
    footer: {
      cancel: "Cancel",
      finish: "Finish Reflection",
      submit: "Submit Reflection",
    },
    discard: {
      title: "Discard this reflection?",
      body: "What you’ve recorded or written will be deleted.",
      confirm: "Discard",
      cancel: "Keep editing",
    },
    discardRecording: {
      title: "Discard this recording?",
      body: "It will be deleted, and you can record again.",
      confirm: "Discard",
      cancel: "Keep recording",
    },
    processing: {
      titleAudio: "Listening, praying, and finding scripture…",
      titleText: "Reading, praying, and finding scripture…",
      subtitle: "Gathering your thoughts into a contemplative benediction.",
      steps: {
        receiveAudio: { title: "Listening", description: "Your words are held in stillness." },
        receiveText: { title: "Reading", description: "Your words are held in stillness." },
        reflect: {
          title: "Reflecting",
          description: "Discerning the themes in what’s on your heart.",
        },
        prepare: {
          title: "Preparing your devotional",
          description: "A short devotional and a verse chosen for you.",
        },
      },
      // The upcoming step shows no label, so "Up next" is only ever spoken.
      status: { done: "Done", active: "In progress", upcoming: "Up next" },
      stepLabel: (title: string, status: string, description: string) =>
        `${title}, ${status.toLowerCase()}. ${description}`,
      announce: {
        receivingAudio: "Listening to your reflection.",
        receivingText: "Reading your reflection.",
        reflecting: "Reflecting on what you shared.",
        preparing: "Preparing your devotional.",
      },
      // The reflection is in the outbox before this screen shows. The app prepares it while it is open (never in the
      // background), so this does not promise more than that.
      note: "Your reflection is saved on this phone. If you leave this screen, it will finish in your Journal.",
      close: "Close",
      // The two ways the overlay can fail now: the phone could not save the reflection, or the server refused it for a
      // reason only the person can fix. Anything else is saved and retried by itself, with no error shown.
      failures: {
        save: {
          title: "We couldn’t save this reflection.",
          body: "Your words are still on this screen. Please try again.",
          primary: "Try again",
          secondary: "Keep editing",
        },
        refused: {
          title: "We couldn’t finish this reflection.",
          editText: "Edit",
          recordAgain: "Record again",
          close: "Close",
        },
      },
    },
  },
  // Why a refused reflection could not be prepared, for New Entry's overlay and for Journal's "Review".
  problems: {
    reason: (code: string | null) => {
      switch (code) {
        case "TOO_SHORT":
          return "That reflection was too short to prepare. You can add a little more.";
        case "NO_SPEECH":
          return "We couldn’t hear anything in that recording. You can record it again.";
        case "PAYLOAD_TOO_LARGE":
          return "That reflection is too large to send. You can shorten it or record a shorter one.";
        default:
          return "Something about this reflection can’t be prepared. You can edit it, record it again or delete it.";
      }
    },
  },
  reflection: {
    back: "Go back",
    // By dominant emotion. An emotion the app does not know gets `unknown`: the raw AI string is never shown.
    headlines: {
      anxious: "It sounds like you’re feeling anxious, and that’s okay.",
      weary: "It sounds like you’re feeling weary, and that’s okay.",
      grieving: "It sounds like you’re grieving, and that’s okay.",
      grateful: "It sounds like your heart is full of gratitude today.",
      hopeful: "It sounds like hope is stirring in you today.",
      unknown: "It sounds like you’re carrying a lot right now, and that’s okay.",
    },
    subline: {
      audio: "A sanctuary moment curated from your voice journal.",
      text: "A sanctuary moment curated from your written journal.",
    },
    player: {
      subtitle: (minutes: number) => `${minutes} min • Personalized devotional`,
      noAudio: "Your devotional is ready to read below.",
      play: (title: string) => `Play devotional, ${title}`,
      pause: "Pause devotional",
      open: "Open full player",
      openLink: "Tap to open player",
      // The spoken time: "34 seconds of 1 minute 15 seconds".
      position: (elapsed: string, total: string) => `${elapsed} of ${total}`,
      // Shown in place of the length when the audio could not be had.
      errors: playbackErrors,
    },
    scripture: {
      translation: "Berean Standard Bible",
      confirming: "We’re confirming this passage.",
      a11y: (reference: string, body: string) => `${reference}, Berean Standard Bible. ${body}`,
    },
    // Curly quotes. `quote` is for the user's own words: a verse goes through quoteVerse (utils/format),
    // which keeps the quote marks the verse already has. The stored closing prayer has no "Amen", so it
    // is added here.
    quote: (text: string) => `“${text}”`,
    closingPrayer: (prayer: string) => `“${prayer} Amen.”`,
    tabs: {
      label: "Reflection sections",
      devotional: "Devotional",
      affirmations: "Affirmations",
      prayer: "Closing Prayer",
    },
    affirmations: {
      eyebrow: (slotName: string, time: string) => `${slotName} • ${time}`,
      rowLabel: (slotName: string, time: string, isCurrent: boolean, headline: string, text: string) =>
        `${slotName}, ${time}${isCurrent ? ", current" : ""}. ${headline}. ${text}`,
      empty: "No affirmations were created for this reflection.",
    },
    words: {
      titleAudio: "Your spoken prayer",
      titleText: "Your written prayer",
      private: "Private to you",
      label: (title: string) => `${title}, private to you`,
    },
    request: {
      title: "Mark as Prayer Request",
      helper: "Keep it in your Prayers to return to.",
      // Turning it off on an answered prayer asks first (step 29).
      remove: {
        title: "Remove this from Prayers?",
        body: "Its answered date and gratitude note will be removed.",
        confirm: "Remove",
        cancel: "Keep",
      },
    },
    footer: {
      returnToJournal: "Return to Journal",
      share: "Share scripture",
    },
    // Only the verse and its reference: never the transcript, the emotion or the devotional. The verse
    // arrives already in quotes (quoteVerse).
    share: {
      message: (quotedVerse: string, reference: string) =>
        `${quotedVerse}\n— ${reference} (BSB)\n\nShared from Gracehush`,
    },
    states: {
      loading: "Loading your reflection",
      preparing: {
        title: "Your devotional is still being prepared.",
        body: "It will be waiting in your Journal when it’s ready.",
      },
      failed: {
        title: "We couldn’t finish this reflection.",
        // A failed entry is not listed in the real Journal, and the phone has no copy of its words to send again: the
        // person records or writes it again.
        body: "Your words are safe. Please record or write this reflection again.",
      },
      notFound: "This reflection couldn’t be found.",
      error: {
        message: "We couldn’t load this reflection.",
        retry: "Try again",
      },
    },
  },
  // The Reflection crisis view and Support Resources (step 13). No number and no URL in here: they are in
  // constants/crisisResources.ts. Never a claim about confidentiality, cost or what a service will do.
  crisis: {
    // The design’s words (AGENTS.md Crisis Safety Rules).
    title:
      "It sounds like you’re going through something really heavy. You don’t have to carry this alone.",
    body: "You can reach a trained counselor any time, day or night.",
    talkNow: "Talk to someone now",
    talkNowHint: "Calls the 988 Suicide and Crisis Lifeline",
    moreWays: "More ways to get help",
    listLabel: "Ways to reach someone",
    note: {
      eyebrow: "About this reflection",
      body: "We’ve paused the devotional and affirmations for this entry so you can focus on getting support. Reaching out for help is not a lack of faith. God often meets us through the people around us.",
    },
    words: "What you shared",
    resources: {
      title: "Support Resources",
      close: "Close support resources",
      intro: "Ways to reach a real person, any time of day.",
      footer: (date: string) =>
        `Gracehush is not a crisis service. Resources last checked ${date}. Message and data rates may apply when you text.`,
    },
    // Shown when the phone cannot open a link (no phone app, no messaging app).
    fallback: {
      title: "Your phone couldn’t open this.",
      call: "Dial this number from your phone app.",
      text: "Send a text to this number from your messaging app.",
      textWithBody: (body: string) => `Send “${body}” to this number from your messaging app.`,
      web: "Open this address in your browser.",
      close: "Close",
    },
  },
  ambient: {
    // The one label map for the ambient choices: Now Playing, and Profile (step 15). The chip that turns
    // the sound off reads "Off" everywhere.
    labels: {
      off: "Off",
      "soft-rain": "Soft Rain",
      "gentle-piano": "Gentle Piano",
      "morning-birds": "Morning Birds",
    } satisfies Record<AmbientSound, string>,
  },
  nowPlaying: {
    close: "Close",
    closeLabel: "Close player",
    play: "Play devotional",
    pause: "Pause devotional",
    replay: "Play again",
    back: (seconds: number) => `Back ${seconds} seconds`,
    forward: (seconds: number) => `Forward ${seconds} seconds`,
    scrubber: "Playback position",
    rate: {
      text: (rate: PlaybackRate) => `${rate}x`,
      label: (rate: PlaybackRate) => (rate === 1 ? "Normal speed" : `Speed ${rate} times`),
    },
    ambientTitle: "Ambient Soundscape",
    ambientChip: (label: string) => `Ambient sound, ${label}`,
    volume: {
      short: (percent: number) => `Vol ${percent}%`,
      label: "Ambient volume",
      text: (percent: number) => `${percent} percent`,
    },
    // The title's second line, and what step 26 puts on the lock screen: one string, one source.
    subtitle: (reference: string | null) => (reference ? `Gracehush • ${reference}` : "Gracehush"),
    states: {
      loading: "Loading the player",
      notFound: "We couldn’t find this devotional.",
      unavailable: "This devotional’s audio isn’t ready yet.",
      error: {
        message: "We couldn’t load this devotional.",
        retry: "Try again",
      },
      close: "Close",
    },
    // True now that the audio is real: the player keeps playing when this screen closes, and in the background.
    footer: "Audio keeps playing when you close this screen.",
    // Under the controls when the audio could not be had.
    errors: playbackErrors,
  },
  prayers: {
    title: "Sanctuary Prayers",
    // Sentence case: the eyebrow style uppercases it.
    recorded: (count: number) => (count === 1 ? "1 petition recorded" : `${count} petitions recorded`),
    tabs: {
      label: "Prayer lists",
      active: "Active",
      answered: "Answered",
      // The spoken label of a tab carries its count.
      activeA11y: (count: number) => (count === 1 ? "Active, 1 prayer" : `Active, ${count} prayers`),
      answeredA11y: (count: number) =>
        count === 1 ? "Answered, 1 prayer" : `Answered, ${count} prayers`,
    },
    loading: "Loading your prayers",
    error: {
      message: "We couldn’t load your prayers.",
      retry: "Try again",
    },
    empty: {
      active: {
        title: "No open prayers right now.",
        body: "When you pray about something, you can keep it here and watch for God’s answer.",
      },
      answered: {
        title: "Answered prayers will gather here.",
        body: "When a prayer is answered, mark it so you can remember His faithfulness.",
      },
    },
    banner: {
      lead: "Look how faithful He has been — ",
      count: (count: number) => (count === 1 ? "1 answered prayer." : `${count} answered prayers.`),
      caption: "Recorded in your sanctuary journey",
    },
    // The banner under the tabs. It stays until the next tab change or refresh: it never dismisses on a timer. `failed` is also
    // what Prayers and Reflection say when the server refused a change for good (step 29).
    notice: {
      marked: "Marked as answered.",
      view: "View in Answered",
      // Remove from Prayers and Delete reflection… (step 29b).
      removed: "Removed from Prayers. It’s still in your Journal.",
      deleted: "Reflection deleted.",
      failed: "We couldn’t save that change.",
    },
    // Under the title while the phone is offline and changes wait to be sent (step 29).
    offlinePending: "Changes will sync when you’re back online.",
    card: {
      untitled: (date: string) => `Prayer from ${date}`,
      days: (days: number) => (days <= 0 ? "Today" : days === 1 ? "1 day" : `${days} days`),
      markAnswered: "Mark Answered",
      markAnsweredLabel: (title: string) => `Mark answered, ${title}`,
      openHint: "Opens the reflection",
      answered: "Answered",
      answeredOn: (date: string) => `Answered on ${date}`,
      afterDays: (days: number) =>
        days <= 0 ? "The same day" : days === 1 ? "After 1 day" : `After ${days} days`,
      // Curly quotes around the user's own words (not a verse: that goes through quoteVerse).
      note: (text: string) => `“${text}”`,
      addNote: "Add a gratitude note",
      addNoteLabel: (title: string) => `Add a gratitude note, ${title}`,
      more: (title: string) => `More options, ${title}`,
      // One spoken summary for a card: the parts it shows, in reading order, without the empty ones, each
      // ending in a full stop (a part that already ends in one, such as a quoted note, keeps its own).
      a11y: (parts: (string | null)[]) =>
        parts
          .filter((part): part is string => Boolean(part))
          .map((part) => (/[.!?”]$/.test(part) ? part : `${part}.`))
          .join(" "),
    },
    menu: {
      editNote: "Edit gratitude note",
      moveBack: "Move back to Active",
      removeFromPrayers: "Remove from Prayers",
      deleteReflection: "Delete reflection…",
    },
    // Asked for an answered prayer only (step 29b): its answered date and gratitude note go with it. An Active prayer loses only its
    // flag, so it is removed at once.
    removeFromPrayers: {
      title: "Remove this from Prayers?",
      body: "Its answered date and gratitude note will be removed. The reflection stays in your Journal.",
      confirm: "Remove",
      cancel: "Keep",
    },
    moveBack: {
      title: "Move this prayer back to Active?",
      body: "Its answered date and note will be removed.",
      confirm: "Move back",
      cancel: "Keep as answered",
    },
    sheet: {
      eyebrow: "Testimony of grace",
      markTitle: "How was this prayer answered?",
      noteTitle: "Your gratitude note",
      dateLabel: "Date answered",
      dateA11y: (date: string, relative: string | null) =>
        `Date answered, ${date}${relative ? `, ${relative}` : ""}`,
      dateHint: "Opens a date picker",
      noteLabel: "Note of gratitude (optional)",
      noteA11y: "Note of gratitude",
      notePlaceholder:
        "Write a note of gratitude… How did you see God’s faithfulness in this situation?",
      counter: (count: number, max: number) =>
        `${count.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`,
      save: "Save Answered Prayer",
      saveNote: "Save note",
      notYet: "Not yet — keep in active prayers",
      cancel: "Cancel",
    },
    discard: {
      title: "Discard this note?",
      body: "What you’ve written won’t be saved.",
      confirm: "Discard",
      cancel: "Keep writing",
    },
    // Why a change did not go through. The sheet picks one by the result's code, and the repository
    // carries the same words.
    errors: {
      save: "We couldn’t save this. Please try again.",
      date: "Choose a day between when you prayed and today.",
    },
  },
  // Delete a reflection for good (step 29b), from Prayers and from Reflection. The dialog is shared; `offline` is the calm line
  // when there is no connection (a delete is online only), `link` the quiet button at the end of a reflection.
  deleteReflection: {
    title: "Delete this reflection forever?",
    body: "This permanently deletes the reflection, its devotional audio, its affirmations and any recording. This can’t be undone.",
    bodyAnswered:
      "This permanently deletes the reflection, its devotional audio, its affirmations, any recording and your gratitude note. This can’t be undone.",
    confirm: "Delete forever",
    cancel: "Keep",
    failed: "We couldn’t delete this reflection. Please try again.",
    offline: "Connect to the internet to delete a reflection.",
    link: "Delete reflection",
    linkLabel: "Delete this reflection",
    linkHint: "Asks before deleting",
  },
  // Profile & Settings (step 15). Row titles are Title Case as in the design, subtitles and dialog buttons are
  // sentence case, and the group labels are stored in sentence case (the eyebrow style uppercases them).
  profile: {
    loading: "Loading your profile",
    account: {
      friend: "Friend",
      memberSince: (date: string) => `Member since ${date}`,
    },
    plan: {
      freeTitle: "Gracehush Free",
      proTitle: "Gracehush Pro",
      badgeActive: "Active plan",
      badgeTrial: "Free trial",
      usage: (used: number, limit: number) => `${used} of ${limit} audio devotionals used this week`,
      resets: (weekday: string) => `Resets ${weekday}`,
      unlimited: "Unlimited audio devotionals.",
      upsell: {
        chip: "Premium",
        body: "Unlimited audio devotionals, whenever you need them.",
        // The button says "Upgrade to Pro" when the store would not offer this user a free trial (isTrialEligible).
        actionTrial: "Start free trial",
        actionUpgrade: "Upgrade to Pro",
      },
      manage: "Manage subscription",
      restore: "Restore purchases",
      restored: "Your purchase is restored.",
      restoreNone: "We didn’t find a previous purchase for this account.",
      restoreError: "We couldn’t restore your purchases. Please try again.",
    },
    groups: {
      preferences: "Preferences",
      notifications: "Notifications & storage",
      privacy: "Privacy & account",
      about: "About",
    },
    // "Daily Reminders, Morning 8:00 AM • Afternoon 1:00 PM • Evening 8:00 PM". The caller formats the times.
    rowLabel: (title: string, summary: string) => `${title}, ${summary}`,
    reminders: {
      title: "Daily Reminders",
      // The space before AM or PM is a non-breaking one, so a long summary wraps between times and never
      // leaves "3:00" and "PM" on two lines.
      summary: (times: { name: string; time: string }[]) =>
        times.map(({ name, time }) => `${name} ${time.replace(" ", " ")}`).join(" • "),
      // The bullets are read aloud as "bullet", so the spoken label uses commas.
      spoken: (times: { name: string; time: string }[]) =>
        times.map(({ name, time }) => `${name} ${time}`).join(", "),
      timezone: (zone: string) => `Times use your phone’s time zone (${zone}).`,
      showHint: "Shows the times",
      hideHint: "Hides the times",
    },
    ambient: {
      title: "Ambient Soundscape",
      // The volume is left out while the sound is off (percent is null): "Soft Rain, 50% volume" or "Off".
      summary: (label: string, percent: number | null) =>
        percent === null ? label : `${label}, ${percent}% volume`,
      helper: "This is the sound your next devotional starts with.",
      showHint: "Shows the sounds",
      hideHint: "Hides the sounds",
      // The preview (step 27): a few seconds of the chosen sound, while no devotional is playing.
      preview: "Preview",
      previewLabel: (label: string) => `Preview ${label}`,
      stop: "Stop",
      stopLabel: "Stop the preview",
      previewBlocked: "Pause your devotional to preview.",
    },
    affirmations: {
      title: "Daily Affirmations",
      subtitle: "A notification at each reminder time.",
    },
    notifications: {
      deniedTitle: "Notifications are off for Gracehush.",
      deniedBody: "Turn them on in Settings to receive your affirmations.",
      openSettings: "Open Settings",
      undeterminedTitle: "Allow notifications to receive your affirmations.",
      allow: "Allow notifications",
    },
    sync: {
      title: "Offline Reflections",
      status: (synced: number, pending: number) => `${synced} synced, ${pending} pending`,
      label: (synced: number, pending: number) =>
        `Offline Reflections, ${synced} synced, ${pending} pending`,
    },
    privacy: {
      exportTitle: "Export Journal",
      exportSubtitle: "Download a copy of your entries and prayers.",
      deleteTitle: "Delete Account",
      deleteSubtitle: "Permanently remove your account and data.",
      // TEMP(31): "Your export is ready." and a Download button
      exportRequested: "Export requested.",
    },
    about: {
      support: "Support & Helpline Resources",
      help: "Help & Feedback",
      helpHint: "Opens your email app",
      privacyPolicy: "Privacy Policy",
      terms: "Terms of Use",
      pageHint: "Opens in a browser",
      signOut: "Sign Out",
    },
    // One ConfirmDialog serves all of these (the delete one in two steps), so each is a set of strings.
    dialogs: {
      signOut: {
        title: "Sign out of Gracehush?",
        body: "Your journal stays safe in your account.",
        confirm: "Sign out",
        cancel: "Stay",
      },
      // The same dialog when this phone holds what the server has not been given yet: reflections, which signing out deletes
      // from the phone, or prayer changes, counted by prayer because the changes to one prayer go as one (step 29 follow-up).
      signOutUnsent: {
        body: (reflections: number, prayers: number) => {
          if (prayers === 0) {
            return reflections === 1
              ? "1 reflection on this phone hasn’t been sent yet. If you sign out, it will be deleted from this phone."
              : `${reflections} reflections on this phone haven’t been sent yet. If you sign out, they’ll be deleted from this phone.`;
          }
          if (reflections === 0) {
            return prayers === 1
              ? "Changes to 1 prayer on this phone haven’t been sent yet. If you sign out, they won’t be saved."
              : `Changes to ${prayers} prayers on this phone haven’t been sent yet. If you sign out, they won’t be saved.`;
          }
          const reflectionCount = reflections === 1 ? "1 reflection" : `${reflections} reflections`;
          const prayerChanges = prayers === 1 ? "changes to 1 prayer" : `changes to ${prayers} prayers`;
          return `${reflectionCount} and ${prayerChanges} on this phone haven’t been sent yet. If you sign out, they won’t be saved.`;
        },
        confirm: "Sign out anyway",
        cancel: "Stay signed in",
      },
      export: {
        // TODO(31): true once step 31 builds the download link
        title: "Export your journal?",
        body: "We’ll prepare a copy of your entries, prayers and affirmations. You’ll get a link to download it.",
        confirm: "Prepare export",
        cancel: "Not now",
      },
      deleteFirst: {
        title: "Delete your account?",
        body: "This permanently deletes your journal entries, recordings, devotionals, prayers and affirmations. This can’t be undone.",
        confirm: "Continue",
        cancel: "Keep my account",
        exportFirst: "Export my journal first",
        subscriptionWarning:
          "Deleting your account doesn’t cancel your subscription. Cancel it in your App Store or Google Play settings first.",
      },
      deleteFinal: {
        title: "Are you sure?",
        body: "Your sanctuary and everything in it will be removed.",
        confirm: "Delete forever",
        cancel: "Keep my account",
      },
    },
    footer: {
      // With no version (a build that does not report one) the line is only the scripture credit.
      line: (version: string | null) =>
        version
          ? `Gracehush v${version} • Scripture quotes from Berean Standard Bible (BSB).`
          : "Scripture quotes from Berean Standard Bible (BSB).",
      blessing: "Peace be with your spirit.",
    },
    errors: {
      load: "We couldn’t load your profile.",
      retry: "Try again",
      save: "We couldn’t save that change.",
      export: "We couldn’t prepare your export. Please try again.",
      delete: "We couldn’t delete your account. Please try again.",
      signOut: "We couldn’t sign you out. Please try again.",
      link: "We couldn’t open that page.",
      email: (address: string) =>
        `We couldn’t open your email app. You can write to us at ${address}.`,
      subscription: "We couldn’t open your subscription settings.",
    },
  },
  // The Paywall (step 16). Every price, percentage, trial length and count is built from the offering or from a
  // helper (utils/pricing.ts), never typed here. Nothing on it claims what the app cannot keep: cancelling happens
  // in the App Store or Google Play, and a failed purchase points to Restore purchases.
  paywall: {
    loading: "Loading plans",
    restore: "Restore purchases",
    hero: {
      title: "Go deeper with Gracehush Pro",
      subtitle: "A calm, unhurried space for your daily walk with God.",
    },
    // One row per feature that AGENTS.md defines as Pro (Subscription Rules). V1 has one. To advertise another,
    // first make it a real gate there, then add its row here.
    features: [
      {
        title: "Unlimited audio devotionals",
        helper: (freePerWeek: number) => `Free plans include ${freePerWeek} a week.`,
      },
    ],
    // The banner above the hero when the free limit sent the user here.
    limit: {
      used: (limit: number) =>
        limit === 1
          ? "You’ve used your free devotional this week."
          : `You’ve used your ${limit} free devotionals this week.`,
      resets: (weekday: string) => `They reset ${weekday}.`,
      saved: "Your reflection is saved.",
    },
    plan: {
      groupLabel: "Plans",
      title: { annual: "Yearly Access", monthly: "Monthly Access" },
      // Under the price: "$59.99" over "/ year".
      perPeriod: (period: string) => `/ ${period}`,
      perMonth: (price: string) => `${price} / month, billed yearly`,
      billedMonthly: "Billed monthly.",
      save: (percent: number) => `Save ${percent}%`,
      trialFree: (days: number) => `${daysLabel(days)} free`,
      // Spoken: "per", not a slash. The state is left out, because the platform speaks "radio button" and
      // "checked" or "unchecked" itself.
      a11y: (title: string, price: string, period: string, trialDays: number | null) =>
        `${title}, ${price} per ${period}${trialDays === null ? "" : `, ${daysLabel(trialDays)} free`}`,
    },
    cta: {
      trial: (days: number) => `Start ${days}-day free trial`,
      subscribe: (priceString: string, period: string) => `Subscribe for ${priceString}/${period}`,
    },
    // `price` and `period` are the billing price and period, not the trial: the trial is `days`. The exact wording
    // is a store-review matter (Apple 3.1.2, Google's subscription policy): check it before a release.
    disclosure: {
      trialIos: (days: number, price: string, period: string) =>
        `Free for ${daysLabel(days)}, then ${price} per ${period}. Renews automatically until canceled. To avoid being charged, cancel at least 24 hours before the trial ends in your App Store settings.`,
      trialAndroid: (days: number, price: string, period: string) =>
        `Free for ${daysLabel(days)}, then ${price} per ${period}. Renews automatically until canceled. To avoid being charged, cancel in Google Play before the trial ends.`,
      paidIos: (price: string, period: string) =>
        `${price} per ${period}. Renews automatically until canceled. Cancel at least 24 hours before it renews in your App Store settings.`,
      paidAndroid: (price: string, period: string) =>
        `${price} per ${period}. Renews automatically until canceled. Cancel anytime in Google Play.`,
    },
    legal: {
      terms: "Terms of Use",
      privacy: "Privacy Policy",
      separator: "•",
      openError: "We couldn’t open that page.",
    },
    later: "Maybe later",
    done: {
      title: "Welcome to Gracehush Pro.",
      body: "Your devotionals are unlimited.",
      bodyTrial: "Your free trial has started. Your devotionals are unlimited.",
      action: "Continue",
    },
    member: {
      title: "You’re already a Pro member.",
      bodyTrial: "Your free trial is active.",
      bodyPro: "Thank you for being part of Gracehush.",
      manage: "Manage subscription",
      manageError: "We couldn’t open your subscription settings.",
      close: "Close",
    },
    unavailable: {
      title: "Plans aren’t available right now.",
      body: "Please check your connection and try again.",
      retry: "Try again",
      close: "Close",
    },
    // Lines under the button. Each stays until the next action, never on a timer. A cancelled purchase has none.
    notices: {
      // True in a native build: the customer-info listener and the plan watch pick the approval up (step 30). Expo Go's Test
      // Store has no pending purchases.
      pending: "Your purchase is pending approval. We’ll unlock Pro as soon as it’s confirmed.",
      error:
        "We couldn’t complete your purchase. Please try again. If you think you were charged, choose Restore purchases.",
      notAllowed: "Purchases are turned off on this device.",
      restoreNone: "We didn’t find a previous purchase for this account.",
      restoreError: "We couldn’t restore your purchases. Please try again.",
    },
    days: daysLabel,
  },
};
