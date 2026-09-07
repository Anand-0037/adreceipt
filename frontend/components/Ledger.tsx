"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { explorer, ledgerApi, type LedgerData } from "@/lib/api";

/**
 * The public ledger of settled sponsorships.
 *
 * Per-receipt verification answers "is this one real". Only the full list
 * answers "how much sponsorship is happening here, and by whom" - which is the
 * question a user, a regulator or a competitor actually has, and the one a
 * platform-controlled disclosure can never be made to answer.
 *
 * Totals come from the API rather than being summed in the browser, so what is
 * displayed is reproducible from a documented source instead of being this
 * client's own arithmetic.
 */

const usdc = (base: string) => (Number(base) / 1e6).toFixed(2);
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const when = (unix: string) =>
  new Date(Number(unix) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function Ledger() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ledgerApi
      .all()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="form-error">
        Could not read the ledger: {error}. The indexer or the backend may be unreachable — nothing
        is inferred when evidence is missing.
      </p>
    );
  }

  if (!data) return <p className="field-help">Reading the indexer…</p>;

  if (data.count === 0) {
    return (
      <p className="field-help">
        No verified settlement is currently available from The Graph and Sepolia RPC.
      </p>
    );
  }

  return (
    <div className="ledger">
      <dl className="ledger-summary">
        <div>
          <dt>Total sponsored</dt>
          <dd className="mono">{usdc(data.totalAmount)}</dd>
          <span className="field-help">test USDC</span>
        </div>
        <div>
          <dt>Placements</dt>
          <dd className="mono">{data.count}</dd>
          <span className="field-help">settled receipts</span>
        </div>
        <div>
          <dt>Sponsors</dt>
          <dd className="mono">{data.sponsors.length}</dd>
          <span className="field-help">distinct payers</span>
        </div>
        <div>
          <dt>Publishers paid</dt>
          <dd className="mono">{data.publishers.length}</dd>
          <span className="field-help">distinct recipients</span>
        </div>
      </dl>

      <section>
        <h2>Who sponsored, and how much</h2>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Sponsor</th>
                <th>Placements</th>
                <th>Total paid</th>
              </tr>
            </thead>
            <tbody>
              {data.sponsors.map((s) => (
                <tr key={s.address}>
                  <td className="mono">
                    <a href={explorer.address(s.address)} target="_blank" rel="noreferrer">
                      {short(s.address)} ↗
                    </a>
                  </td>
                  <td className="num">{s.placements}</td>
                  <td className="num">{usdc(s.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Latest verified placements</h2>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Settled</th>
                <th>Sponsor</th>
                <th>Paid to</th>
                <th>Amount</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.receipts.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.blockTimestamp)}</td>
                  <td className="mono">
                    <a href={explorer.address(r.payer)} target="_blank" rel="noreferrer">
                      {short(r.payer)}
                    </a>
                  </td>
                  <td className="mono">
                    <a href={explorer.address(r.recipient)} target="_blank" rel="noreferrer">
                      {short(r.recipient)}
                    </a>
                  </td>
                  <td className="num">{usdc(r.amount)}</td>
                  <td className="mono">
                    <Link href={`/receipts/${r.id}`}>{r.id.slice(0, 12)}…</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="field-help">
        Graph block {data.indexedBlock} · RPC head {data.rpcHead} · every displayed row is
        PAID_VERIFIED against both providers
        {data.hasMore ? ` · showing the latest ${data.limit}` : ""}.
      </p>
    </div>
  );
}
