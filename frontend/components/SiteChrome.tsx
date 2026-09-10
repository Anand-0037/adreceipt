"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/campaign", label: "Campaigns" },
  { href: "/ledger", label: "Receipts" },
];

const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/ask", label: "Publisher experience" },
      { href: "/campaign", label: "Advertiser campaign" },
      { href: "/ledger", label: "Receipt ledger" },
    ],
  },
  {
    title: "Proof",
    links: [
      { href: "/ledger", label: "Live Graph receipts" },
      { href: "/ask", label: "Context and policy" },
      { href: "/campaign", label: "Signed campaign terms" },
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
          <Link href="/" className="wordmark wordmark-logo" aria-label="AdReceipt home">
            <span className="wordmark-logo-crop" aria-hidden>
              <Image src="/brand/adreceipt-logo.png" alt="" width={1254} height={1254} priority />
            </span>
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
            <Link href="/" className="wordmark wordmark-logo" aria-label="AdReceipt home">
              <span className="wordmark-logo-crop" aria-hidden>
                <Image src="/brand/adreceipt-logo.png" alt="" width={1254} height={1254} />
              </span>
            </Link>
            <p>
              Agentic ad campaigns whose context, policy, content, and payment can be checked before
              a verified sponsored badge appears.
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
            <strong>Commercial provenance, not product quality.</strong> AdReceipt verifies the
            signed placement and its direct testnet payment.
          </p>
          <p>Ethereum Sepolia · test USDC</p>
        </div>
      </footer>
    </>
  );
}
