import { ZeroHash } from "ethers";
import { getAdvertiser, getChallenge } from "../chain/reads";
import { getProvider } from "../chain/provider";
import { buildRecord, matchesChallenge } from "./record";
import { resolveTxt, type LookupResult } from "./resolve";

export type VerifyOutcome =
  | "verified"
  | "record-missing"
  | "record-mismatch"
  | "not-registered"
  | "no-resolvers";

export interface VerifyResult {
  advertiser: string;
  domain: string;
  /** The challenge that was outstanding at the moment of the check. */
  challenge: string;
  expectedRecord: string;
  outcome: VerifyOutcome;
  /** The single bit that is allowed to leave the enclave. */
  verified: boolean;
  checkedAt: number;
  lookup?: LookupResult;
}

/**
 * Decide whether an advertiser controls the domain it claims.
 *
 * This is the logic that moves into the Chainlink confidential handler. Keeping
 * it in plain Node first is deliberate: the DNS answer is the thing hardest to
 * get right, and debugging it inside a TEE is far worse than debugging it here.
 * When it moves, the boundary is exactly this function - everything above it
 * (which challenge, which advertiser) stays outside, and only `verified` comes
 * back out.
 *
 * The challenge is fetched immediately before the lookup, never passed in. An
 * advertiser can call `updateClaim` at any moment, and a verdict computed
 * against the previous claim must not be applied to the new one - the receiver
 * enforces that too, but the check belongs here as well so we never even try.
 */
export async function checkDomain(advertiser: string): Promise<VerifyResult> {
  // Anchor to the chain's clock, not this machine's. The receiver rejects a
  // checkedAt greater than block.timestamp, and a server even one second fast
  // produces an attestation that reverts CheckTimestampInFuture. Block
  // timestamps are non-decreasing, so the latest block's timestamp is always a
  // safe value for the block this ends up in.
  const latest = await getProvider().getBlock("latest");
  const checkedAt = latest ? latest.timestamp : Math.floor(Date.now() / 1000);
  const record = await getAdvertiser(advertiser);
  const challenge = await getChallenge(advertiser);

  const base: Omit<VerifyResult, "outcome" | "verified"> = {
    advertiser,
    domain: record.domain,
    challenge,
    expectedRecord: "",
    checkedAt,
  };

  if (challenge === ZeroHash || !record.domain) {
    return { ...base, outcome: "not-registered", verified: false };
  }

  const expected = buildRecord(record.domain, challenge);
  const lookup = await resolveTxt(expected.name);

  const result = { ...base, expectedRecord: expected.value, lookup };

  if (lookup.reachable === 0) {
    // Could not ask anyone. That is not a failed proof, it is no proof at all,
    // and it must never be reported as a negative verdict.
    return { ...result, outcome: "no-resolvers", verified: false };
  }

  if (lookup.agreed.length === 0) {
    return { ...result, outcome: "record-missing", verified: false };
  }

  const matched = lookup.agreed.some((txt) => matchesChallenge(txt, challenge));
  return {
    ...result,
    outcome: matched ? "verified" : "record-mismatch",
    verified: matched,
  };
}

/**
 * Whether a result should be written on-chain at all.
 *
 * `no-resolvers` is excluded on purpose: an unreachable resolver says nothing
 * about the advertiser, and recording `false` would revoke a legitimate claim
 * because our network had a bad minute.
 */
export function isAttestable(result: VerifyResult): boolean {
  return result.outcome !== "no-resolvers" && result.outcome !== "not-registered";
}
