import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  compress: true,

  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
  },

  poweredByHeader: false,

  experimental: {
    // Tree-shake heavy libraries when only a few exports are used.
    optimizePackageImports: [
      '@supabase/supabase-js',
      '@supabase/ssr',
      'xlsx',
      'fast-xml-parser',
      'twilio',
    ],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // Force the Claude playbook to be bundled with API route lambdas. Next.js
  // won't detect the readFileSync at build time, so we include it explicitly.
  outputFileTracingIncludes: {
    '/api/sms/webhook': ['./lib/claude-playbook.md'],
  },
}

export default nextConfig
