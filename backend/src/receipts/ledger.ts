import { getProvider } from "../chain/provider";
import { config } from "../config";
import type { GraphSubjectEvidence } from "./graph";
import { readRpcReceipt } from "./rpc";
import { classifyReceipt, type ReceiptEvidence } from "./verify";

export interface VerifiedReceiptCollection {
  count: number;
  receipts: ReceiptEvidence[];
  indexedBlock: number;
  rpcHead: number;
  hasIndexingErrors: false;
  verification: "PAID_VERIFIED";
  limit: number;
  hasMore: boolean;
}

/** Require every displayed Graph row to match its canonical Sepolia receipt. */
export async function verifyReceiptCollection(
  graph: GraphSubjectEvidence,
): Promise<VerifiedReceiptCollection> {
  const provider = getProvider();
  const rpcHead = await provider.getBlockNumber();
  const limit = 25;
  const receipts = graph.receipts.slice(0, limit);
  const health = classifyReceipt({
    receiptId: `0x${"00".repeat(32)}`,
    graph: {
      receipt: null,
      blockNumber: graph.blockNumber,
      hasIndexingErrors: graph.hasIndexingErrors,
    },
    rpcHead,
    expectedContract: config.settlementAddress,
    expectedChainId: config.chainId,
    maxLag: config.graphMaxLag,
  });
  if (health.status !== "NOT_FOUND_AT_BLOCK") {
    throw new Error(`Ledger discovery is not healthy: ${health.status}`);
  }

  const decisions = await Promise.all(
    receipts.map(async (receipt) => {
      const rpc = await readRpcReceipt(
        provider,
        receipt.transactionHash,
        Number(receipt.logIndex),
        config.settlementAddress,
      );
      return classifyReceipt({
        receiptId: receipt.id,
        graph: {
          receipt,
          blockNumber: graph.blockNumber,
          hasIndexingErrors: graph.hasIndexingErrors,
        },
        rpc,
        rpcHead,
        expectedContract: config.settlementAddress,
        expectedChainId: config.chainId,
        maxLag: config.graphMaxLag,
      });
    }),
  );
  if (decisions.some((decision) => decision.status !== "PAID_VERIFIED")) {
    throw new Error("At least one ledger receipt failed canonical verification");
  }

  return {
    count: receipts.length,
    receipts,
    indexedBlock: graph.blockNumber,
    rpcHead,
    hasIndexingErrors: false,
    verification: "PAID_VERIFIED",
    limit,
    hasMore: graph.receipts.length > limit,
  };
}
