import Link from "next/link";
import { DisclosureDemo } from "@/components/DisclosureDemo";

export default function Home() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">Verifiable disclosure for paid AI recommendations</p>
        <h1>A &ldquo;sponsored&rdquo; label is just the platform&rsquo;s word.</h1>
        <p>
          The same company takes the advertiser&rsquo;s money, writes the recommendation, and decides
          whether to call it sponsored. AdReceipt replaces that with something you can check
          yourself: a payment receipt bound to the exact recommendation, indexed publicly and
          re-verified against Ethereum.
        </p>
      </section>

      <DisclosureDemo />

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">How a badge earns its place</h2>
        <ol className="how-steps">
          <li>
            <h3>The advertiser proves it is real</h3>
            <p>
              It publishes a challenge in its domain&rsquo;s DNS. The check runs inside a hardware
              enclave, so nobody &mdash; including us &mdash; has to be trusted with the answer.
            </p>
          </li>
          <li>
            <h3>The publisher signs the exact recommendation</h3>
            <p>
              Not &ldquo;an ad slot&rdquo; &mdash; the specific wording, product and price, committed
              in a signature before any money moves.
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
              Monetise recommendations without asking users to take your word for it &mdash; and know
              whose money you are accepting before you take it.
            </p>
            <Link href="/campaign" className="text-link">
              Prepare a placement →
            </Link>
          </article>
          <article>
            <h3>Advertisers</h3>
            <p>
              Prove you control the brand you are bidding as, and get auditable evidence that the
              placement you paid for was the placement that ran.
            </p>
            <Link href="/advertiser" className="text-link">
              Prove your domain →
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
