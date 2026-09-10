import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { config, settlementDeployment } from "../config";
import { sendPrivyTransaction } from "../privy/client";
import { V2Store } from "../v2/store";

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

function txHash(value: unknown): string {
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
  throw new Error("Privy response did not contain a transaction hash");
}

function privyReference(kind: "approve" | "settle", receiptId: string): string {
  // Privy caps reference_id at 64 characters. Keep the operation readable and
  // retain 40 hex characters (160 bits) from the receipt digest for idempotency.
  return `adreceipt-v2-${kind}-${receiptId.replace(/^0x/, "").slice(0, 40)}`;
}

async function rpcRead<T>(label: string, operation: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Sepolia RPC timed out while reading ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const placementId = process.argv.find((arg) => /^0x[0-9a-f]{64}$/i.test(arg));
  const broadcast = process.argv.includes("--broadcast");
  if (!placementId) throw new Error("Usage: npm run settle:v2 -- 0x<placementId> [--broadcast]");
  const store = new V2Store(config.databaseUrl);
  let provider: JsonRpcProvider | undefined;
  try {
    const placement = await store.getPlacement(placementId);
    if (!placement?.signedQuote || placement.status !== "SIGNED") {
      throw new Error("Placement must contain a verified publisher signature and be SIGNED");
    }
    const { subject, quote, signature } = placement.signedQuote;
    if (quote.validUntil <= Math.floor(Date.now() / 1_000)) throw new Error("Quote has expired");
    if (quote.chainId !== settlementDeployment.chainId) throw new Error("Wrong chain");
    if (getAddress(quote.settlementContract) !== getAddress(settlementDeployment.address)) {
      throw new Error("Wrong settlement contract");
    }
    provider = new JsonRpcProvider(
      config.operatorRpcUrl || config.rpcUrl,
      {
        chainId: settlementDeployment.chainId,
        name: settlementDeployment.network,
      },
      { staticNetwork: true, batchMaxCount: 1 },
    );
    const settlementContract = new Contract(
      settlementDeployment.address,
      settlement.fragments,
      provider,
    );
    const token = new Contract(quote.asset, erc20.fragments, provider);
    const [subjectHash, quoteId, nonceKey, consumedQuote, balance, allowance, nativeBalance] =
      await Promise.all([
        rpcRead("subject hash", settlementContract.hashSubject(subject)),
        rpcRead("quote hash", settlementContract.hashQuote(quote)),
        rpcRead("nonce key", settlementContract.nonceKey(subject.publisher, quote.nonce)),
        rpcRead("quote replay state", settlementContract.consumedQuotes(placement.receiptId)),
        rpcRead("payer USDC balance", token.balanceOf(quote.payer)),
        rpcRead("payer USDC allowance", token.allowance(quote.payer, settlementDeployment.address)),
        rpcRead("payer Sepolia ETH balance", provider.getBalance(quote.payer)),
      ]);
    const consumedNonce = await rpcRead(
      "publisher nonce replay state",
      settlementContract.consumedNonces(nonceKey),
    );
    if (String(subjectHash).toLowerCase() !== quote.subjectHash.toLowerCase()) {
      throw new Error("Onchain subject hash disagrees with the packet");
    }
    if (String(quoteId).toLowerCase() !== placement.receiptId.toLowerCase()) {
      throw new Error("Onchain quote digest disagrees with the packet");
    }
    if (consumedQuote || consumedNonce) throw new Error("Quote or publisher nonce is already used");
    if (BigInt(balance) < BigInt(quote.amount)) throw new Error("Privy payer lacks test USDC");

    const approvalRequired = BigInt(allowance) < BigInt(quote.amount);
    const approvalData = erc20.encodeFunctionData("approve", [
      settlementDeployment.address,
      quote.amount,
    ]);
    const settlementData = settlement.encodeFunctionData("settlePlacement", [
      subject,
      quote,
      signature,
    ]);
    const packet = {
      network: settlementDeployment.network,
      chainId: settlementDeployment.chainId,
      proofLevel: placement.authorization.proofLevel,
      campaignId: placement.campaignId,
      placementId: placement.placementId,
      receiptId: placement.receiptId,
      payer: quote.payer,
      publisher: subject.publisher,
      recipient: quote.recipient,
      asset: quote.asset,
      amount: quote.amount,
      payerAssetBalance: String(balance),
      payerNativeBalance: String(nativeBalance),
      currentAllowance: String(allowance),
      validUntil: quote.validUntil,
      approvalRequired,
      transactions: [
        ...(approvalRequired
          ? [{ kind: "approve", to: quote.asset, data: approvalData, value: "0x0" }]
          : []),
        {
          kind: "settlePlacement",
          to: settlementDeployment.address,
          data: settlementData,
          value: "0x0",
        },
      ],
      broadcast,
    };
    console.log(JSON.stringify(packet, null, 2));
    if (!broadcast) return;

    let approvalTx: string | undefined;
    if (approvalRequired) {
      approvalTx = txHash(
        await sendPrivyTransaction(
          { to: quote.asset, data: approvalData },
          privyReference("approve", placement.receiptId),
        ),
      );
      const receipt = await provider.waitForTransaction(approvalTx, 1, 120_000);
      if (receipt?.status !== 1) throw new Error("USDC approval failed");
    }
    const settlementTx = txHash(
      await sendPrivyTransaction(
        { to: settlementDeployment.address, data: settlementData },
        privyReference("settle", placement.receiptId),
      ),
    );
    const receipt = await provider.waitForTransaction(settlementTx, 1, 120_000);
    if (receipt?.status !== 1) throw new Error("Placement settlement failed");
    console.log(JSON.stringify({ approvalTx, settlementTx, receiptId: placement.receiptId }));
  } finally {
    provider?.destroy();
    await store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
