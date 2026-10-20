import type { AmbientSound, PlaybackRate, TimeSlot } from "@/types";

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
    error: {
      message: "We couldn’t load your reflections.",
      retry: "Try again",
    },
  },
  newEntry: {
    header: {
      title: "New Reflection",
      // TODO(24): reflect real local save
      saved: "Saved locally",
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
      recorded: (time: string) => `Recorded ${time}`,
      recordAgain: "Record again",
      start: "Start recording",
      stopLabel: (spoken: string) => `Stop recording, ${spoken} recorded`,
      started: "Recording started",
      stopped: (spoken: string) => `Recording stopped, ${spoken} recorded`,
      timerLabel: (elapsed: string, total: string) => `${elapsed} of ${total}`,
      warning: "30 seconds left",
      limit: "Your 5 minutes are up. You can finish your reflection now.",
      errors: {
        start: "We couldn’t start recording. Please try again.",
        save: "We couldn’t save that recording. Please try again.",
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
      // TODO(25): "waiting in your Journal" is true once processing continues after the screen closes
      note: "You can close the app. Your reflection will be waiting in your Journal.",
      close: "Close",
      error: {
        title: "We couldn’t finish this reflection.",
        // TODO(24): "Your words are safe" is true once the entry is saved on the device before it is sent
        body: "Your words are safe. Try again, or save it and we’ll retry later.",
        retry: "Try again",
        saveAndClose: "Save and close",
      },
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
        // TODO(25): "waiting in your Journal" is true once processing continues after the screen closes
        body: "It will be waiting in your Journal when it’s ready.",
      },
      failed: {
        title: "We couldn’t finish this reflection.",
        // TODO(24): "Your words are safe" is true once the entry is saved on the device before it is sent
        // TODO(25): "try again from your journal" is true once a failed entry has a "Try again"
        body: "Your words are safe. You can try again from your journal.",
      },
      notFound: "This reflection couldn’t be found.",
      error: {
        message: "We couldn’t load this reflection.",
        retry: "Try again",
      },
    },
    // TEMP(13): replaced by CrisisSupportPanel
    crisis: {
      title:
        "It sounds like you’re going through something really heavy. You don’t have to carry this alone.",
      return: "Return to my journal",
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
    // Shown in development only: it is true only with real audio (the guard is in NowPlayingScreen).
    devFooter: "Audio keeps playing when you close this screen.",
  },
};
