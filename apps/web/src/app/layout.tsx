import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CacheBash — Multi-Agent Coordination | Rezzed.ai',
  description: 'Infrastructure for AI agents that learn, coordinate, and operate autonomously.',
  openGraph: {
    siteName: 'Rezzed.ai',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'CacheBash',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  url: 'https://cachebash.dev',
  publisher: {
    '@type': 'Organization',
    name: 'Rezzed.ai',
    url: 'https://rezzed.ai',
  },
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
