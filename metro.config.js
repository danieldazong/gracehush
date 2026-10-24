const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = withNativewind(getDefaultConfig(__dirname));

// NativeWind resolves every `react-native` import to its own wrapper module, which re-exports the
// components with `className` support but not `AssetRegistry`. expo-asset 58.0.16 and later read
// `AssetRegistry` from `react-native`, so through the wrapper every `Asset.fromModule` call threw
// and no font loaded (found on SDK 58, 2026-10-24). expo-asset renders nothing, so it gets the real
// `react-native`. Remove once react-native-css forwards `AssetRegistry` (3.1.0-rc.0 does not).
const expoAssetDir = path.join(__dirname, "node_modules", "expo-asset") + path.sep;
const resolveWithNativewind = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native" && context.originModulePath.startsWith(expoAssetDir)) {
    return context.resolveRequest(context, moduleName, platform);
  }
  return resolveWithNativewind(context, moduleName, platform);
};

module.exports = config;
