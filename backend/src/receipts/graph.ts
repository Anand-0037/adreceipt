import { isAddress, isHexString } from "ethers";
import type { GraphEvidence, ReceiptEvidence } from "./verify";

const QUERY = `query Receipt($id: Bytes!) { receipt(id: $id) { id campaignId subjectHash publisher payer recipient asset amount settledAt schemaVersion settlementContract transactionHash logIndex blockNumber blockTimestamp } _meta { block { number } hasIndexingErrors } }`;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseReceipt(value: unknown): ReceiptEvidence | null {
  if (value === null) return null;
  const receipt = object(value);
  if (!receipt) throw new Error("Graph receipt is not an object");

  const bytes32 = ["id", "campaignId", "subjectHash", "transactionHash"];
  const addresses = ["publisher", "payer", "recipient", "asset", "settlementContract"];
  const decimals = ["amount", "settledAt", "logIndex", "blockNumber", "blockTimestamp"];
  if (!bytes32.every((key) => typeof receipt[key] === "string" && isHexString(receipt[key] as string, 32))
      || !addresses.every((key) => typeof receipt[key] === "string" && isAddress(receipt[key] as string))
      || !decimals.every((key) => typeof receipt[key] === "string" && DECIMAL.test(receipt[key] as string))
      || !["logIndex", "blockNumber", "blockTimestamp"].every((key) => Number.isSafeInteger(Number(receipt[key])))
      || !Number.isSafeInteger(receipt.schemaVersion) || Number(receipt.schemaVersion) < 0) {
    throw new Error("Graph receipt has an invalid runtime schema");
  }
  return receipt as unknown as ReceiptEvidence;
}

export function parseGraphResponse(value: unknown): GraphEvidence {
  const body = object(value);
  if (!body) throw new Error("Graph response is not an object");
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) throw new Error("Graph returned query errors");

  const data = object(body.data);
  const meta = object(data?._meta);
  const block = object(meta?.block);
  const blockNumber = block?.number;
  if (!Number.isSafeInteger(blockNumber) || Number(blockNumber) < 0
      || (meta?.hasIndexingErrors !== undefined && typeof meta.hasIndexingErrors !== "boolean")) {
    throw new Error("Graph response is missing valid metadata");
  }
  return {
    receipt: parseReceipt(data?.receipt ?? null),
    blockNumber: Number(blockNumber),
    hasIndexingErrors: meta?.hasIndexingErrors === true,
  };
}

export async function queryReceipt(endpoint: string, apiKey: string, id: string): Promise<GraphEvidence> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  return parseGraphResponse(await response.json());
}
