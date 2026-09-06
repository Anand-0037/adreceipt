import { isHexString } from "ethers";
import { config } from "../config";
import { getProvider } from "../chain/provider";
import { queryReceipt } from "./graph";
import { classifyReceipt } from "./verify";
import { readRpcReceipt } from "./rpc";

export async function verifyReceipt(receiptId: string, atBlock?: number) {
  if (!isHexString(receiptId, 32)) return classifyReceipt({ receiptId, maxLag: config.graphMaxLag, unavailable: "receipt ID must be bytes32" });
  if (!config.graphQueryUrl || !config.settlementAddress) return classifyReceipt({ receiptId, maxLag: config.graphMaxLag, unavailable: "Graph endpoint or settlement deployment is not configured" });
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
