// SkeletonCard · a white card with shimmering placeholder bars, for the
// brief moment before real data lands. Matches the app's flat, sharp-cornered
// card idiom (white bg, barely-there shadow) and uses the `animate-shimmer`
// utility added to globals.css.

export type SkeletonCardProps = {
  /** Number of shimmer bars to render (default 2). */
  lines?: number;
  className?: string;
};

export default function SkeletonCard({ lines = 2, className }: SkeletonCardProps) {
  const rows = Math.max(1, lines);
  return (
    <div
      className={`bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9 ${className ?? ""}`}
      aria-hidden
    >
      <div className="animate-shimmer h-3 w-1/3 rounded-sm" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="animate-shimmer h-3 rounded-sm"
            style={{ width: i === rows - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}
