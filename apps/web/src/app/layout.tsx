import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CacheBash — Multi-Agent Coordination Platform',
  description: 'Infrastructure for AI agents that learn, coordinate, and operate autonomously.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
