import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PWAInstaller } from "@/components/PWAInstaller";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interview Coach",
  description: "AI-powered spoken interview practice with automatic transcription, scoring, and actionable feedback",
  manifest: "/manifest.json",
  themeColor: "#3b82f6",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Interview Coach",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Interview Coach" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          {children}
          <PWAInstaller />
        </ErrorBoundary>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js')
                    .then((registration) => {
                      console.log('SW registered:', registration);
                    })
                    .catch((error) => {
                      console.log('SW registration failed:', error);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
