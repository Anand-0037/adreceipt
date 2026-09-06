export type ReceiptStatus = "PAID_VERIFIED" | "PENDING" | "NOT_FOUND_AT_BLOCK" | "INVALID" | "UNAVAILABLE";

export interface ReceiptEvidence {
  id: string;
  campaignId: string;
  subjectHash: string;
  publisher: string;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  settledAt: string;
  schemaVersion: number;
  settlementContract: string;
  transactionHash: string;
  logIndex: string;
  blockNumber: string;
  blockTimestamp: string;
}

export interface GraphEvidence {
  receipt: ReceiptEvidence | null;
  blockNumber: number;
  hasIndexingErrors: boolean;
}

export interface RpcEvidence {
  chainId: number;
  receipt: ReceiptEvidence;
}

export interface VerificationEvidence {
  graph: GraphEvidence;
  rpc?: RpcEvidence;
}

const HEX_FIELDS: (keyof ReceiptEvidence)[] = [
  "id", "campaignId", "subjectHash", "publisher", "payer", "recipient", "asset",
  "settlementContract", "transactionHash",
];
const EXACT_FIELDS: (keyof ReceiptEvidence)[] = [
  "amount", "settledAt", "schemaVersion", "logIndex", "blockNumber", "blockTimestamp",
];

function sameReceipt(graph: ReceiptEvidence, rpc: ReceiptEvidence): boolean {
  return HEX_FIELDS.every((key) => String(graph[key]).toLowerCase() === String(rpc[key]).toLowerCase())
    && EXACT_FIELDS.every((key) => graph[key] === rpc[key]);
}

export function classifyReceipt(input: {
  receiptId: string;
  graph?: GraphEvidence;
  rpc?: RpcEvidence;
  rpcHead?: number;
  expectedContract?: string;
  expectedChainId?: number;
  expectedSchema?: number;
  maxLag: number;
  atBlock?: number;
  unavailable?: string;
}): { status: ReceiptStatus; reason: string; evidence?: VerificationEvidence } {
  if (input.unavailable || !input.graph || input.rpcHead === undefined || !input.expectedContract
      || input.expectedChainId === undefined || !Number.isInteger(input.maxLag) || input.maxLag < 0) {
    return { status: "UNAVAILABLE", reason: input.unavailable ?? "verification dependencies are not configured" };
  }

  const graph = input.graph;
  const evidence: VerificationEvidence = { graph, ...(input.rpc ? { rpc: input.rpc } : {}) };
  if (!Number.isSafeInteger(graph.blockNumber) || graph.blockNumber < 0
      || !Number.isSafeInteger(input.rpcHead) || input.rpcHead < 0
      || graph.hasIndexingErrors || graph.blockNumber > input.rpcHead) {
    return { status: "INVALID", reason: "Graph metadata is inconsistent with RPC", evidence };
  }
  if (input.rpcHead - graph.blockNumber > input.maxLag) {
    return { status: "PENDING", reason: "Subgraph is behind the configured freshness threshold", evidence };
  }
  if (input.atBlock !== undefined && graph.blockNumber < input.atBlock) {
    return { status: "PENDING", reason: "Subgraph has not indexed the requested block", evidence };
  }
  if (!graph.receipt) {
    return { status: "NOT_FOUND_AT_BLOCK", reason: "No receipt exists in the indexed state", evidence };
  }

  const receiptBlock = Number(graph.receipt.blockNumber);
  if (!Number.isSafeInteger(receiptBlock) || receiptBlock < 0 || receiptBlock > graph.blockNumber) {
    return { status: "INVALID", reason: "Receipt block is inconsistent with Graph metadata", evidence };
  }
  if (input.atBlock !== undefined && receiptBlock > input.atBlock) {
    return { status: "NOT_FOUND_AT_BLOCK", reason: "Receipt was created after the requested block", evidence };
  }
  if (!input.rpc) {
    return { status: "UNAVAILABLE", reason: "RPC transaction evidence is unavailable", evidence };
  }
  if (input.rpc.chainId !== input.expectedChainId) {
    return { status: "INVALID", reason: "RPC chain does not match the configured deployment", evidence };
  }

  const receipt = graph.receipt;
  if (receipt.id.toLowerCase() !== input.receiptId.toLowerCase()
      || receipt.settlementContract.toLowerCase() !== input.expectedContract.toLowerCase()
      || receipt.schemaVersion !== (input.expectedSchema ?? 1)) {
    return { status: "INVALID", reason: "Receipt does not match the expected deployment or schema", evidence };
  }
  if (!sameReceipt(receipt, input.rpc.receipt)) {
    return { status: "INVALID", reason: "Graph receipt does not match the canonical RPC event", evidence };
  }
  if (input.rpc.receipt.blockTimestamp !== input.rpc.receipt.settledAt) {
    return { status: "INVALID", reason: "Receipt settlement time does not match its block", evidence };
  }

  return { status: "PAID_VERIFIED", reason: "Graph entity matches the canonical RPC event", evidence };
}
