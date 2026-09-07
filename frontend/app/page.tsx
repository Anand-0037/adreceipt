import Link from "next/link";
import { EntryGate } from "@/components/EntryGate";
import { SettleIcon, SignIcon, VerifyIcon } from "@/components/FeatureIcons";
import { FlowArtwork } from "@/components/FlowArtwork";
import { ReceiptArtwork } from "@/components/HeroReceipt";
import { Reveal } from "@/components/Reveal";
import { protocol } from "@/lib/protocol";

const FEATURES = [
  {
    Icon: SignIcon,
    tag: "Sign",
    title: "Signed before payment",
    body: "The publisher signs the exact recommendation text, product and price. The commitment exists before any money moves.",
  },
  {
    Icon: SettleIcon,
    tag: "Settle",
    title: "Settled directly",
    body: "Advertiser to publisher in one transaction. The contract witnesses the transfer and emits an immutable receipt.",
  },
  {
    Icon: VerifyIcon,
    tag: "Verify",
    title: "Re-checked from source",
    body: "The Graph finds the receipt; Sepolia RPC confirms it. Disagreement on any field fails closed, with no badge.",
  },
];

/** The two role journeys, in the order a person actually walks them. */
const FLOWS = [
  {
    role: "Advertiser",
    blurb: "You pay for placements and want proof of what you bought.",
    href: "/advertiser",
    cta: "Start as an advertiser",
    steps: [
      {
        href: "/login",
        label: "Log in",
        note: "Connect a wallet on Sepolia. No account, no password.",
      },
      {
        href: "/advertiser",
        label: "Prove domain",
        note: "Register a claim, then verify it with a DNS record.",
      },
      {
        href: "/campaign",
        label: "Create campaign",
        note: "Name the product, the copy, and the price.",
      },
      { href: "/advertiser", label: "Fund", note: "Approve a bounded amount of test USDC." },
      {
        href: "/ledger",
        label: "See receipts",
        note: "Every settlement you paid for, re-checked.",
      },
    ],
  },
  {
    role: "Publisher",
    blurb: "You write recommendations and want to be paid for them.",
    href: "/publisher",
    cta: "Start as a publisher",
    steps: [
      {
        href: "/register",
        label: "Register",
        note: "Connect the wallet that will sign your quotes.",
      },
      {
        href: "/publisher",
        label: "Declare a slot",
        note: "Say where the recommendation will appear.",
      },
      {
        href: "/publisher",
        label: "Sign a quote",
        note: "Commit the exact wording, product and price.",
      },
      {
        href: "/publisher",
        label: "Get paid",
        note: "The payer settles straight to your address.",
      },
      { href: "/ask", label: "Render disclosure", note: "Show a badge anyone can re-verify." },
    ],
  },
];

const BOUND = [
  "Publisher signer",
  "Allowed payer",
  "Recipient",
  "Asset and amount",
  "Chain and contract",
  "Subject hash",
  "Schema version",
  "Replay nonce",
];

const CHECKS = [
  {
    check: "Receipt exists",
    detail: "ReceiptCreated log for this ID",
    source: "The Graph",
    fails: "No entity indexed",
  },
  {
    check: "Transaction succeeded",
    detail: "Status 1 on Sepolia",
    source: "Ethereum RPC",
    fails: "Reverted or missing",
  },
  {
    check: "Settlement contract",
    detail: "Emitted by the expected address",
    source: "Ethereum RPC",
    fails: "Wrong contract",
  },
  {
    check: "Every indexed field",
    detail: "Payer, recipient, asset, amount, subject",
    source: "Both",
    fails: "Any mismatch",
  },
  {
    check: "Schema version",
    detail: "Frozen v1 event shape",
    source: "Both",
    fails: "Unknown version",
  },
];

