import { parseGraphSubjectResponse, type GraphSubjectEvidence } from "./graph";

/**
 * Receipts filtered by payer.
 *
 * The advertiser dashboard needs "what have I paid for", which neither the
 * by-id nor the by-subject query answers. Same entity shape as the subject
 * query, so `parseGraphSubjectResponse` is reused rather than duplicated - if
 * the receipt schema changes, both paths break together instead of one drifting
 * silently.
 */
const PAYER_QUERY = `
query ReceiptsByPayer($payer: Bytes!, $first: Int = 25) {
  receipts(
    first: $first
    where: { payer: $payer }
    orderBy: blockNumber
    orderDirection: desc
  ) {
    id
    campaignId
    subjectHash
    publisher
    payer
    recipient
    asset
    amount
    settledAt
    schemaVersion
    settlementContract
    transactionHash
    logIndex
    blockNumber
    blockTimestamp
  }
  _meta {
    block {
      number
      hash
      timestamp
    }
    hasIndexingErrors
  }
}
`;

export async function queryReceiptsByPayer(
  endpoint: string,
  apiKey: string,
  payer: string,
): Promise<GraphSubjectEvidence> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      // The Graph stores addresses lowercased; a checksummed argument matches nothing.
      query: PAYER_QUERY,
      variables: { payer: payer.toLowerCase(), first: 25 },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  return parseGraphSubjectResponse(await response.json());
}
