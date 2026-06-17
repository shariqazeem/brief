// Shared chart constants for the Mind canvas · every Recharts color
// maps to the Tailwind design tokens (tailwind.config.ts) so the
// charts read as native Brief surfaces, not a bolted-on library.

export const C = {
  ink: "#0A0A0A",
  ink2: "#525560",
  muted: "#8E8E93",
  muted2: "#C7C7CC",
  line: "#E5E5EA",
  lineSubtle: "#F0F0F0",
  accent: "#1a2c4e",
  sui: "#4DA2FF",
  up: "#047857", // emerald-700
  upSoft: "#A7F3D0", // emerald-200
  down: "#B91C1C", // red-700
  downSoft: "#FECACA", // red-200
} as const;

export const MONO_TICK = {
  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
  fontSize: 10,
  fill: C.muted,
} as const;

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtUsd(v: number, digits = 0): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
