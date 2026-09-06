import assert from "node:assert/strict";
import test from "node:test";
import { classifyReceipt, type GraphEvidence, type ReceiptEvidence, type RpcEvidence } from "./verify";

const id = `0x${"11".repeat(32)}`;
const contract = `0x${"22".repeat(20)}`;
const receipt: ReceiptEvidence = {
  id,
  campaignId: `0x${"33".repeat(32)}`,
  subjectHash: `0x${"44".repeat(32)}`,
  publisher: `0x${"55".repeat(20)}`,
  payer: `0x${"66".repeat(20)}`,
  recipient: `0x${"77".repeat(20)}`,
  asset: `0x${"88".repeat(20)}`,
  amount: "1000000",
  settledAt: "1700000000",
  schemaVersion: 1,
  settlementContract: contract,
  transactionHash: `0x${"99".repeat(32)}`,
  logIndex: "2",
  blockNumber: "95",
  blockTimestamp: "1700000000",
};
const graph: GraphEvidence = { receipt, blockNumber: 100, hasIndexingErrors: false };
const rpc: RpcEvidence = { chainId: 11155111, receipt };
const valid = { receiptId: id, graph, rpc, rpcHead: 102, expectedContract: contract,
  expectedChainId: 11155111, maxLag: 5 };

test("verifies only matching Graph and RPC evidence", () => {
  assert.equal(classifyReceipt(valid).status, "PAID_VERIFIED");
});

test("fails closed without configuration or RPC event evidence", () => {
  assert.equal(classifyReceipt({ receiptId: id, maxLag: 5 }).status, "UNAVAILABLE");
  assert.equal(classifyReceipt({ ...valid, rpc: undefined }).status, "UNAVAILABLE");
});

test("returns pending for stale indexing", () => {
  assert.equal(classifyReceipt({ ...valid, rpcHead: 110 }).status, "PENDING");
});

test("distinguishes pending and indexed absence", () => {
  const empty = { ...graph, receipt: null };
  assert.equal(classifyReceipt({ ...valid, graph: empty, rpc: undefined, atBlock: 105 }).status, "PENDING");
  assert.equal(classifyReceipt({ ...valid, graph: empty, rpc: undefined, atBlock: 99 }).status, "NOT_FOUND_AT_BLOCK");
});

test("does not verify a receipt before its creation block", () => {
  assert.equal(classifyReceipt({ ...valid, atBlock: 94 }).status, "NOT_FOUND_AT_BLOCK");
  assert.equal(classifyReceipt({ ...valid, atBlock: 95 }).status, "PAID_VERIFIED");
});

test("rejects indexing errors, future Graph heads, and wrong chains", () => {
  assert.equal(classifyReceipt({ ...valid, graph: { ...graph, hasIndexingErrors: true } }).status, "INVALID");
  assert.equal(classifyReceipt({ ...valid, graph: { ...graph, blockNumber: 103 } }).status, "INVALID");
  assert.equal(classifyReceipt({ ...valid, rpc: { ...rpc, chainId: 1 } }).status, "INVALID");
});

test("rejects every Graph field that differs from the RPC event", () => {
  for (const key of Object.keys(receipt) as (keyof ReceiptEvidence)[]) {
    const current = receipt[key];
    const changed = typeof current === "number"
      ? current + 1
      : current.startsWith("0x")
        ? `${current.slice(0, -1)}${current.endsWith("f") ? "e" : "f"}`
        : String(BigInt(current) + 1n);
    const changedReceipt = { ...receipt, [key]: changed } as ReceiptEvidence;
    assert.equal(
      classifyReceipt({ ...valid, graph: { ...graph, receipt: changedReceipt } }).status,
      "INVALID",
      key,
    );
  }
});

test("rejects a settlement time that differs from the RPC block", () => {
  const changed = { ...receipt, settledAt: "1700000001" };
  assert.equal(classifyReceipt({ ...valid, graph: { ...graph, receipt: changed }, rpc: { ...rpc, receipt: changed } }).status, "INVALID");
});
