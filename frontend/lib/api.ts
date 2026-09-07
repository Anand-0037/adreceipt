export const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "/api";

export type ReceiptStatus =
  | "PAID_VERIFIED"
  | "PENDING"
  | "NOT_FOUND_AT_BLOCK"
  | "INVALID"
  | "UNAVAILABLE";

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

export interface VerificationResult {
  status: ReceiptStatus;
  reason: string;
  evidence?: {
    graph: {
      receipt: ReceiptEvidence | null;
      blockNumber: number;
      hasIndexingErrors: boolean;
    };
    rpcHead: number;
    rpc?: { chainId: number; receipt: ReceiptEvidence };
  };
}

export interface Health {
  ok: boolean;
  network: string;
  chainId: number;
  block: number;
  settlement: {
    address: string;
    asset: string;
    deploymentBlock: number;
    deploymentTransaction: string;
  };
  graph: { configured: boolean };
  privy: {
    configured: boolean;
    credentials: boolean;
    wallet: "configured" | "missing";
    policy: "configured" | "missing";
    authorizationKey: "configured" | "missing";
    providerVerified: boolean;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseVerification(value: unknown): VerificationResult {
  if (!isObject(value) || typeof value.status !== "string" || typeof value.reason !== "string") {
    throw new ApiError(502, "invalid-response", "The verifier returned an invalid response.");
  }
  const statuses: ReceiptStatus[] = [
    "PAID_VERIFIED",
    "PENDING",
    "NOT_FOUND_AT_BLOCK",
    "INVALID",
    "UNAVAILABLE",
  ];
  if (!statuses.includes(value.status as ReceiptStatus)) {
    throw new ApiError(502, "invalid-response", "The verifier returned an unknown status.");
  }
  return value as unknown as VerificationResult;
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok && !(response.status === 503 && isObject(body))) {
    const error = isObject(body) ? body : {};
    throw new ApiError(
      response.status,
      typeof error.error === "string" ? error.error : "unknown",
      typeof error.message === "string" ? error.message : response.statusText,
    );
  }
  return body;
}

export const api = {
  health: async () => (await get("/health")) as Health,
  verifyReceipt: async (receiptId: string, atBlock?: number) => {
    const query = atBlock ? `?atBlock=${atBlock}` : "";
    return parseVerification(await get(`/receipts/${encodeURIComponent(receiptId)}${query}`));
  },
  verifySubject: async (subjectHash: string) =>
    parseVerification(await get(`/subjects/${encodeURIComponent(subjectHash)}`)),
};

export const explorer = {
  address: (address: string) => `https://sepolia.etherscan.io/address/${address}`,
  tx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  block: (block: string | number) => `https://sepolia.etherscan.io/block/${block}`,
};

export interface LedgerData {
  count: number;
  totalAmount: string;
  receipts: ReceiptEvidence[];
  sponsors: { address: string; paid: string; placements: number }[];
  publishers: { address: string; earned: string; placements: number }[];
  indexedBlock: number;
  rpcHead: number;
  hasIndexingErrors: false;
  verification: "PAID_VERIFIED";
  limit: number;
  hasMore: boolean;
}

function parseLedger(value: unknown): LedgerData {
  if (
    !isObject(value) ||
    !Array.isArray(value.receipts) ||
    !Array.isArray(value.sponsors) ||
    !Array.isArray(value.publishers) ||
    value.verification !== "PAID_VERIFIED" ||
    value.hasIndexingErrors !== false ||
    typeof value.indexedBlock !== "number" ||
    typeof value.rpcHead !== "number"
  ) {
    throw new ApiError(502, "invalid-response", "The ledger returned invalid evidence.");
  }
  return value as unknown as LedgerData;
}

export const ledgerApi = {
  all: async () => parseLedger(await get("/receipts")),
  byPayer: async (address: string) => {
    const value = await get(`/payers/${encodeURIComponent(address)}/receipts`);
    if (
      !isObject(value) ||
      typeof value.address !== "string" ||
      value.address.toLowerCase() !== address.toLowerCase()
    ) {
      throw new ApiError(502, "invalid-response", "The payer ledger returned invalid evidence.");
    }
    return value as unknown as Omit<LedgerData, "totalAmount" | "sponsors" | "publishers"> & {
      address: string;
    };
  },
};
