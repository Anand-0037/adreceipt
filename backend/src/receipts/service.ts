import { isHexString } from "ethers";
import { config } from "../config";
import { getProvider } from "../chain/provider";
import { queryReceipt } from "./graph";
import { classifyReceipt } from "./verify";

export async function verifyReceipt(receiptId: string, atBlock?: number) {
  if (!isHexString(receiptId, 32)) return classifyReceipt({ receiptId, maxLag: config.graphMaxLag, unavailable: "receipt ID must be bytes32" });
  if (!config.graphQueryUrl || !config.settlementAddress) return classifyReceipt({ receiptId, maxLag: config.graphMaxLag, unavailable: "Graph endpoint or settlement deployment is not configured" });
  try {
    const [graph, rpcHead] = await Promise.all([queryReceipt(config.graphQueryUrl, config.graphApiKey, receiptId), getProvider().getBlockNumber()]);
    return classifyReceipt({ receiptId, graph, rpcHead, expectedContract: config.settlementAddress, maxLag: config.graphMaxLag, atBlock });
  } catch (error) {
    return classifyReceipt({ receiptId, maxLag: config.graphMaxLag, unavailable: error instanceof Error ? error.message : String(error) });
  }
}
