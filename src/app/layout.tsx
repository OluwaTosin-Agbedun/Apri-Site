import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import SiteAnalytics from '@/components/SiteAnalytics'
import { SITE_DESCRIPTION, SITE_NAME, publicOrganisationSchema, safeJsonLd } from '@/lib/seo'
import { siteOrigin } from '@/lib/site-config'

// Self-hosted at build time by next/font, so no runtime request to Google and
// no render-blocking stylesheet.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-playfair',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
  verification: { google: /^[A-Za-z0-9_-]{1,200}$/.test(process.env.GOOGLE_SITE_VERIFICATION ?? '') ? process.env.GOOGLE_SITE_VERIFICATION : undefined },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(publicOrganisationSchema())}} />
        {children}
        <SiteAnalytics />
      </body>
    </html>
  )
}
