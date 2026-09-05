import { Tier, getDepositedSince } from "../chain/reads";
import { getProvider, tiers as tierContract } from "../chain/provider";
import { bands, bucket } from "./config";
import { offchainSpendInWindow } from "./offchain";
import { getLastWindowEnd, reconcile } from "./window";

/**
 * What the tier computation produces.
 *
 * Note the split. `tier`, `windowStart` and `windowEnd` are published on-chain.
 * `onchainWei`, `offchainWei` and `totalWei` are the sensitive intermediates -
 * they exist inside this function and inside the enclave, and must never be
 * logged, returned over HTTP, or written to a contract.
 */
export interface TierComputation {
  advertiser: string;
  tier: Tier;
  windowStart: number;
  windowEnd: number;
  /** Sensitive. Present for the enclave's own use and for local debugging only. */
  onchainWei: bigint;
  /** Sensitive. */
  offchainWei: bigint;
  /** Sensitive. */
  totalWei: bigint;
}

/** The publishable projection. This is what may cross the enclave boundary. */
export interface TierAttestationInput {
  advertiser: string;
  tier: Tier;
  windowStart: number;
  windowEnd: number;
}

export function redact(c: TierComputation): TierAttestationInput {
  return {
    advertiser: c.advertiser,
    tier: c.tier,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
  };
}

/**
 * Close a window against the chain's clock, not the local one.
 *
 * The contract rejects `windowEnd > block.timestamp`. A server clock even
 * slightly ahead of the chain would produce attestations that revert, so the
 * window is anchored to the latest block and pulled back by a lag margin.
 */
export async function closeWindow(): Promise<{ windowStart: number; windowEnd: number }> {
  const block = await getProvider().getBlock("latest");
  if (!block) throw new Error("Could not read the latest block");

  const windowEnd = block.timestamp - bands.windowLagSeconds;
  return { windowStart: windowEnd - bands.windowSeconds, windowEnd };
}

export class StaleWindowError extends Error {
  constructor(
    readonly advertiser: string,
    readonly windowEnd: number,
    readonly lastWindowEnd: number,
  ) {
    super(
      `Window ${windowEnd} does not advance past ${lastWindowEnd} for ${advertiser}. ` +
        "The contract would revert StaleWindow.",
    );
  }
}

/**
 * Compute an advertiser's band for the current window.
 *
 * The sum of a public figure and a private one is what makes this worth putting
 * in a TEE: the on-chain half is readable by anyone, the off-chain half is not,
 * and only the band they combine to leaves the enclave.
 */
export async function computeTier(advertiser: string): Promise<TierComputation> {
  const { windowStart, windowEnd } = await closeWindow();

  // The chain is the authority on what has already been recorded; the local
  // store is only a cache, so repair it before trusting it.
  const existing = await tierContract().getAttestation(advertiser);
  reconcile(advertiser, Number(existing.windowEnd), Number(existing.tier));

  const lastWindowEnd = getLastWindowEnd(advertiser);
  if (windowEnd <= lastWindowEnd) {
    throw new StaleWindowError(advertiser, windowEnd, lastWindowEnd);
  }

  const onchainWei = await getDepositedSince(advertiser, windowStart);
  const offchainWei = offchainSpendInWindow(advertiser, windowStart, windowEnd);
  const totalWei = onchainWei + offchainWei;

  return {
    advertiser,
    tier: bucket(totalWei),
    windowStart,
    windowEnd,
    onchainWei,
    offchainWei,
    totalWei,
  };
}