/** The verifier's three outcomes. There is deliberately no optimistic state. */
const VERDICTS = [
  {
    state: "PAID_VERIFIED",
    tone: "ok",
    title: "Paid, and checked",
    body: "The Graph found the receipt and Sepolia confirmed the transaction, the contract, and every indexed field. Only then does a badge appear.",
  },
  {
    state: "PENDING",
    tone: "wait",
    title: "Settled, not yet indexed",
    body: "The payment is on-chain but The Graph has not caught up. The reader is told it is still indexing rather than shown a badge early.",
  },
  {
    state: "UNAVAILABLE",
    tone: "no",
    title: "Cannot be shown",
    body: "Evidence is missing or the two sources disagree on a field. The verifier fails closed and no badge is rendered at all.",
  },
];

const FAQ = [
  {
    q: "What does a verified receipt prove?",
    a: "That a named payer transferred a specific amount to a named recipient, for a recommendation whose exact wording was signed beforehand. It does not prove the payment caused the recommendation, or that the product is any good.",
    open: true,
  },
  {
    q: "Why not just trust a sponsored label?",
    a: "The platform that takes the advertiser's money is the same one deciding whether to disclose it. AdReceipt moves that claim onto a public chain where anyone can re-check it independently.",
  },
  {
    q: "Do you hold the money?",
    a: "No. Payment goes straight from advertiser to publisher in a single transaction. The contract observes the transfer and emits the receipt; there is no escrow in the V1 path.",
    open: true,
  },
  {
    q: "What happens if the evidence disagrees?",
    a: "The verifier fails closed. If The Graph and the chain disagree on any field, or provider evidence is missing, you get no badge rather than an optimistic one.",
  },
  {
    q: "Which network is this on?",
    a: "Ethereum Sepolia, settled in Circle test USDC. It is a testnet integration, not production money.",
  },
  {
    q: "Do I need an account?",
    a: "No. There are no accounts or passwords. Your wallet is the identity, and any claim you register is written on-chain where anyone can check it.",
  },
];

