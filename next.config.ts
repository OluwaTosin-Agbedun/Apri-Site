import type { NextConfig } from 'next'

function papermarkFrameSources(): string {
  const sources = ["'self'", 'https://papermark.com', 'https://*.papermark.com', 'https://docs.athenacentre.org']
  const configured = process.env.PAPERMARK_CUSTOM_DOMAIN
  if (configured) {
    try {
      const url = new URL(configured.includes('://') ? configured : `https://${configured}`)
      if (url.protocol === 'https:' && !url.username && !url.password) sources.push(url.origin)
    } catch {
      // Invalid deployment configuration is ignored rather than injected into a header.
    }
  }
  return `frame-src ${sources.join(' ')};`
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif','image/webp'],
    qualities: [90],
    remotePatterns: [{protocol:'https',hostname:'*.public.blob.vercel-storage.com',pathname:'/team/**'}],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "4.4mb",
    },
  },

  async headers() {
    return [
      ...['/admin/:path*','/portal/:path*','/api/:path*','/review/library/:path*','/review/read/:path*','/review/verify','/review/access','/review/confirmed','/review/subscribe/:path*'].map(source=>({source,headers:[
        {key:'Cache-Control',value:'private, no-store, max-age=0'},
        {key:'X-Robots-Tag',value:'noindex, nofollow, nosnippet'},
      ]})),
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: papermarkFrameSources() },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default nextConfig
