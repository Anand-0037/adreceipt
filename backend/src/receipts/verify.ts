export type ReceiptStatus = "PAID_VERIFIED" | "PENDING" | "NOT_FOUND_AT_BLOCK" | "INVALID" | "UNAVAILABLE";

export interface ReceiptEvidence {
  id: string; settlementContract: string; schemaVersion: number; blockNumber: string;
  [key: string]: unknown;
}
export interface GraphEvidence { receipt: ReceiptEvidence | null; blockNumber: number; hasIndexingErrors: boolean; }

export function classifyReceipt(input: {
  receiptId: string; graph?: GraphEvidence; rpcHead?: number; expectedContract?: string;
  expectedSchema?: number; maxLag: number; atBlock?: number; unavailable?: string;
}): { status: ReceiptStatus; reason: string; evidence?: GraphEvidence } {
  if (input.unavailable || !input.graph || input.rpcHead === undefined || !input.expectedContract) {
    return { status: "UNAVAILABLE", reason: input.unavailable ?? "verification dependencies are not configured" };
  }
  const graph = input.graph;
  if (graph.hasIndexingErrors || graph.blockNumber > input.rpcHead) {
    return { status: "INVALID", reason: "Graph metadata is inconsistent", evidence: graph };
  }
  if (input.rpcHead - graph.blockNumber > input.maxLag) {
    return { status: "PENDING", reason: "Subgraph is behind the configured freshness threshold", evidence: graph };
  }
  if (!graph.receipt) {
    if (input.atBlock !== undefined && graph.blockNumber < input.atBlock) {
      return { status: "PENDING", reason: "Subgraph has not indexed the requested block", evidence: graph };
    }
    return { status: "NOT_FOUND_AT_BLOCK", reason: "No receipt exists in the indexed state", evidence: graph };
  }
  const receipt = graph.receipt;
  if (receipt.id.toLowerCase() !== input.receiptId.toLowerCase()
      || receipt.settlementContract.toLowerCase() !== input.expectedContract.toLowerCase()
      || receipt.schemaVersion !== (input.expectedSchema ?? 1)) {
    return { status: "INVALID", reason: "Receipt does not match the expected deployment or schema", evidence: graph };
  }
  return { status: "PAID_VERIFIED", reason: "Receipt and Graph freshness checks passed", evidence: graph };
}
