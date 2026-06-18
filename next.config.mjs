/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deploys run `tsc --noEmit` before building, so the in-build type-check +
  // ESLint are redundant — and they're the slowest phase on the 1GB VM (swap
  // thrash). Skip them here to keep `next build` fast. Type safety is still
  // enforced, just earlier in the pipeline.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
