import Link from "next/link";
import { SettleIcon, SignIcon, VerifyIcon } from "@/components/FeatureIcons";
import { FlowArtwork } from "@/components/FlowArtwork";
import { ReceiptArtwork } from "@/components/HeroReceipt";
import { Reveal } from "@/components/Reveal";
import { protocol } from "@/lib/protocol";

const FEATURES = [
  {
    Icon: SignIcon,
    tag: "Context",
    title: "Relevant before bidding",
    body: "A sanitized context envelope must pass age, safety, topic, intent and relevance rules before a campaign can compete.",
  },
  {
    Icon: SettleIcon,
    tag: "Authorize",
    title: "Policy-bound placement",
    body: "The advertiser signs campaign terms. Chainlink CRE evaluates private targeting and bid rules for the exact placement ticket.",
  },
  {
    Icon: VerifyIcon,
    tag: "Prove",
    title: "Paid and independently checked",
    body: "Privy controls settlement. The Graph finds the receipt and Sepolia RPC confirms every field before a verified badge appears.",
  },
];

const FLOWS = [
  {
    role: "Advertiser agent",
    blurb: "Turn a human objective into reviewable, signed campaign rules.",
    href: "/campaign",
    cta: "Create a campaign",
    steps: [
      {
        href: "/campaign",
        label: "Describe the objective",
        note: "State the product, audience, goal and budget in plain language.",
      },
      {
        href: "/campaign",
        label: "Review the manifest",
        note: "Edit topics, intents, creative, placement cap and safety exclusions.",
      },
      {
        href: "/campaign",
        label: "Sign the revision",
        note: "The advertiser wallet activates only the exact terms it reviewed.",
      },
      {
        href: "/campaign",
        label: "Measure outcomes",
        note: "Verified impressions and clicks produce real CTR, eCPC and eCPM.",
      },
    ],
  },
  {
    role: "AI publisher",
    blurb: "Keep the organic answer separate and prove any paid placement.",
    href: "/ask",
    cta: "Open the publisher",
    steps: [
      {
        href: "/ask",
        label: "Classify the query",
        note: "Use minimal context signals without exposing raw chat to advertisers.",
      },
      {
        href: "/ask",
        label: "Gate and match",
        note: "Sensitive, under-age, unknown or irrelevant contexts show no ad.",
      },
      {
        href: "/ask",
        label: "Authorize and settle",
        note: "A ticket binds context, policy, campaign revision, creative and price.",
      },
      {
        href: "/ledger",
        label: "Render verified",
        note: "Only Graph plus RPC agreement unlocks Sponsored · Verified.",
      },
    ],
  },
];

const BOUND = [
  "Advertiser-signed campaign revision",
  "Sanitized context commitment",
  "Creative and product",
  "Private policy commitment",
  "Publisher, payer and recipient",
  "Asset, amount and expiry",
  "Chain and contract",
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

/** Every verifier outcome. There is deliberately no optimistic state. */
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
    state: "NOT_FOUND_AT_BLOCK",
    tone: "no",
    title: "No receipt at that block",
    body: "The indexer is fresh, but there is no matching receipt at the requested block. This does not prove the recommendation was organic.",
  },
  {
    state: "INVALID",
    tone: "no",
    title: "Evidence disagrees",
    body: "The Graph and canonical transaction differ on at least one bound field. The verifier refuses the paid claim.",
  },
  {
    state: "UNAVAILABLE",
    tone: "no",
    title: "Sources unavailable",
    body: "The required provider evidence cannot be read. The application reports the outage and renders no verified badge.",
  },
];

const FAQ = [
  {
    q: "What does a verified receipt prove?",
    a: "That a named payer transferred a specific amount for a signed placement bound to one campaign revision, sanitized context, creative and policy commitment. It does not prove that the product is good.",
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
    q: "Can money make an irrelevant ad win?",
    a: "No. Safety, age, topic, intent and a relevance floor are hard eligibility gates. Price is considered only after a campaign is eligible for the current context.",
  },
];

export default function Home() {
  const short = `${protocol.settlement.slice(0, 6)}…${protocol.settlement.slice(-4)}`;

  return (
    <div className="nb-page">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="nb-hero">
        <Reveal immediate>
          <div>
            <h1 className="nb-display">The trust layer for advertising inside AI answers.</h1>
            <p className="nb-hero-lede">
              Advertiser agents can buy relevant placements. AI publishers can prove the context,
              policy, content and payment behind every sponsored result—without mixing it into the
              organic answer.
            </p>
            <div className="nb-hero-actions">
              <Link href="/campaign" className="nb-btn nb-btn-lime">
                Launch a campaign
              </Link>
              <Link href="/ask" className="nb-btn">
                Test the publisher
              </Link>
            </div>
          </div>
        </Reveal>

        <Reveal immediate delay={0.1}>
          <div className="nb-disc">
            {/* Protocol preview. It deliberately makes no live payment claim. */}
            <article className="nb-receipt">
              <div className="nb-receipt-top">Placement proof &mdash; V2 on V1 settlement</div>
              <div className="nb-receipt-body">
                <ReceiptArtwork />
                <span className="nb-badge nb-badge-float">
                  <i aria-hidden />
                  Context + policy + payment
                </span>
              </div>
              <div className="nb-receipt-split">
                <div>Sepolia settlement</div>
                <div className="mono">{short}</div>
              </div>
              <Link href="/ask" className="nb-receipt-foot">
                Open the publisher experience
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
          <p className="nb-eyebrow">One complete advertising lifecycle</p>
          <h2>Agents manage the ad. People can verify it.</h2>
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
            <h2>One ticket binds the commercial decision</h2>
            <p>
              AdReceipt turns campaign terms, sanitized context, private policy, creative and price
              into one placement commitment. The publisher signs that exact commitment before any
              money moves.
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
            These are the five answers the verifier gives. There is no optimistic state.
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
          <h2 className="nb-display">
            Make commercial influence visible and independently checkable.
          </h2>
          <div className="nb-cta-actions">
            <Link href="/campaign" className="nb-btn">
              Create a campaign
            </Link>
            <Link href="/ask" className="nb-btn">
              Run a contextual placement
            </Link>
          </div>
        </section>
      </Reveal>
    </div>
  );
}
