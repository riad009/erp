import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'কাজী রোমান এন্ড ব্রাদার্স — হিসাব খাতা',
  description: 'স্টক, খতিয়ান, দৈনিক, মেমো — বাংলা হিসাব খাতা',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
