import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Compress responses
  compress: true,

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
  },

  // Reduce build output noise, enable SWC minification (default in Next 15)
  poweredByHeader: false,

  // Native addons and ESM-only packages that must not be bundled by webpack.
  // @napi-rs/canvas: native .node binary for PDF page rendering
  // pdfjs-dist: ESM-only PDF parser (imported via .mjs path)
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],

  // Experimental: partial pre-rendering where possible
  experimental: {
    optimizePackageImports: ['@supabase/supabase-js', '@supabase/ssr'],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // Force the Claude playbook to be bundled with API route lambdas. Next.js
  // won't detect the `readFileSync` at build time, so we include it explicitly.
  outputFileTracingIncludes: {
    '/api/sms/webhook': ['./lib/claude-playbook.md'],
  },
}

export default nextConfig
