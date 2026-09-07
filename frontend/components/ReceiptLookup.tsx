"use client";

import { type FormEvent, useState } from "react";
import { api, type VerificationResult } from "@/lib/api";
import { ReceiptResult } from "./ReceiptResult";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export function ReceiptLookup({
  initialId = "",
  compact = false,
}: {
  initialId?: string;
  compact?: boolean;
}) {
  const [receiptId, setReceiptId] = useState(initialId);
  const [atBlock, setAtBlock] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!BYTES32.test(receiptId.trim())) {
      setError("Enter a 32-byte receipt ID beginning with 0x.");
      return;
    }
    const block = atBlock ? Number(atBlock) : undefined;
    if (block !== undefined && (!Number.isSafeInteger(block) || block <= 0)) {
      setError("Historical block must be a positive integer.");
      return;
    }
    setLoading(true);
    try {
      setResult(await api.verifyReceipt(receiptId.trim(), block));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verifier request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lookup-shell">
      <form onSubmit={submit} className="lookup-form" noValidate>
        <label htmlFor="receipt-id">Receipt ID</label>
        <div className="lookup-line">
          <input
            id="receipt-id"
            value={receiptId}
            onChange={(event) => setReceiptId(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="receipt-help"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Checking…" : "Check receipt"}
          </button>
        </div>
        <p id="receipt-help" className="field-help">
          Paste the bytes32 ID attached to a recommendation.
        </p>
        <details>
          <summary>Check at a historical block</summary>
          <label htmlFor="at-block">Sepolia block</label>
          <input
            id="at-block"
            inputMode="numeric"
            value={atBlock}
            onChange={(event) => setAtBlock(event.target.value)}
            placeholder="Optional"
          />
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {loading && (
        <div
          className="result-skeleton"
          role="status"
          aria-label="Verifying through The Graph and RPC"
          aria-busy="true"
        />
      )}
      {result && <ReceiptResult result={result} compact={compact} />}
    </div>
  );
}
