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
