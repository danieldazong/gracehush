import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateStorage } from "zustand/middleware";

function warn(message: string, detail: unknown) {
  if (__DEV__) {
    console.warn(`[safeStorage] ${message}`, detail);
  }
}

// zustand's persist never marks a store as hydrated when the storage read throws or the saved JSON is
// corrupt, so a splash gate would wait forever. Both become "nothing saved" here, and a failed write
// never turns into an unhandled rejection. Only the error is logged, never the saved content.
export const safeStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const value = await AsyncStorage.getItem(name);
      if (value !== null) {
        JSON.parse(value); // proves the text is valid JSON; the result is not used
      }
      return value;
    } catch (error) {
      // A JSON syntax error can quote the text it choked on, so it is reduced to its type.
      warn(`dropping unreadable "${name}"`, error instanceof SyntaxError ? "invalid JSON" : error);
      await AsyncStorage.removeItem(name).catch(() => undefined);
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch (error) {
      warn(`could not save "${name}"`, error);
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch (error) {
      warn(`could not remove "${name}"`, error);
    }
  },
};
