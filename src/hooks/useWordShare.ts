import { useEffect, useRef, useState } from "react";

import { openSystemShareFile } from "@/services/externalLinks";
import { canShareWordPicture, makeWordPicture } from "@/services/wordCardShare";
import type { WordPicture } from "@/utils/wordCardLayout";

// Sharing the Today tab's word card as a picture (2026-11-20): the card is drawn, saved and handed to the iPhone's share menu.
// `preparing` is true while the picture is being made, for the Share button's spinner. Where no picture can be made (Expo Go,
// Android) or the drawing fails, `fallback` runs instead: the screen then shares the verse as text, as it did before.
export function useWordShare() {
  const [preparing, setPreparing] = useState(false);
  // One picture at a time: a second press while one is being made does nothing.
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function share(picture: WordPicture, fallback: () => void): Promise<void> {
    if (busy.current) return;
    if (!canShareWordPicture()) {
      fallback();
      return;
    }
    busy.current = true;
    setPreparing(true);
    const uri = await makeWordPicture(picture);
    busy.current = false;
    // The screen has gone (a sign-out): nothing opens over whatever took its place.
    if (!mounted.current) return;
    setPreparing(false);
    if (uri === null) {
      fallback();
      return;
    }
    await openSystemShareFile(uri);
  }

  return { preparing, share };
}
