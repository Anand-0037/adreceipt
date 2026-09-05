import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdReceipt — verifiable sponsorship disclosure",
  description:
    "Check whether an AI recommendation was paid for, and whether the advertiser behind it is provably real.",
};

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/registry", label: "Registry" },
  { href: "/auditor", label: "Auditor" },
  { href: "/verify", label: "Get verified" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              AdReceipt
            </Link>
            <nav className="flex gap-5 text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              ))}
            </nav>
            <span
              className="mono ml-auto hidden text-[11px] sm:inline"
              style={{ color: "var(--ink-faint)" }}
            >
              sepolia
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>

        {/*
          The claim, stated permanently rather than in a tooltip. A verified
          badge could otherwise lend false confidence to a mediocre product,
          so the narrower claim sits on every page.
        */}
        <footer
          className="mt-16 border-t px-6 py-8 text-[12px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--ink-faint)" }}
        >
          <div className="mx-auto max-w-5xl space-y-2">
            <p>
              A badge shows <strong style={{ color: "var(--ink-muted)" }}>payment transparency,
              not product quality</strong>. &ldquo;Verified&rdquo; means an advertiser proved it
              controls the domain it claims. It does not mean the product is good, safe, or
              recommended.
            </p>
            <p>
              All brands and figures shown are fictional and illustrative. Every value is read
              live from contracts on Ethereum Sepolia.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
