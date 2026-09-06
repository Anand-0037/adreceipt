import type { GraphEvidence, ReceiptEvidence } from "./verify";

const QUERY = `query Receipt($id: Bytes!) { receipt(id: $id) { id campaignId subjectHash publisher payer recipient asset amount settledAt schemaVersion settlementContract transactionHash logIndex blockNumber blockTimestamp } _meta { block { number } hasIndexingErrors } }`;

export async function queryReceipt(endpoint: string, apiKey: string, id: string): Promise<GraphEvidence> {
  const response = await fetch(endpoint, { method: "POST", headers: {
    "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }, body: JSON.stringify({ query: QUERY, variables: { id } }), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  const body = await response.json() as { data?: { receipt?: ReceiptEvidence | null; _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean } }; errors?: unknown[] };
  if (body.errors?.length || !body.data?._meta?.block?.number) throw new Error("Graph response is missing valid data or metadata");
  return { receipt: body.data.receipt ?? null, blockNumber: Number(body.data._meta.block.number), hasIndexingErrors: body.data._meta.hasIndexingErrors === true };
}
