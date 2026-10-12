import type { Metadata, Viewport } from 'next';
import { Bitter, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { Footer } from '@/components/Footer';
import { Nav } from '@/components/Nav';
import { RevealObserver } from '@/components/RevealObserver';
import { SITE } from '@/lib/site';
import './globals.css';

const inter = Inter_Tight({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--font-inter-tight', display: 'swap' });
const bitter = Bitter({ subsets: ['latin'], weight: ['500', '700'], style: ['italic'], variable: '--font-bitter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: '%s · revers.si' },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE.url,
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    images: [{ url: '/brand/revers-630.jpg', width: 630, height: 630, alt: 'revers.si logo' }],
  },
  twitter: {
    card: 'summary',
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: SITE.title,
    description: SITE.description,
    images: ['/brand/revers-630.jpg'],
  },
};

export const viewport: Viewport = {
  themeColor: '#e1e6df',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bitter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
        <RevealObserver />
      </body>
    </html>
  );
}
