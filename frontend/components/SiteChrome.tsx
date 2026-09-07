"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/ask", label: "Verify" },
  { href: "/ledger", label: "Ledger" },
  { href: "/campaign", label: "Campaign" },
  { href: "/register", label: "Get started" },
];

const FOOTER = [
  {
    title: "Verify",
    links: [
      { href: "/ask", label: "Check a recommendation" },
      { href: "/ledger", label: "Receipt ledger" },
    ],
  },
  {
    title: "Take part",
    links: [
      { href: "/publisher", label: "Publisher onboarding" },
      { href: "/advertiser", label: "Payer onboarding" },
      { href: "/campaign", label: "Campaign builder" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/register", label: "Create an identity" },
      { href: "/login", label: "Sign in" },
    ],
  },
];

/** Sign-in and registration render edge to edge, with no site chrome. */
const BARE = new Set(["/login", "/register"]);

/**
 * Header and footer for every page except the entry screens.
 *
 * The nav belongs to the site you reach after signing in, so /login and
 * /register skip it - and skip the centred <main> column too, letting the
 * split layout fill the viewport.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (BARE.has(pathname)) return <>{children}</>;

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="wordmark">
            <span aria-hidden>AR</span>
            AdReceipt
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
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <Link href="/" className="wordmark">
              <span aria-hidden>AR</span>
              AdReceipt
            </Link>
            <p>
              A payment receipt bound to the exact recommendation it paid for, re-checked against
              Ethereum before any badge appears.
            </p>
            <a href="https://github.com/Anand-0037/adreceipt" target="_blank" rel="noreferrer">
              Source ↗
            </a>
          </div>

          {FOOTER.map((col) => (
            <nav key={col.title} className="site-footer-col" aria-label={col.title}>
              <h2>{col.title}</h2>
              {col.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        <div className="site-footer-base">
          <p>
            <strong>Payment transparency, not product quality.</strong> AdReceipt verifies one
            direct testnet payment and its signed context.
          </p>
          <p>Ethereum Sepolia · test USDC</p>
        </div>
      </footer>
    </>
  );
}
