// Tiny module of constants shared between signals.ts, vol-surface.ts,
// and the strategy module. Splitting them out avoids a cycle between
// signals.ts and vol-surface.ts when they reference each other.

export const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";

/** Everything in the Predict protocol is denominated in 1e9 units. */
export const PRICE_SCALAR = 1_000_000_000;