export default function Home() {
  const short = `${protocol.settlement.slice(0, 6)}…${protocol.settlement.slice(-4)}`;

  return (
    <EntryGate>
      <div className="nb-page">
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section className="nb-hero">
          <Reveal immediate>
            <div>
              <h1 className="nb-display">Verify the payment behind the recommendation.</h1>
              <p className="nb-hero-lede">
                A &ldquo;sponsored&rdquo; label is just the platform&rsquo;s word. AdReceipt binds a
                payment to the exact recommendation it paid for, indexes it publicly, and re-checks
                it against Ethereum before showing a badge.
              </p>
              <div className="nb-hero-actions">
                <Link href="/ask" className="nb-btn nb-btn-lime">
                  Verify a recommendation
                </Link>
                <Link href="/register" className="nb-btn">
                  Connect wallet
                </Link>
              </div>
            </div>
          </Reveal>

          <Reveal immediate delay={0.1}>
            <div className="nb-disc">
              {/* Illustrative card. The fields mirror the real receipt schema. */}
              <article className="nb-receipt">
                <div className="nb-receipt-top">Receipt &mdash; v1</div>
                <div className="nb-receipt-body">
                  <ReceiptArtwork />
                  <span className="nb-badge nb-badge-float">
                    <i aria-hidden />
                    Paid verified
                  </span>
                </div>
                <div className="nb-receipt-split">
                  <div>2.50 USDC</div>
                  <div className="mono">{short}</div>
                </div>
                <Link href="/ask" className="nb-receipt-foot">
                  Check a receipt
                </Link>
              </article>
            </div>
          </Reveal>
        </section>

        {/* ── Feature strip ─────────────────────────────────────────────────── */}
        <Reveal>
          <section className="nb-strip">
            {FEATURES.map((f) => (
              <article key={f.title}>
                <span className="nb-strip-icon">
                  <f.Icon />
                </span>
                <span className="nb-badge">{f.tag}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </section>
        </Reveal>

        {/* ── Role journeys ─────────────────────────────────────────────────── */}
        <section className="nb-section">
          <Reveal>
            <p className="nb-eyebrow">Two sides, one receipt</p>
            <h2>Pick your path</h2>
          </Reveal>
          <div className="nb-flows">
            {FLOWS.map((flow, i) => (
              <Reveal key={flow.role} delay={i * 0.08}>
                <article className="nb-flow">
                  <header>
                    <h3>{flow.role}</h3>
                    <p>{flow.blurb}</p>
                  </header>
                  <ol className="nb-flow-steps">
                    {flow.steps.map((s, n) => (
                      <li key={s.label}>
                        <span className="nb-flow-num">{n + 1}</span>
                        {/* Each step links to the page where it happens, so the
                            journey on the landing page is walkable, not just a list. */}
                        <Link href={s.href} className="nb-flow-link">
                          <b>{s.label}</b>
                          <small>{s.note}</small>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <Link href={flow.href} className="nb-btn nb-btn-lime nb-btn-wide">
                    {flow.cta}
                  </Link>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── What the quote binds ──────────────────────────────────────────── */}
        <section className="nb-split">
          <Reveal>
            <FlowArtwork />
          </Reveal>
          <Reveal delay={0.08}>
            <div>
              <p className="nb-eyebrow nb-eyebrow-left">How a badge earns its place</p>
              <h2>Payment bound to the exact recommendation</h2>
              <p>
                AdReceipt computes commitments from the content you supply. It never attaches a
                sample receipt to a different recommendation. These are the fields the publisher
                signs before any money moves.
              </p>
              <div className="nb-chips">
                {BOUND.map((b) => (
                  <span className="nb-chip" key={b}>
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Evidence table ────────────────────────────────────────────────── */}
        <section className="nb-section">
          <Reveal>
            <p className="nb-eyebrow">Fail closed</p>
            <h2>What gets checked</h2>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="nb-table-wrap">
              <table className="nb-table">
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Source</th>
                    <th scope="col">Fails when</th>
                  </tr>
                </thead>
                <tbody>
                  {CHECKS.map((c) => (
                    <tr key={c.check}>
                      <td>
                        <b>{c.check}</b>
                        <small>{c.detail}</small>
                      </td>
                      <td>
                        <span className="nb-tag">{c.source}</span>
                      </td>
                      <td>
                        <span className="nb-tag nb-tag-neutral">{c.fails}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link href="/ledger" className="nb-btn nb-btn-lime nb-btn-bar">
              Open the receipt ledger
            </Link>
          </Reveal>
        </section>

        {/* ── Badge states ──────────────────────────────────────────────────── */}
        <section className="nb-section">
          <Reveal>
            <p className="nb-eyebrow">Verdicts</p>
            <h2>What a badge can say</h2>
            <p className="nb-section-note" style={{ margin: "0 auto 34px", textAlign: "center" }}>
              These are the only three answers the verifier gives. There is no optimistic state.
            </p>
          </Reveal>
          <div className="nb-grid">
            {VERDICTS.map((v, i) => (
              <Reveal key={v.state} delay={i * 0.07}>
                <article className={`nb-verdict nb-verdict-${v.tone}`}>
                  <div className="nb-verdict-art">
                    <span className="nb-verdict-chip">{v.state}</span>
                  </div>
                  <div className="nb-verdict-body">
                    <h3>{v.title}</h3>
                    <p>{v.body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <section className="nb-section">
          <Reveal>
            <p className="nb-eyebrow">Answers</p>
            <h2>Frequently asked questions</h2>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="nb-faq">
              {FAQ.map((f) => (
                <details key={f.q} open={f.open}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────────────────── */}
        <Reveal>
          <section className="nb-cta">
            <h2 className="nb-display">Bind a payment to what you actually recommended.</h2>
            <div className="nb-cta-actions">
              <Link href="/register" className="nb-btn">
                Get started
              </Link>
              <Link href="/ledger" className="nb-btn">
                Open the ledger
              </Link>
            </div>
          </section>
        </Reveal>
      </div>
    </EntryGate>
  );
}
