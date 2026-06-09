/**
 * next.config.mjs — Venture
 *
 * PWA NOTE: next-pwa and @ducanh2912/next-pwa both inject webpack config
 * which conflicts with Next.js 16's default Turbopack bundler.
 * The /public/manifest.json and meta tags are already in place for full PWA.
 * Service-worker (offline caching) can be added later via Serwist.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      // B1: old /new-trip URL used in some emails/links before the route was renamed
      { source: '/new-trip', destination: '/trips/new', permanent: true },
    ];
  },

  // Production: aggressive security + caching headers
  // Development: no-store so you always see the latest code
  async headers() {
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'Cache-Control', value: 'no-store, max-age=0' },
            { key: 'Pragma',        value: 'no-cache' },
          ],
        },
      ];
    }

    return [
      // Immutable static assets
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Icons & manifest — cache but allow revalidation
      {
        source: '/(icons|manifest.json)(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      // Security headers for all routes
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-XSS-Protection',       value: '1; mode=block' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
