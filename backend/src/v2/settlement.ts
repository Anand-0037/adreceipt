import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { config, settlementDeployment } from "../config";
import { sendPrivyTransaction } from "../privy/client";
import type { V2Store } from "./store";

const erc20 = new Interface([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
]);
const settlement = new Interface([
  "function hashSubject((address publisher,bytes32 placementId,bytes32 productRefHash,bytes32 contentHash,uint16 disclosureVersion) subject) view returns (bytes32)",
  "function hashQuote((uint16 schemaVersion,bytes32 campaignId,bytes32 subjectHash,address payer,address recipient,address asset,uint256 amount,uint64 validUntil,bytes32 nonce,uint256 chainId,address settlementContract) quote) view returns (bytes32)",
  "function nonceKey(address publisher,bytes32 nonce) pure returns (bytes32)",
  "function consumedQuotes(bytes32 quoteId) view returns (bool)",
  "function consumedNonces(bytes32 nonceKey) view returns (bool)",
  "function settlePlacement((address publisher,bytes32 placementId,bytes32 productRefHash,bytes32 contentHash,uint16 disclosureVersion) subject,(uint16 schemaVersion,bytes32 campaignId,bytes32 subjectHash,address payer,address recipient,address asset,uint256 amount,uint64 validUntil,bytes32 nonce,uint256 chainId,address settlementContract) quote,bytes publisherSignature) returns (bytes32)",
]);

function transactionHash(value: unknown): string {
  const candidates = [
    value,
    (value as { data?: unknown })?.data,
    (value as { result?: unknown })?.result,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[0-9a-f]{64}$/i.test(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      for (const key of ["hash", "transaction_hash", "transactionHash"]) {
        const found = (candidate as Record<string, unknown>)[key];
        if (typeof found === "string" && /^0x[0-9a-f]{64}$/i.test(found)) return found;
      }
    }
  }
  throw new Error("PRIVY_TRANSACTION_HASH_MISSING");
}

function reference(kind: "approve" | "settle", receiptId: string): string {
  return `adreceipt-v2-${kind}-${receiptId.replace(/^0x/, "").slice(0, 40)}`;
}

async function read<T>(label: string, operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`RPC_TIMEOUT:${label}`)), 15_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SettlementResult {
  receiptId: string;
  approvalRequired: boolean;
  approvalTx?: string;
  settlementTx: string;
  blockNumber: number;
}

const inFlight = new Map<string, Promise<SettlementResult>>();

export function settleSignedPlacement(
  store: V2Store,
  placementId: string,
): Promise<SettlementResult> {
  const key = placementId.toLowerCase();
  const current = inFlight.get(key);
  if (current) return current;
  const operation = executeSettlement(store, placementId).finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
}

async function executeSettlement(store: V2Store, placementId: string): Promise<SettlementResult> {
  const placement = await store.getPlacement(placementId);
  if (!placement?.signedQuote || placement.status !== "SIGNED") {
    throw new Error("PLACEMENT_NOT_SIGNED");
  }
  const { subject, quote, signature } = placement.signedQuote;
  if (quote.validUntil <= Math.floor(Date.now() / 1_000)) throw new Error("QUOTE_EXPIRED");
  if (quote.chainId !== settlementDeployment.chainId) throw new Error("WRONG_CHAIN");
  if (getAddress(quote.settlementContract) !== getAddress(settlementDeployment.address)) {
    throw new Error("WRONG_SETTLEMENT_CONTRACT");
  }

  const provider = new JsonRpcProvider(
    config.operatorRpcUrl || config.rpcUrl,
    { chainId: settlementDeployment.chainId, name: settlementDeployment.network },
    { staticNetwork: true, batchMaxCount: 1 },
  );
  try {
    const settlementContract = new Contract(
      settlementDeployment.address,
      settlement.fragments,
      provider,
    );
    const token = new Contract(quote.asset, erc20.fragments, provider);
    const [subjectHash, quoteId, nonceKey, consumedQuote, balance, allowance] = await Promise.all([
      read("subject-hash", settlementContract.hashSubject(subject)),
      read("quote-hash", settlementContract.hashQuote(quote)),
      read("nonce-key", settlementContract.nonceKey(subject.publisher, quote.nonce)),
      read("quote-state", settlementContract.consumedQuotes(placement.receiptId)),
      read("payer-balance", token.balanceOf(quote.payer)),
      read("payer-allowance", token.allowance(quote.payer, settlementDeployment.address)),
    ]);
    const consumedNonce = await read("nonce-state", settlementContract.consumedNonces(nonceKey));
    if (String(subjectHash).toLowerCase() !== quote.subjectHash.toLowerCase()) {
      throw new Error("SUBJECT_HASH_MISMATCH");
    }
    if (String(quoteId).toLowerCase() !== placement.receiptId.toLowerCase()) {
      throw new Error("QUOTE_HASH_MISMATCH");
    }
    if (consumedQuote || consumedNonce) throw new Error("QUOTE_ALREADY_USED");
    if (BigInt(balance) < BigInt(quote.amount)) throw new Error("PAYER_USDC_INSUFFICIENT");

    const approvalRequired = BigInt(allowance) < BigInt(quote.amount);
    let approvalTx: string | undefined;
    if (approvalRequired) {
      const approvalData = erc20.encodeFunctionData("approve", [
        settlementDeployment.address,
        quote.amount,
      ]);
      approvalTx = transactionHash(
        await sendPrivyTransaction(
          { to: quote.asset, data: approvalData },
          reference("approve", placement.receiptId),
        ),
      );
      const approvalReceipt = await provider.waitForTransaction(approvalTx, 1, 120_000);
      if (approvalReceipt?.status !== 1) throw new Error("USDC_APPROVAL_FAILED");
    }

    const settlementData = settlement.encodeFunctionData("settlePlacement", [
      subject,
      quote,
      signature,
    ]);
    const settlementTx = transactionHash(
      await sendPrivyTransaction(
        { to: settlementDeployment.address, data: settlementData },
        reference("settle", placement.receiptId),
      ),
    );
    const receipt = await provider.waitForTransaction(settlementTx, 1, 120_000);
    if (receipt?.status !== 1) throw new Error("PLACEMENT_SETTLEMENT_FAILED");
    return {
      receiptId: placement.receiptId,
      approvalRequired,
      ...(approvalTx ? { approvalTx } : {}),
      settlementTx,
      blockNumber: receipt.blockNumber,
    };
  } finally {
    provider.destroy();
  }
}
