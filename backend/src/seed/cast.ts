import { parseEther } from "ethers";
import { Tier } from "../chain/reads";

/**
 * The demo cast.
 *
 * All brands are fictional and all figures illustrative, as the submission
 * disclaimer states. The four entries exist to produce the four badge states
 * the design calls for - and one of them is deliberately never verified.
 */
export interface CastMember {
  /** Stable key, also the HD derivation index and the ENS label. */
  key: string;
  /** Brand name claimed in the registry. */
  name: string;
  /** Domain claimed. */
  domain: string;
  /** ENS label to issue, or null for an advertiser that never earns a name. */
  label: string | null;
  /**
   * What the DNS check should conclude. `rejected` means we submit a genuine
   * negative verdict - the impostor does not control the brand it claims.
   */
  verdict: "verified" | "rejected";
  /** Placements to fund, each of `amount`. */
  placements: { category: string; amount: bigint; count: number }[];
  /** Private off-chain spend, exercised by the confidential tier handler. */
  offchainSpend?: bigint;
  /** What the badge should read once seeding completes. */
  expectedTier: Tier;
  /** One line explaining what this member demonstrates. */
  demonstrates: string;
}

/**
 * Amounts are tiny on purpose.
 *
 * Sepolia ETH is scarce and the whole cast has to fit in a faucet drip, so the
 * tier bands are scaled to match (see TIER_MODERATE_FROM / TIER_MAJOR_FROM in
 * backend/.env). The bands are policy, not a property of the system - on a real
 * deployment they would be orders of magnitude higher.
 */
export const SEED_MIN_PLACEMENT = parseEther("0.0001");
export const SEED_LOCK_DURATION = 300; // 5 minutes, so a withdrawal is demoable
export const SEED_MODERATE_FROM = parseEther("0.0005");
export const SEED_MAJOR_FROM = parseEther("0.002");

export const CAST: CastMember[] = [
  {
    key: "deployco",
    name: "DeployCo",
    domain: "deployco.com",
    label: "deployco",
    verdict: "verified",
    placements: [{ category: "backend hosting", amount: parseEther("0.0001"), count: 6 }],
    expectedTier: Tier.Moderate,
    demonstrates: "Verified, paying, moderate spend - the ordinary good case.",
  },
  {
    key: "renderstack",
    name: "RenderStack",
    domain: "renderstack.com",
    label: "renderstack",
    verdict: "verified",
    placements: [],
    expectedTier: Tier.None,
    demonstrates:
      "Verified but has never paid. Proves the badge is not a pay-to-play trophy, " +
      "and gives the 'no payment on record' state that stops 'unsponsored' reading as a merit badge.",
  },
  {
    key: "quickdeploy",
    name: "QuickDeploy",
    domain: "quickdeploy.io",
    label: "quickdeploy",
    verdict: "verified",
    // Days old, many placements, top tier - the three facts the auditor rule
    // looks for. Legitimately verified: the flag is about a pattern, not fraud.
    placements: [{ category: "backend hosting", amount: parseEther("0.0002"), count: 11 }],
    expectedTier: Tier.Major,
    demonstrates: "New account placing aggressively at the top tier - trips the suspicious-pattern rule.",
  },
  {
    key: "hostfast",
    name: "DeployCo",
    domain: "hostfast.io",
    label: null,
    verdict: "rejected",
    placements: [],
    expectedTier: Tier.None,
    demonstrates:
      "Claims a brand it does not own. The DNS check fails, so it can never be verified, " +
      "never fund a placement, and never receive a name.",
  },
];

export const castByKey = (key: string): CastMember => {
  const member = CAST.find((c) => c.key === key);
  if (!member) throw new Error(`Unknown cast member "${key}"`);
  return member;
};

/** Total ETH the cast will deposit, for a funding pre-flight. */
export function totalDeposits(): bigint {
  return CAST.reduce(
    (sum, member) =>
      sum + member.placements.reduce((s, p) => s + p.amount * BigInt(p.count), 0n),
    0n,
  );
}
