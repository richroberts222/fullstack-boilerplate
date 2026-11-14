import type { ExpoConfig } from "expo/config";

// Single source of truth for app identity (see /docs/mobile.md). The name, slug,
// scheme, and identifiers are boilerplate placeholders until the store
// identifiers are decided. Everything in this file ends up in the public app
// bundle: never read or embed secrets here. Environment values reach the app
// through EXPO_PUBLIC_* variables parsed in src/config/env.ts.
const config: ExpoConfig = {
  name: "App Boilerplate",
  slug: "app-boilerplate",
  scheme: "app-boilerplate",
  version: "0.0.0",
  platforms: ["ios", "android"],
  // File-based navigation (docs/mobile.md): screens live in the app/ folder.
  plugins: ["expo-router"],
  // No Expo account owner and no EAS project id yet: `eas init` writes the project id when the owner links
  // this app to its own Expo project (docs/new-app-setup.md). Never copy another application's values here.
  orientation: "portrait",
  userInterfaceStyle: "dark",
  // No app icon yet: add `icon` and the Android adaptive icon when the owner supplies artwork.
  ios: {
    bundleIdentifier: "com.example.appboilerplate",
    supportsTablet: true,
  },
  android: {
    package: "com.example.appboilerplate",
    adaptiveIcon: { backgroundColor: "#0f172a" },
  },
};

export default config;
