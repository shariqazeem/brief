// App Router template — re-renders on every navigation, so it's the
// right place for a page-enter transition. We use an OPACITY-ONLY fade
// (`.page-enter` in globals.css): a transform here would turn this
// wrapper into a containing block and break the landing page's
// position:sticky scroll chapters + its fixed "Brief" watermark.
// Server component — adds no client boundary; children keep their own.

export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
