import Link from "next/link";

export default function Home() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">Verifiable disclosure for paid AI recommendations</p>
        <h1>A &ldquo;sponsored&rdquo; label is just the platform&rsquo;s word.</h1>
        <p>
          The same company takes the advertiser&rsquo;s money, writes the recommendation, and
          decides whether to call it sponsored. AdReceipt replaces that with something you can check
          yourself: a payment receipt bound to the exact recommendation, indexed publicly and
          re-verified against Ethereum.
        </p>
      </section>

      <section className="recommendation-demo">
        <p className="eyebrow">Start with your own data</p>
        <h2>Verify a recommendation or create a signed placement</h2>
        <p>
          AdReceipt computes commitments from user supplied content. It does not attach a sample
          receipt to a different recommendation.
        </p>
        <div className="lookup-line">
          <Link href="/ask" className="text-link">
            Verify recommendation →
          </Link>
          <Link href="/publisher" className="text-link">
            Onboard a publisher →
          </Link>
          <Link href="/advertiser" className="text-link">
            Settle as a payer →
          </Link>
        </div>
      </section>

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">How a badge earns its place</h2>
        <ol className="how-steps">
          <li>
            <h3>The parties connect their wallets</h3>
            <p>
              The quote binds the publisher signer, allowed payer, recipient, asset, price, network,
              and settlement contract.
            </p>
          </li>
          <li>
            <h3>The publisher signs the exact recommendation</h3>
            <p>
              Not &ldquo;an ad slot&rdquo; &mdash; the specific wording, product and price,
              committed in a signature before any money moves.
            </p>
          </li>
          <li>
            <h3>Payment settles directly</h3>
            <p>
              Advertiser to publisher, in one transaction. We never hold the funds; the contract
              witnesses the transfer and emits an immutable receipt.
            </p>
          </li>
          <li>
            <h3>Anyone can re-check it</h3>
            <p>
              The receipt is indexed by The Graph and independently re-read from Ethereum. Agreement
              on every field, or no badge.
            </p>
          </li>
        </ol>
      </section>

      <section className="audience" aria-labelledby="audience-title">
        <h2 id="audience-title">Who this is for</h2>
        <div className="audience-grid">
          <article>
            <h3>AI publishers and agents</h3>
            <p>
              Monetise recommendations without asking users to take your word for it &mdash; and
              know whose money you are accepting before you take it.
            </p>
            <Link href="/campaign" className="text-link">
              Prepare a placement →
            </Link>
          </article>
          <article>
            <h3>Advertisers</h3>
            <p>
              Validate the publisher&rsquo;s full authorization before approving funds, then get
              auditable evidence for the exact placement you paid for.
            </p>
            <Link href="/advertiser" className="text-link">
              Onboard as a payer →
            </Link>
          </article>
          <article>
            <h3>Anyone reading a recommendation</h3>
            <p>
              Check a receipt yourself. No account, no API key, no need to trust the interface that
              showed it to you.
            </p>
            <Link href="/ask" className="text-link">
              Verify a recommendation →
            </Link>
          </article>
        </div>
      </section>

      <section className="limits" aria-labelledby="limits-title">
        <h2 id="limits-title">What this deliberately does not claim</h2>
        <ul>
          <li>It does not detect payments that bypass AdReceipt entirely.</li>
          <li>It does not prove a payment caused the model to choose a product.</li>
          <li>It does not mean an unpaid recommendation is impartial.</li>
          <li>It does not say whether the recommended product is any good.</li>
        </ul>
        <p>
          The boundary is the point. A badge that claimed more than it could prove would be worth
          exactly as much as the label it replaces.
        </p>
      </section>
    </div>
  );
}
