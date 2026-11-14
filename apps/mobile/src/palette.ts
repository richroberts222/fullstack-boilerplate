// Color tokens for the phone app, named like the web's semantic tokens (docs/ui.md section 22) so a color
// means the same thing on both. Plain data with no React Native import, so a test can check contrast.
export const light = {
  background: "#ffffff",
  foreground: "#0f172a",
  card: "#f1f5f9",
  muted: "#475569",
  border: "#64748b",
  primary: "#1d4ed8",
  primaryForeground: "#ffffff",
  destructive: "#b91c1c",
};

export const dark = {
  background: "#0f172a",
  foreground: "#f8fafc",
  card: "#1e293b",
  muted: "#94a3b8",
  border: "#7c8ba1",
  primary: "#93c5fd",
  primaryForeground: "#0f172a",
  destructive: "#f87171",
};

export type Palette = typeof light;
