import assert from "node:assert/strict";
import test from "node:test";
import { Interface, type JsonRpcProvider } from "ethers";
import { readRpcReceipt } from "./rpc";

const contract = `0x${"22".repeat(20)}`;
const transactionHash = `0x${"99".repeat(32)}`;
const values = {
  receiptId: `0x${"11".repeat(32)}`,
  campaignId: `0x${"33".repeat(32)}`,
  subjectHash: `0x${"44".repeat(32)}`,
  publisher: `0x${"55".repeat(20)}`,
  payer: `0x${"66".repeat(20)}`,
  recipient: `0x${"77".repeat(20)}`,
  asset: `0x${"88".repeat(20)}`,
  amount: 1_000_000n,
  settledAt: 1_700_000_000n,
  schemaVersion: 1,
};
const abi = new Interface([
  "event ReceiptCreated(bytes32 indexed receiptId,bytes32 indexed campaignId,bytes32 indexed subjectHash,address publisher,address payer,address recipient,address asset,uint256 amount,uint64 settledAt,uint16 schemaVersion)",
]);
const encoded = abi.encodeEventLog(abi.getEvent("ReceiptCreated")!, Object.values(values));

function provider(address = contract, status = 1): JsonRpcProvider {
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getTransactionReceipt: async () => ({
      status,
      blockNumber: 95,
      hash: transactionHash,
      logs: [{ index: 2, address, ...encoded }],
    }),
    getBlock: async () => ({ timestamp: 1_700_000_000 }),
  } as unknown as JsonRpcProvider;
}

test("decodes canonical ReceiptCreated evidence from RPC", async () => {
  const evidence = await readRpcReceipt(provider(), transactionHash, 2, contract);
  assert.equal(evidence.chainId, 11155111);
  assert.equal(evidence.receipt.id, values.receiptId);
  assert.equal(evidence.receipt.amount, "1000000");
  assert.equal(evidence.receipt.blockNumber, "95");
  assert.equal(evidence.receipt.blockTimestamp, "1700000000");
});

test("rejects failed transactions and logs from another contract", async () => {
  await assert.rejects(readRpcReceipt(provider(contract, 0), transactionHash, 2, contract), /missing or unsuccessful/);
  await assert.rejects(readRpcReceipt(provider(`0x${"aa".repeat(20)}`), transactionHash, 2, contract), /expected settlement log/);
});
