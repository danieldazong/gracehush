import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

// Encryption of the words kept in the database (step 24). AES-256-GCM through expo-crypto's native AES (CryptoKit on iOS,
// javax.crypto on Android): it runs in Expo Go and in every build, and it adds no package. One random 256-bit key per
// signed-in user lives in the keychain or keystore, on this device only and while it is unlocked. It is never kept in the
// database, in a file, in a log or in an error message. A stored value is "v1." plus the base64 of nonce (12 bytes) +
// ciphertext + tag (16 bytes). The nonce is random for every value, and the tag makes a changed value fail to open instead
// of reading as something else.
//
// SQLCipher would encrypt the whole file, but expo-sqlite's own docs say it is unavailable in Expo Go (and it needs a native
// build that does not exist yet), so the words are encrypted here instead. The file's bookkeeping (ids, statuses, counts and
// times) is not.
const TOKEN_PREFIX = "v1.";

function keyName(hash: string): string {
  return `gracehush.dbkey.${hash}`;
}

let loaded: AESEncryptionKey | null = null;

// Loads this user's key. When there is none it makes one if `create` is set. False means there is no key.
export async function loadFieldKey(hash: string, create: boolean): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(keyName(hash));
  if (stored !== null) {
    loaded = await AESEncryptionKey.import(stored, "base64");
    return true;
  }
  if (!create) return false;
  const fresh = await AESEncryptionKey.generate(AESKeySize.AES256);
  await SecureStore.setItemAsync(keyName(hash), await fresh.encoded("base64"), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  loaded = fresh;
  return true;
}

// Forgets the key in memory (the database closed).
export function unloadFieldKey(): void {
  loaded = null;
}

// Removes the key from the keychain. A database file that is left behind can then never be read.
export async function deleteStoredFieldKey(hash: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(hash));
}

export async function encryptText(plain: string): Promise<string> {
  if (loaded === null) throw new Error("The database key is not loaded");
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plain), loaded);
  return TOKEN_PREFIX + (await sealed.combined("base64"));
}

// Null when the value cannot be read: it is not one of ours, it was changed, or it was made with another key. Never throws.
export async function decryptText(token: string): Promise<string | null> {
  if (loaded === null || !token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(token.slice(TOKEN_PREFIX.length)), loaded);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
