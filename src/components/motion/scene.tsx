// Scene · the composed-entrance primitive (prompt 01).
//
// A page or section loads as a *scene*: the background settles, the primary
// surface rises 12px and fades in, supporting elements follow at a 60ms
// stagger. Build once, use everywhere — consistency IS the cinema. CSS-only
// (via a per-item `--scene-order`), so it costs nothing and collapses to a
// plain fade under prefers-reduced-motion for free.
//
//   <Scene>
//     <SceneItem order={0}><Hero/></SceneItem>
//     <SceneItem order={1}><Strip/></SceneItem>
//   </Scene>
//
// For scroll-triggered sections, pass `onScroll` and drive `.in-view` with the
// useReveal hook (the item holds hidden until its section enters the viewport).

"use client";

import type { CSSProperties, ReactNode } from "react";

export function Scene({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function SceneItem({
  order = 0,
  children,
  className,
  style,
  /** Hold hidden until `inView` flips true (for scroll-scenes). */
  onScroll = false,
  inView = false,
}: {
  order?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onScroll?: boolean;
  inView?: boolean;
}) {
  return (
    <div
      className={[
        "scene-item",
        onScroll ? "on-scroll" : "",
        onScroll && inView ? "in-view" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--scene-order" as string]: order, ...style }}
    >
      {children}
    </div>
  );
}
