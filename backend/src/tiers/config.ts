import { parseEther } from "ethers";
import { Tier } from "../chain/reads";

/**
 * Spend bands.
 *
 * These are policy, not secrets - publishing them is what lets a user reason
 * about what "Moderate" means. What stays private is the figure that gets
 * bucketed, which is why the comparison happens inside the enclave and only the
 * band comes out.
 *
 * Denominated in wei of the escrow's native asset. Values are testnet-scaled: a
 * mainnet deployment would raise them by orders of magnitude.
 */
export interface TierBands {
  /** Below this: Minimal. */
  moderateFrom: bigint;
  /** At or above this: Major. */
  majorFrom: bigint;
  /** Rolling window the spend is summed over, in seconds. */
  windowSeconds: number;
  /**
   * Safety margin subtracted from the chain's latest block timestamp when
   * closing a window. The contract rejects `windowEnd > block.timestamp`, and a
   * transaction mined a block earlier than expected would otherwise revert
   * WindowInFuture.
   */
  windowLagSeconds: number;
}

function envWei(name: string, fallback: string): bigint {
  return parseEther(process.env[name] ?? fallback);
}

export const bands: TierBands = {
  moderateFrom: envWei("TIER_MODERATE_FROM", "0.1"),
  majorFrom: envWei("TIER_MAJOR_FROM", "1"),
  windowSeconds: Number(process.env.TIER_WINDOW_SECONDS ?? 30 * 24 * 60 * 60),
  windowLagSeconds: Number(process.env.TIER_WINDOW_LAG_SECONDS ?? 60),
};

/**
 * Bucket a total into a band.
 *
 * This is the only function whose input is sensitive. Everything it returns is
 * publishable; nothing it receives is. When this moves into the confidential
 * handler, this is the line the enclave boundary is drawn around.
 */
export function bucket(totalWei: bigint): Tier {
  if (totalWei <= 0n) return Tier.None;
  if (totalWei >= bands.majorFrom) return Tier.Major;
  if (totalWei >= bands.moderateFrom) return Tier.Moderate;
  return Tier.Minimal;
}

export function describeBands(): Record<string, string> {
  return {
    minimal: `0 < spend < ${bands.moderateFrom} wei`,
    moderate: `${bands.moderateFrom} <= spend < ${bands.majorFrom} wei`,
    major: `spend >= ${bands.majorFrom} wei`,
    window: `${bands.windowSeconds}s rolling`,
  };
}
