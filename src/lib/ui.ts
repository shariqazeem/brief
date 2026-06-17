// Single source of truth for the semantic palette used in inline styles.
//
// Components render many colors dynamically (style={{ color: … }}), so the
// palette lives here as constants · mirroring the Tailwind tokens in
// tailwind.config.ts · instead of being re-declared (and drifting) per file.
// Tailwind classes (text-ink, bg-success, …) cover the className path; these
// cover the inline-style path. One palette, no drift.

// Neutrals (= Tailwind ink / ink-2 / muted / muted-2 / line tokens)
export const INK = "#0A0A0A";
export const SUB = "#525560";
export const MUTED = "#8E8E93";
export const FAINT = "#C7C7CC";
export const LINE = "#E5E5EA";
export const LINE_SUBTLE = "#F0F0F0";

/** Idle/pending grey · alias of MUTED so legacy usages stay one value. */
export const IDLE = MUTED;

// Brand (= Tailwind accent / sui)
export const NAVY = "#1a2c4e";
export const NAVY_HOVER = "#2c3e5f";
export const INFO = "#4DA2FF";
export const BLUE = INFO;

// Semantic · the operator's language
export const SUCCESS = "#10B981"; // act · win · healthy · capital protected
export const SUCCESS_DEEP = "#047857";
export const DANGER = "#EF4444"; // abort · loss · revoke
export const CAUTION = "#F59E0B"; // preserve · fuel-low · drawdown nearing

/** Legacy aliases · same values, kept so existing usages need no rename. */
export const EMERALD = SUCCESS;
export const RED = DANGER;
export const AMBER = CAUTION;
