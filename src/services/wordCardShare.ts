import { Directory, File, Paths } from "expo-file-system";
import { Platform, TurboModuleRegistry } from "react-native";

import { type WordPicture, wordPictureFileName } from "@/utils/wordCardLayout";

// Sharing the Today tab's word card as a picture (2026-11-20). The picture is drawn by wordCardImage.ts, saved as one file in
// the cache folder and handed to the iPhone's share menu (services/externalLinks.ts). One picture is kept at a time: the next
// one replaces it, and sign-out deletes it. It holds a headline and a Bible verse, never a word the person wrote. Nothing
// here is sent anywhere, and nothing is logged but one development line when a picture could not be made.

// The pictures' folder, in the cache folder, which iOS may empty by itself.
const FOLDER = "share";

type ImageModule = typeof import("./wordCardImage");

function folder(): Directory {
  return new Directory(Paths.cache, FOLDER);
}

// A picture can be shared where it can be drawn and handed over: on an iPhone (the share menu takes a file there), in a build
// that has Skia (Expo Go has none). Everywhere else Share sends the verse as text, as before.
export function canShareWordPicture(): boolean {
  try {
    return Platform.OS === "ios" && TurboModuleRegistry.get("RNSkiaModule") !== null;
  } catch {
    return false;
  }
}

function failed(): null {
  if (__DEV__) console.warn("[share] the picture could not be made");
  return null;
}

// Removes the picture made for the last share. It never throws: a folder that is not there has nothing to remove.
export function deleteWordPictures(): void {
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch {
    // The cache folder could not be reached. iOS empties it by itself when it needs the room.
  }
}

// Draws the card and saves it. Answers the file's address, or null when no picture can be made here or the drawing failed:
// the caller then shares the verse as text. It never throws.
export async function makeWordPicture(picture: WordPicture): Promise<string | null> {
  if (!canShareWordPicture()) return null;
  try {
    // A lazy require keeps Skia out of a build that does not have it: its JavaScript needs the native module on load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderWordPicture } = require("./wordCardImage") as ImageModule;
    const base64 = await renderWordPicture(picture);
    if (base64 === null) return failed();
    deleteWordPictures();
    // A folder of its own for each picture, so the share menu never shows the one before it under the same address.
    const dir = new Directory(folder(), String(Date.now()));
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, wordPictureFileName(picture.reference));
    await file.write(base64, { encoding: "base64" });
    return file.uri;
  } catch {
    return failed();
  }
}
