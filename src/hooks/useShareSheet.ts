import { useEffect, useState } from "react";

import { canOpenWhatsApp } from "@/services/externalLinks";

// GraceHush's share panel (2026-11-16): `text` is the message it shares, or null while it is closed; `whatsApp` is whether the
// phone has WhatsApp, asked once when the screen mounts, false until the phone answers, so the WhatsApp tile never shows on a
// phone without it.
export function useShareSheet() {
  const [text, setText] = useState<string | null>(null);
  const [whatsApp, setWhatsApp] = useState(false);

  useEffect(() => {
    let alive = true;
    void canOpenWhatsApp().then((value) => {
      if (alive) setWhatsApp(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    text,
    whatsApp,
    share: (message: string) => setText(message),
    close: () => setText(null),
  };
}
