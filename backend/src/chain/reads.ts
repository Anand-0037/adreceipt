import { ZeroHash } from "ethers";
import { escrow, registry, rule, subnames, tiers } from "./provider";

export enum AdvertiserStatus {
  None = 0,
  Pending = 1,
  Verified = 2,
  Revoked = 3,
}

export enum Tier {
  None = 0,
  Minimal = 1,
  Moderate = 2,
  Major = 3,
}

export const TIER_LABEL: Record<Tier, string> = {
  [Tier.None]: "none",
  [Tier.Minimal]: "minimal",
  [Tier.Moderate]: "moderate",
  [Tier.Major]: "major",
};

export interface AdvertiserRecord {
  address: string;
  name: string;
  domain: string;
  challenge: string;
  registeredAt: number;
  verifiedAt: number;
  status: AdvertiserStatus;
  statusLabel: string;
}

const STATUS_LABEL: Record<AdvertiserStatus, string> = {
  [AdvertiserStatus.None]: "not-in-registry",
  [AdvertiserStatus.Pending]: "pending",
  [AdvertiserStatus.Verified]: "verified",
  [AdvertiserStatus.Revoked]: "revoked",
};

/**
 * The outstanding DNS challenge for an advertiser.
 *
 * Never cache this. `updateClaim` reissues the challenge whenever an advertiser
 * changes its name or domain, and the receiver rejects an attestation carrying a
 * stale one with `ChallengeMismatch`. Read it fresh on every verification run.
 */
export async function getChallenge(address: string): Promise<string> {
  return (await registry().challengeOf(address)) as string;
}

export async function isRegistered(address: string): Promise<boolean> {
  return (await getChallenge(address)) !== ZeroHash;
}

export async function getAdvertiser(address: string): Promise<AdvertiserRecord> {
  const a = await registry().getAdvertiser(address);
  const status = Number(a.status) as AdvertiserStatus;
  return {
    address,
    name: a.name,
    domain: a.domain,
    challenge: a.challenge,
    registeredAt: Number(a.registeredAt),
    verifiedAt: Number(a.verifiedAt),
    status,
    statusLabel: STATUS_LABEL[status],
  };
}

export async function isVerified(address: string): Promise<boolean> {
  return (await registry().isVerified(address)) as boolean;
}

/**
 * Exact spend inside a rolling window. This is the figure the confidential tier
 * workflow consumes; it must never be published as-is, only bucketed.
 */
export async function getDepositedSince(address: string, since: number): Promise<bigint> {
  return (await escrow().depositedSince(address, since)) as bigint;
}

export async function getLifetimeDeposited(address: string): Promise<bigint> {
  return (await escrow().lifetimeDeposited(address)) as bigint;
}

export async function getPlacementCount(address: string): Promise<number> {
  return Number(await escrow().placementCount(address));
}

/** The tier as the badge should show it: `None` once an attestation goes stale. */
export async function getCurrentTier(address: string): Promise<Tier> {
  return Number(await tiers().currentTierOf(address)) as Tier;
}

export async function getEnsName(address: string): Promise<string> {
  return (await subnames().nameOfAdvertiser(address)) as string;
}

export async function isFlagged(address: string): Promise<boolean> {
  return (await rule().isFlagged(address)) as boolean;
}

export interface Badge {
  address: string;
  inRegistry: boolean;
  verified: boolean;
  status: string;
  name: string;
  domain: string;
  ensName: string;
  tier: Tier;
  tierLabel: string;
  placements: number;
  registeredAt: number;
  accountAgeDays: number;
}

/**
 * Everything one disclosure badge needs, in a single round of reads.
 *
 * `flagged` is intentionally absent: it belongs to the auditor view, not the chat
 * UI, and the design says the chat must not editorialise on it.
 */
export async function getBadge(address: string): Promise<Badge> {
  const [advertiser, ensName, tier, placements] = await Promise.all([
    getAdvertiser(address),
    getEnsName(address).catch(() => ""),
    getCurrentTier(address),
    getPlacementCount(address),
  ]);

  const now = Math.floor(Date.now() / 1000);
  return {
    address,
    inRegistry: advertiser.status !== AdvertiserStatus.None,
    verified: advertiser.status === AdvertiserStatus.Verified,
    status: advertiser.statusLabel,
    name: advertiser.name,
    domain: advertiser.domain,
    ensName,
    tier,
    tierLabel: TIER_LABEL[tier],
    placements,
    registeredAt: advertiser.registeredAt,
    accountAgeDays: advertiser.registeredAt
      ? Math.floor((now - advertiser.registeredAt) / 86400)
      : 0,
  };
}
