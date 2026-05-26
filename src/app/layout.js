import { Inter } from 'next/font/google';
import './globals.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import DevSwKiller from '@/components/DevSwKiller';

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
});

export const metadata = {
  title: 'Venture — Hidden Gems Travel Planner',
  description: 'Discover the places most tourists never find. AI-powered hidden gems for every trip.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable:         true,
    statusBarStyle:  'black-translucent',
    title:           'Venture',
  },
};

export function generateViewport() {
  return {
    width:          'device-width',
    initialScale:   1,
    maximumScale:   1,
    userScalable:   false,
    viewportFit:    'cover',
    themeColor:     '#080810',
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:#080810;color:#f0f0ff;margin:0;}` }} />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />
        <meta name="apple-mobile-web-app-capable"        content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title"          content="Venture" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className={inter.className}>
        {children}
        {process.env.NODE_ENV === 'development' && <DevSwKiller />}
      </body>
    </html>
  );
}
