import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'কাজী রোমান এন্ড ব্রাদার্স — হিসাব খাতা',
  description: 'স্টক, খতিয়ান, দৈনিক, মেমো — বাংলা হিসাব খাতা',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/favicon-32.png', apple: '/icons/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
