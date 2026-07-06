# Brief Design System — cinematic-institutional

The bar: when a judge screen-records any page, the recording alone looks like a
$100M product. Cinema comes from **choreography, depth, presence, restraint** —
never decoration. Idle screens are nearly still; motion spends its budget only
on moments that carry meaning.

Palette and typography are **locked** (`src/lib/ui.ts` + `tailwind.config.ts`):
INK `#0A0A0A`, NAVY `#1a2c4e`, SUI blue `#4DA2FF`, emerald/red/amber semantics,
`#FAFAFA` bg, white cards, Inter (cv02 cv11 ss01) + JetBrains Mono (uppercase
labels, tabular-nums). Additions only, never replace.

## Tokens (CSS variables, `src/app/globals.css`)

- **Depth** — `--elev-0` (hairline only), `--elev-1` (rest cards), `--elev-2`
  (hover / raised), `--elev-3` (the single most important surface per page).
- **Glass** — `--glass`, `--glass-border`, `--glass-blur`. Sticky headers, the
  Ask dock, and floating controls only.
- **Aura** — `--aura-thinking|acting|guarded|intervened|idle`. The operator's
  living tint; cross-fades over 1200ms.
- **Motion timing** — eases `--ease-out-expo` (entrances), `--ease-spring`
  (small affirmations), `--ease-base` (everything else). Durations `--dur-micro`
  180ms, `--dur-standard` 320ms, `--dur-scene` 700ms, `--dur-ceremony` 1400ms.
  Nothing between categories.
- **`.ink-navy-gradient`** — the one hero-headline gradient. At most one element
  per page.

## Primitives (`src/components/motion/`)

### `<Scene>` / `<SceneItem order={n}>` — composed entrance
Each `SceneItem` rises 12px + fades in on `--ease-out-expo`, staggered 60ms by
`order` (after a 120ms background beat). CSS-only. For scroll-triggered sections
pass `onScroll` + drive `inView` from `useReveal()` (`src/lib/use-scroll-reveal`)
so the item holds hidden until its section is 15% visible. Total scene ≤ 1100ms.

### `<OperatorPresence>` — the living operator
`glyph`, `state` (idle/thinking/acting/guarded/intervened), `live` (SSE health),
`size` (sm 44 / md 72 / lg 128), `accent`. Breathes (scale 1→1.015, 4s) only
when `live`; a conic sweep traces the perimeter while `thinking`; a spring pop on
`acting`; desaturates when guarded/intervened. Same organism on the landing hero,
operator cards, and detail header. The glyph is a placeholder for identity art.

### `<LiveValue>` — value-change choreography
Every money/stat/P&L figure goes through this. Counts up over 700ms on mount;
on change tweens 320ms with a 600ms color pulse (emerald up / red down). Pass
`format` for currency/percent, `countUp={false}` to skip the intro. rAF-based,
snaps under reduced motion. Never hard-re-render money.

## Global micro-interactions (in `globals.css`)

- `.cta-sheen` + inner `.cta-sheen-glint` — primary CTA sheen on hover only.
- `.evidence-underline` — the "verify me" underline draws left→right on hover
  (Suiscan / Walrus links).
- Scene sequences collapse to a plain visible state under
  `prefers-reduced-motion`; the global guard already zeroes durations.

## Rules

1. Animate only `transform`, `opacity`, `filter`, `clip-path`. Never layout.
   `will-change` only during animation. 60fps under 4x CPU throttle.
2. CSS-first. No motion library is used; scroll-scenes ride `IntersectionObserver`
   via `useReveal`. Add a library only if a genuine FLIP/shared-element case
   appears — none so far.
3. Never fabricate data to look alive. Real SSE beats, honest empty states.
4. Every animation respects `prefers-reduced-motion`.
