import { Interface, type JsonRpcProvider } from "ethers";
import type { RpcEvidence } from "./verify";

const RECEIPT_INTERFACE = new Interface([
  "event ReceiptCreated(bytes32 indexed receiptId,bytes32 indexed campaignId,bytes32 indexed subjectHash,address publisher,address payer,address recipient,address asset,uint256 amount,uint64 settledAt,uint16 schemaVersion)",
]);

export async function readRpcReceipt(
  provider: JsonRpcProvider,
  transactionHash: string,
  logIndex: number,
  expectedContract: string,
): Promise<RpcEvidence> {
  const [network, transactionReceipt] = await Promise.all([
    provider.getNetwork(),
    provider.getTransactionReceipt(transactionHash),
  ]);
  if (!transactionReceipt || transactionReceipt.status !== 1) {
    throw new Error("RPC transaction receipt is missing or unsuccessful");
  }

  const log = transactionReceipt.logs.find((candidate) => candidate.index === logIndex);
  if (!log || log.address.toLowerCase() !== expectedContract.toLowerCase()) {
    throw new Error("RPC receipt does not contain the expected settlement log");
  }
  const parsed = RECEIPT_INTERFACE.parseLog(log);
  if (!parsed || parsed.name !== "ReceiptCreated") {
    throw new Error("RPC log is not ReceiptCreated");
  }
  const block = await provider.getBlock(transactionReceipt.blockNumber);
  if (!block) throw new Error("RPC block is unavailable");

  return {
    chainId: Number(network.chainId),
    receipt: {
      id: parsed.args.receiptId,
      campaignId: parsed.args.campaignId,
      subjectHash: parsed.args.subjectHash,
      publisher: parsed.args.publisher,
      payer: parsed.args.payer,
      recipient: parsed.args.recipient,
      asset: parsed.args.asset,
      amount: parsed.args.amount.toString(),
      settledAt: parsed.args.settledAt.toString(),
      schemaVersion: Number(parsed.args.schemaVersion),
      settlementContract: log.address,
      transactionHash: transactionReceipt.hash,
      logIndex: String(log.index),
      blockNumber: String(transactionReceipt.blockNumber),
      blockTimestamp: String(block.timestamp),
    },
  };
}
