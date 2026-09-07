"use client";

import { BrowserProvider, Contract, formatUnits } from "ethers";
import { injected } from "./wallet";
import { parseSignedQuote, SETTLEMENT, USDC, type SignedQuote } from "./quote";
import { protocol } from "./protocol";

/**
 * Advertiser-side settlement.
 *
 * Two transactions, and the approval is deliberately bounded to the exact quote
 * amount rather than unlimited. An unlimited approval on a settlement contract
 * is a standing permission to move an advertiser's whole balance; approving the
 * price of one placement is not.
 */

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;

const SETTLEMENT_ABI = [
  "function settlePlacement((address publisher,bytes32 placementId,bytes32 productRefHash,bytes32 contentHash,uint16 disclosureVersion) subject,(uint16 schemaVersion,bytes32 campaignId,bytes32 subjectHash,address payer,address recipient,address asset,uint256 amount,uint64 validUntil,bytes32 nonce,uint256 chainId,address settlementContract) quote,bytes publisherSignature) returns (bytes32)",
  "error InvalidSubject()",
  "error InvalidQuote()",
  "error UnsupportedSchema(uint16 provided)",
  "error SubjectMismatch(bytes32 expected, bytes32 actual)",
  "error WrongPayer(address caller, address expected)",
  "error WrongAsset(address provided, address expected)",
  "error WrongChain(uint256 provided, uint256 expected)",
  "error WrongSettlementContract(address provided, address expected)",
  "error QuoteExpired(uint64 validUntil, uint64 currentTime)",
  "error InvalidPublisherSignature(address recovered, address expected)",
  "error QuoteAlreadyConsumed(bytes32 quoteId)",
  "error NonceAlreadyConsumed(bytes32 nonceKey)",
  "error NonExactTransfer(uint256 expected, uint256 received)",
] as const;

export interface SettleProgress {
  step: "checking" | "approving" | "settling" | "done";
  message: string;
  approvalTx?: string;
  settlementTx?: string;
  receiptId?: string;
}

export { parseSignedQuote };

export async function settle(
  signed: SignedQuote,
  onProgress: (p: SettleProgress) => void,
): Promise<SettleProgress> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");

  const signer = await new BrowserProvider(eth).getSigner();
  const network = await new BrowserProvider(eth).getNetwork();
  if (network.chainId !== BigInt(protocol.chainId))
    throw new Error(`Switch your wallet to ${protocol.network}.`);
  const me = await signer.getAddress();

  // Fail here rather than let the contract revert with WrongPayer after the
  // person has already paid gas for an approval.
  if (me.toLowerCase() !== signed.quote.payer.toLowerCase()) {
    throw new Error(
      `This quote names ${signed.quote.payer} as the payer, but you are connected as ${me}.`,
    );
  }

  const amount = BigInt(signed.quote.amount);
  const token = new Contract(USDC, ERC20_ABI as unknown as string[], signer);

  onProgress({ step: "checking", message: "Checking your balance and allowance…" });

  const balance = (await token.balanceOf(me)) as bigint;
  if (balance < amount) {
    throw new Error(
      `You hold ${formatUnits(balance, 6)} test USDC but this placement costs ${formatUnits(amount, 6)}. Top up from the Circle faucet.`,
    );
  }

  let approvalTx: string | undefined;
  const allowance = (await token.allowance(me, SETTLEMENT)) as bigint;

  if (allowance < amount) {
    onProgress({
      step: "approving",
      message: `Approve exactly ${formatUnits(amount, 6)} USDC — not an unlimited allowance.`,
    });
    const tx = await token.approve(SETTLEMENT, amount);
    const receipt = await tx.wait();
    if (receipt?.status !== 1) throw new Error("The USDC approval was not confirmed.");
    approvalTx = receipt.hash as string;
  }

  onProgress({ step: "settling", message: "Confirm the settlement in your wallet…", approvalTx });

  const settlement = new Contract(SETTLEMENT, SETTLEMENT_ABI as unknown as string[], signer);
  const tx = await settlement.settlePlacement(signed.subject, signed.quote, signed.signature);
  const receipt = await tx.wait();
  if (receipt?.status !== 1) throw new Error("The settlement was not confirmed.");

  return {
    step: "done",
    message: "Settled. The receipt is on-chain and will be indexed shortly.",
    approvalTx,
    settlementTx: receipt.hash as string,
    receiptId: signed.receiptId,
  };
}

/** Contract reverts, in language the person settling can act on. */
export function describeSettlementError(error: unknown): string {
  const e = error as { revert?: { name?: string }; shortMessage?: string; message?: string };
  const known: Record<string, string> = {
    WrongPayer: "This quote names a different advertiser as the payer.",
    QuoteExpired: "The quote has expired. Ask the publisher for a fresh one.",
    QuoteAlreadyConsumed: "This quote was already settled — a receipt exists for it.",
    NonceAlreadyConsumed: "The publisher already used this nonce for another placement.",
    InvalidPublisherSignature:
      "The signature does not recover to the publisher named in the quote. The quote was altered after signing.",
    SubjectMismatch: "The recommendation text does not match what was signed.",
    WrongAsset: "This settlement contract only accepts the configured test USDC.",
    WrongChain: "That quote was signed for a different chain.",
    NonExactTransfer:
      "The token did not transfer the exact amount. Fee-on-transfer tokens are rejected.",
    UnsupportedSchema: "The quote uses a schema version this contract does not accept.",
  };

  const name = e?.revert?.name;
  if (name && known[name]) return known[name];

  const message = e?.shortMessage ?? e?.message ?? String(error);
  if (/user rejected/i.test(message)) return "You rejected the request in your wallet.";
  return message;
}
