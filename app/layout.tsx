import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fleet Portal',
  description: 'Taxi fleet management portal',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inline script prevents flash of wrong theme before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('theme') || 'dark';
            document.documentElement.setAttribute('data-theme', t);
          } catch(e){}
        `}} />
      </head>
      <body>{children}</body>
    </html>
  )
}
