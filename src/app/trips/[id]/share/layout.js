// Static Open Graph metadata for the share page.
// The actual trip title is dynamic, but we provide sensible defaults here.
// The share page itself is client-side so we expose metadata via this layout.

export const metadata = {
  title: 'Trip Itinerary — Venture',
  description: 'A hidden gems travel itinerary, planned with Venture.',
  openGraph: {
    title: 'Trip Itinerary — Venture',
    description: 'Discover hidden gems and off-the-beaten-path spots, curated with AI.',
    type: 'website',
    siteName: 'Venture',
    images: [
      {
        url: '/icons/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Venture — Hidden Gems Travel Planner',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trip Itinerary — Venture',
    description: 'Discover hidden gems and off-the-beaten-path spots, curated with AI.',
    images: ['/icons/og-image.png'],
  },
};

export default function ShareLayout({ children }) {
  return children;
}
