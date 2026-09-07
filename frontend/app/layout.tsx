import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdReceipt — verify paid AI recommendations",
  description: "Verify a recommendation-bound payment against The Graph and Ethereum Sepolia.",
};

const NAV = [
  { href: "/ask", label: "Verify" },
  { href: "/advertiser", label: "Payer onboarding" },
  { href: "/publisher", label: "Publisher onboarding" },
  { href: "/ledger", label: "Ledger" },
  { href: "/campaign", label: "Campaign" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="site-header">
          <div className="header-inner">
            <Link href="/ask" className="wordmark">
              <span aria-hidden>AR</span>AdReceipt
            </Link>
            <nav aria-label="Primary navigation">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="network-pill">
              <i aria-hidden /> Sepolia
            </span>
          </div>
        </header>

        <main className="site-main">{children}</main>

        <footer className="site-footer">
          <div>
            <p>
              <strong>Payment transparency, not product quality.</strong> AdReceipt verifies one
              direct testnet payment and its signed context.
            </p>
            <a href="https://github.com/Anand-0037/adreceipt" target="_blank" rel="noreferrer">
              Source ↗
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
