import { Spectral, Hanken_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Analytics } from '@vercel/analytics/react';
import DevSwKiller from '@/components/DevSwKiller';
import SwRegister from '@/components/SwRegister';
import ToastProvider from '@/components/ToastProvider';
import TripModalProvider from '@/components/TripModalProvider';
import OfflineBanner from '@/components/OfflineBanner';

const hanken = Hanken_Grotesk({
  subsets:  ['latin'],
  weight:   ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display:  'swap',
});

const spectral = Spectral({
  subsets:  ['latin'],
  weight:   ['400', '500', '600'],
  style:    ['normal', 'italic'],
  variable: '--font-serif',
  display:  'swap',
});

const spaceMono = Space_Mono({
  subsets:  ['latin'],
  weight:   ['400', '700'],
  variable: '--font-mono',
  display:  'swap',
});

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://venture.app'),
  title: 'Venture — Hidden Gems Travel Planner',
  description: 'Discover the places most tourists never find. AI-powered hidden gems for every trip.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable:         true,
    statusBarStyle:  'black-translucent',
    title:           'Venture',
  },
  openGraph: {
    title:       'Venture — Hidden Gems Travel Planner',
    description: 'Discover the places most tourists never find. AI-powered hidden gems for every trip.',
    type:        'website',
    siteName:    'Venture',
    images: [
      {
        url:    '/icons/og-image.png',
        width:  1200,
        height: 630,
        alt:    'Venture — Hidden Gems Travel Planner',
      },
    ],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Venture — Hidden Gems Travel Planner',
    description: 'Discover the places most tourists never find. AI-powered hidden gems for every trip.',
    images:      ['/icons/og-image.png'],
  },
};

export function generateViewport() {
  return {
    width:          'device-width',
    initialScale:   1,
    maximumScale:   1,
    userScalable:   false,
    viewportFit:    'cover',
    themeColor:     'oklch(0.973 0.008 84)',
  };
}

export default function RootLayout({ children }) {
  const fontVars = [hanken.variable, spectral.variable, spaceMono.variable].join(' ');
  return (
    <html lang="en" className={fontVars}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:oklch(0.973 0.008 84);color:oklch(0.245 0.013 58);margin:0;}` }} />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />
        <meta name="apple-mobile-web-app-capable"        content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title"          content="Venture" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className={hanken.className}>
        <OfflineBanner />
        <ToastProvider>
          <TripModalProvider>
            {children}
          </TripModalProvider>
        </ToastProvider>
        <Analytics />
        {process.env.NODE_ENV === 'development' ? <DevSwKiller /> : <SwRegister />}
      </body>
    </html>
  );
}
