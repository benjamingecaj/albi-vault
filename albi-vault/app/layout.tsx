import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ALBI VAULT',
  description: 'Private credential vault for ALBI Group',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
