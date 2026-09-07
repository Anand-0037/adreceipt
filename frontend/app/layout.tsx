import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import { SiteChrome } from "@/components/SiteChrome";
import "./globals.css";

/**
 * Two faces, mapped onto the --display / --body tokens in globals.css.
 * Space Grotesk carries the oversized headline treatment from the reference;
 * Inter keeps the receipt and evidence copy readable at small sizes.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AdReceipt — verify paid AI recommendations",
  description: "Verify a recommendation-bound payment against The Graph and Ethereum Sepolia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        {/*
          Reveal animations are server-rendered at opacity 0 and cleared by JS.
          Without this, a reader with scripting disabled would get a blank page.
        */}
        <noscript>
          <style>{`[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-screen">
        <MotionProvider>
          <SiteChrome>{children}</SiteChrome>
        </MotionProvider>
      </body>
    </html>
  );
}
