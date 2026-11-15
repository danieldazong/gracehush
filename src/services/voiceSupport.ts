import { NativeModules } from "react-native";

// Whether this build can hold a live talk with Scholar (step 39): only when the WebRTC and LiveKit native modules are in it.
// Expo Go has neither, so the Talk button and the Profile rows never show there, and the ElevenLabs package (which registers
// WebRTC the moment it is imported) is never loaded: only the Talk screen imports it, and the navigator loads that screen's file
// only when the route opens.
export function voiceSupported(): boolean {
  const modules = NativeModules as Record<string, unknown>;
  return modules.WebRTCModule != null && modules.LivekitReactNativeModule != null;
}
