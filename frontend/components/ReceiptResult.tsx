import Link from "next/link";
import {
  explorer,
  type ReceiptEvidence,
  type ReceiptStatus,
  type VerificationResult,
} from "@/lib/api";

const STATUS_COPY: Record<ReceiptStatus, { label: string; summary: string }> = {
  PAID_VERIFIED: {
    label: "Paid placement verified",
    summary:
      "The Graph record matches the successful Sepolia transaction and ReceiptCreated log.",
  },
  PENDING: {
    label: "Indexing in progress",
    summary:
      "The indexer has not reached the required block yet. Try again shortly.",
  },
  NOT_FOUND_AT_BLOCK: {
    label: "No AdReceipt found",
    summary:
      "No receipt exists in the indexed state. This does not prove that a recommendation was organic.",
  },
  INVALID: {
    label: "Evidence rejected",
    summary:
      "The indexed data is stale, inconsistent, or does not match the canonical chain event.",
  },
  UNAVAILABLE: {
    label: "Verification unavailable",
    summary:
      "The verifier could not establish the required Graph and RPC evidence.",
  },
};

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function Row({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const content = <span className="mono break-all text-sm">{value}</span>;
  return (
    <div className="evidence-row">
      <dt>{label}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {content}
          </a>
        ) : (
          content
        )}
      </dd>
    </div>
  );
}

function ReceiptFields({ receipt }: { receipt: ReceiptEvidence }) {
  const settled = new Date(Number(receipt.settledAt) * 1000);
  return (
    <dl className="evidence-list">
      <Row label="Receipt" value={receipt.id} />
      <Row label="Campaign" value={receipt.campaignId} />
      <Row label="Subject commitment" value={receipt.subjectHash} />
      <Row
        label="Amount"
        value={`${Number(receipt.amount) / 1_000_000} test USDC`}
      />
      <Row
        label="Publisher"
        value={receipt.publisher}
        href={explorer.address(receipt.publisher)}
      />
      <Row
        label="Payer"
        value={receipt.payer}
        href={explorer.address(receipt.payer)}
      />
      <Row
        label="Recipient"
        value={receipt.recipient}
        href={explorer.address(receipt.recipient)}
      />
      <Row
        label="Asset"
        value={receipt.asset}
        href={explorer.address(receipt.asset)}
      />
      <Row
        label="Settled"
        value={
          Number.isNaN(settled.valueOf())
            ? receipt.settledAt
            : settled.toLocaleString()
        }
      />
      <Row
        label="Transaction"
        value={short(receipt.transactionHash)}
        href={explorer.tx(receipt.transactionHash)}
      />
      <Row
        label="Block"
        value={receipt.blockNumber}
        href={explorer.block(receipt.blockNumber)}
      />
      <Row
        label="Settlement contract"
        value={receipt.settlementContract}
        href={explorer.address(receipt.settlementContract)}
      />
      <Row label="Schema" value={String(receipt.schemaVersion)} />
    </dl>
  );
}

export function ReceiptResult({
  result,
  compact = false,
}: {
  result: VerificationResult;
  compact?: boolean;
}) {
  const copy = STATUS_COPY[result.status];
  const receipt = result.evidence?.graph.receipt;
  return (
    <section
      className={`result result-${result.status.toLowerCase()}`}
      aria-live="polite"
    >
      <div className="result-heading">
        <span className="status-mark" aria-hidden />
        <div>
          <p className="eyebrow">Verifier decision</p>
          <h2>{copy.label}</h2>
        </div>
      </div>
      <p className="result-summary">{copy.summary}</p>
      <p className="reason">{result.reason}</p>
      {result.evidence && (
        <dl className="graph-health" aria-label="Graph freshness">
          <div>
            <dt>Indexed block</dt>
            <dd>{result.evidence.graph.blockNumber.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Ethereum head</dt>
            <dd>{result.evidence.rpcHead.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Lag</dt>
            <dd>
              {Math.max(
                0,
                result.evidence.rpcHead - result.evidence.graph.blockNumber,
              )}{" "}
              blocks
            </dd>
          </div>
          <div>
            <dt>Indexing errors</dt>
            <dd>{result.evidence.graph.hasIndexingErrors ? "Yes" : "No"}</dd>
          </div>
        </dl>
      )}
      {receipt && !compact && <ReceiptFields receipt={receipt} />}
      {receipt && compact && (
        <Link className="text-link" href={`/receipts/${receipt.id}`}>
          Open complete evidence →
        </Link>
      )}
    </section>
  );
}
