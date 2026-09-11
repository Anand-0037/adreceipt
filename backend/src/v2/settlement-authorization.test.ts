import assert from "node:assert/strict";
import test from "node:test";
import { settleSignedPlacement } from "./settlement";
import { PROOF_LEVELS, isAuthorizedProofLevel, type ProofLevel } from "./cre-report";
import type { PlacementRecord } from "./ticket";
import type { V2Store } from "./store";

/**
 * The gate between an authorization and a transaction.
 *
 * `settleSignedPlacement` moves real test USDC. The check under test runs
 * before any provider is constructed, so an unusable authorization costs
 * nothing and reaches nothing - which is the point: `CRE_UNAVAILABLE` means the
 * confidential policy could not be consulted and `CRE_INVALID` means a report
 * arrived and failed authentication. Settling on either would be settling on no
 * decision at all.
 */

function signedPlacement(proofLevel: ProofLevel): PlacementRecord {
  const quote = {
    schemaVersion: 1 as const,
    campaignId: `0x${"a3".repeat(32)}`,
    subjectHash: `0x${"a5".repeat(32)}`,
    payer: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
    recipient: "0x5555555555555555555555555555555555555555",
    asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    amount: "500000",
    // Far future, so an expiry check can never be what rejects this.
    validUntil: 4_000_000_000,
    nonce: `0x${"a8".repeat(32)}`,
    chainId: 11155111,
    settlementContract: "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576",
  };
  const subject = {
    publisher: "0x9999999999999999999999999999999999999999",
    placementId: `0x${"a1".repeat(32)}`,
    productRefHash: `0x${"44".repeat(32)}`,
    contentHash: `0x${"bb".repeat(32)}`,
    disclosureVersion: 2 as const,
  };
  return {
    placementId: subject.placementId,
    decisionId: "11111111-1111-4111-8111-111111111111",
    campaignId: quote.campaignId,
    ticket: {} as PlacementRecord["ticket"],
    subject,
    quote,
    authorization: { proofLevel } as PlacementRecord["authorization"],
    signedQuote: {
      subject,
      quote,
      signature: `0x${"11".repeat(65)}`,
      receiptId: quote.subjectHash,
    },
    receiptId: quote.subjectHash,
    displayText: "headline\nbody",
    landingPage: "https://example.test/",
    status: "SIGNED",
  };
}

function storeReturning(placement: PlacementRecord): V2Store {
  return {
    async getPlacement() {
      return placement;
    },
  } as unknown as V2Store;
}

test("an unavailable or invalid authorization never reaches settlement", async () => {
  for (const proofLevel of PROOF_LEVELS.filter((level) => !isAuthorizedProofLevel(level))) {
    const placement = signedPlacement(proofLevel);
    await assert.rejects(
      () => settleSignedPlacement(storeReturning(placement), placement.placementId),
      /PLACEMENT_NOT_AUTHORIZED/,
      `${proofLevel} was allowed to settle`,
    );
  }
});

test("the refusal happens before any network or wallet access", async () => {
  // No RPC URL and no Privy credentials are configured in the test environment,
  // so reaching the provider would produce a different error. Getting
  // PLACEMENT_NOT_AUTHORIZED proves nothing downstream was touched.
  const placement = signedPlacement("CRE_INVALID");
  await assert.rejects(
    () => settleSignedPlacement(storeReturning(placement), placement.placementId),
    (error: Error) => error.message === "PLACEMENT_NOT_AUTHORIZED",
  );
});

test("an unsigned placement is still rejected before the proof-level check", async () => {
  // Ordering matters only so the message a caller sees names the real problem.
  const placement = { ...signedPlacement("CRE_ENFORCED"), signedQuote: undefined };
  await assert.rejects(
    () => settleSignedPlacement(storeReturning(placement), placement.placementId),
    /PLACEMENT_NOT_SIGNED/,
  );
});
