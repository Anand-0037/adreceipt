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
query ReceiptsByPayer($payer: Bytes!, $first: Int = 26) {
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
      variables: { payer: payer.toLowerCase(), first: 26 },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  return parseGraphSubjectResponse(await response.json());
}

/**
 * Every receipt, newest first.
 *
 * This is the public ledger the project exists to produce: who paid whom, how
 * much, for which recommendation. Per-receipt verification answers "is this one
 * real"; only the full list answers "how much sponsorship is happening here at
 * all", which is the question a user or a regulator actually has.
 */
const ALL_QUERY = `
query AllReceipts($first: Int = 26) {
  receipts(first: $first, orderBy: blockNumber, orderDirection: desc) {
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
    block { number hash timestamp }
    hasIndexingErrors
  }
}
`;

export async function queryAllReceipts(
  endpoint: string,
  apiKey: string,
  first = 26,
): Promise<GraphSubjectEvidence> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query: ALL_QUERY, variables: { first } }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  return parseGraphSubjectResponse(await response.json());
}

const CAMPAIGN_QUERY = `
query ReceiptsByCampaign($campaignId: Bytes!, $first: Int = 101) {
  receipts(
    first: $first
    where: { campaignId: $campaignId }
    orderBy: blockNumber
    orderDirection: desc
  ) {
    id campaignId subjectHash publisher payer recipient asset amount settledAt
    schemaVersion settlementContract transactionHash logIndex blockNumber blockTimestamp
  }
  _meta { block { number hash timestamp } hasIndexingErrors }
}
`;

export async function queryReceiptsByCampaign(
  endpoint: string,
  apiKey: string,
  campaignId: string,
): Promise<GraphSubjectEvidence> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query: CAMPAIGN_QUERY,
      variables: { campaignId: campaignId.toLowerCase(), first: 101 },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
  return parseGraphSubjectResponse(await response.json());
}
