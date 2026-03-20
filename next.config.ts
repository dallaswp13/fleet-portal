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
  },
}

export default nextConfig
