// Multi-asset market registry — one entry per asset the trader can bet on.
//
// Two execution venues exist:
//   - `predict`        — DeepBook Predict (binary up/down at expiry, dUSDC quote)
//   - `deepbook-spot`  — DeepBook v3 spot pool (directional buy/sell, USDC quote)
//
// Adding a new asset is a single entry here; the trader branches on `venue`
// and the UI reads the same metadata.

export type ExecutionVenue = "predict" | "deepbook-spot";

export type MarketSpec = {
  asset: string; // "BTC" | "SUI" | "WAL" | "DEEP" | …
  display: string; // e.g. "BTC" — what we show on the dashboard
  venue: ExecutionVenue;

  // Predict-specific
  predictPackage?: string;
  predictObject?: string;

  // DeepBook spot-specific
  spotPoolKey?: string;
  spotPoolId?: string;
  baseCoinType?: string;
  baseScalar?: number; // base coin smallest-unit per 1 unit (e.g. 1e9 for SUI)
  quoteCoinType?: string;
  quoteScalar?: number;
  /** Minimum base quantity per order (in human units, e.g. 1.0 SUI). */
  minOrderQty?: number;

  // Cross-venue
  /** Pyth feed id for USD pricing (used for narration + UI). */
  pythFeedId?: string;
};

const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const PREDICT_OBJECT =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";

export const DBUSDC_TYPE =
  "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC";

export const MARKETS: Record<string, MarketSpec> = {
  BTC: {
    asset: "BTC",
    display: "BTC",
    venue: "predict",
    predictPackage: PREDICT_PACKAGE,
    predictObject: PREDICT_OBJECT,
    pythFeedId:
      "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },
  SUI: {
    asset: "SUI",
    display: "SUI",
    venue: "deepbook-spot",
    spotPoolKey: "SUI_DBUSDC",
    spotPoolId:
      "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
    baseCoinType: "0x2::sui::SUI",
    baseScalar: 1_000_000_000,
    quoteCoinType: DBUSDC_TYPE,
    quoteScalar: 1_000_000,
    minOrderQty: 1.0,
    pythFeedId:
      "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  },
  WAL: {
    asset: "WAL",
    display: "WAL",
    venue: "deepbook-spot",
    spotPoolKey: "WAL_DBUSDC",
    spotPoolId:
      "0xeb524b6aea0ec4b494878582e0b78924208339d360b62aec4a8ecd4031520dbb",
    baseCoinType:
      "0x9ef7676a9f81937a52ae4b2af8d511a28a0b080477c0c2db40b0ab8882240d76::wal::WAL",
    baseScalar: 1_000_000_000,
    quoteCoinType: DBUSDC_TYPE,
    quoteScalar: 1_000_000,
    minOrderQty: 1.0,
  },
  DEEP: {
    asset: "DEEP",
    display: "DEEP",
    venue: "deepbook-spot",
    spotPoolKey: "DEEP_DBUSDC",
    spotPoolId:
      "0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622",
    baseCoinType:
      "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    baseScalar: 1_000_000,
    quoteCoinType: DBUSDC_TYPE,
    quoteScalar: 1_000_000,
    minOrderQty: 1.0,
  },
};

export function getMarket(asset: string): MarketSpec {
  const m = MARKETS[asset.toUpperCase()];
  if (!m) throw new Error(`unknown market asset: ${asset}`);
  return m;
}

/** Bundles users can pick when adopting a trader. */
export const MARKET_BUNDLES: Record<string, string[]> = {
  btc_only: ["BTC"],
  sui_ecosystem: ["SUI", "WAL", "DEEP"],
  all: ["BTC", "SUI", "WAL", "DEEP"],
};
