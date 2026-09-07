import { isHexString } from "ethers";
import { config } from "../config";
import { getProvider } from "../chain/provider";
import { queryReceipt, queryReceiptsBySubject } from "./graph";
import { classifyReceipt } from "./verify";
import { readRpcReceipt } from "./rpc";

export async function verifyReceipt(receiptId: string, atBlock?: number) {
  if (!isHexString(receiptId, 32))
    return classifyReceipt({
      receiptId,
      maxLag: config.graphMaxLag,
      unavailable: "receipt ID must be bytes32",
    });
  if (!config.graphQueryUrl || !config.settlementAddress)
    return classifyReceipt({
      receiptId,
      maxLag: config.graphMaxLag,
      unavailable: "Graph endpoint or settlement deployment is not configured",
    });
  try {
    const provider = getProvider();
    const [graph, rpcHead] = await Promise.all([
      queryReceipt(config.graphQueryUrl, config.graphApiKey, receiptId),
      provider.getBlockNumber(),
    ]);
    const rpc = graph.receipt
      ? await readRpcReceipt(
          provider,
          graph.receipt.transactionHash,
          Number(graph.receipt.logIndex),
          config.settlementAddress,
        )
      : undefined;
    return classifyReceipt({
      receiptId,
      graph,
      rpc,
      rpcHead,
      expectedContract: config.settlementAddress,
      expectedChainId: config.chainId,
      maxLag: config.graphMaxLag,
      atBlock,
    });
  } catch {
    return classifyReceipt({
      receiptId,
      maxLag: config.graphMaxLag,
      unavailable: "Receipt verification provider is unavailable",
    });
  }
}

export async function verifySubject(subjectHash: string) {
  if (!isHexString(subjectHash, 32))
    return classifyReceipt({
      receiptId: subjectHash,
      maxLag: config.graphMaxLag,
      unavailable: "subject hash must be bytes32",
    });
  if (!config.graphQueryUrl || !config.settlementAddress)
    return classifyReceipt({
      receiptId: subjectHash,
      maxLag: config.graphMaxLag,
      unavailable: "Graph endpoint or settlement deployment is not configured",
    });
  try {
    const provider = getProvider();
    const [subject, rpcHead] = await Promise.all([
      queryReceiptsBySubject(
        config.graphQueryUrl,
        config.graphApiKey,
        subjectHash,
      ),
      provider.getBlockNumber(),
    ]);
    const baseGraph = {
      receipt: null,
      blockNumber: subject.blockNumber,
      hasIndexingErrors: subject.hasIndexingErrors,
    };
    const base = classifyReceipt({
      receiptId: subjectHash,
      graph: baseGraph,
      rpcHead,
      expectedContract: config.settlementAddress,
      expectedChainId: config.chainId,
      maxLag: config.graphMaxLag,
    });
    if (base.status !== "NOT_FOUND_AT_BLOCK" || subject.receipts.length === 0)
      return base;
    if (
      subject.receipts.some(
        (receipt) =>
          receipt.subjectHash.toLowerCase() !== subjectHash.toLowerCase(),
      )
    ) {
      return {
        ...base,
        status: "INVALID" as const,
        reason: "Graph returned a receipt for a different subject",
      };
    }
    const decisions = await Promise.all(
      subject.receipts.map(async (receipt) => {
        const rpc = await readRpcReceipt(
          provider,
          receipt.transactionHash,
          Number(receipt.logIndex),
          config.settlementAddress,
        );
        return classifyReceipt({
          receiptId: receipt.id,
          graph: { ...baseGraph, receipt },
          rpc,
          rpcHead,
          expectedContract: config.settlementAddress,
          expectedChainId: config.chainId,
          maxLag: config.graphMaxLag,
        });
      }),
    );
    const rejected = decisions.find(
      (decision) => decision.status !== "PAID_VERIFIED",
    );
    return rejected ?? decisions[0];
  } catch {
    return classifyReceipt({
      receiptId: subjectHash,
      maxLag: config.graphMaxLag,
      unavailable: "Subject verification provider is unavailable",
    });
  }
}
