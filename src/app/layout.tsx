import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Cleave',
    template: '%s | Cleave',
  },
  description:
    'Keyboard-driven Gmail client that splits your inbox by Gmail labels. Self-hosted, browser-based, never stores email.',
  applicationName: 'Cleave',
  openGraph: {
    type: 'website',
    siteName: 'Cleave',
    title: 'Cleave',
    description:
      'Keyboard-driven Gmail client that splits your inbox by Gmail labels. Self-hosted, browser-based, never stores email.',
    url: siteUrl,
  },
  twitter: {
    card: 'summary',
    title: 'Cleave',
    description: 'Keyboard-driven Gmail client. Self-hosted, browser-based, never stores email.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" style={{ colorScheme: 'light' }}>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
