/**
 * Client for the Disclosed backend.
 *
 * Every value the UI renders comes from here, and everything here comes from a
 * contract read on Sepolia. Nothing in the interface is computed in the browser
 * and nothing is mocked - if the badge says Moderate, a tier attestation exists
 * on-chain saying so.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8787";

export type TierLabel = "none" | "minimal" | "moderate" | "major";

export type AdvertiserStatus = "not-in-registry" | "pending" | "verified" | "revoked";

export interface Badge {
  address: string;
  inRegistry: boolean;
  verified: boolean;
  status: AdvertiserStatus;
  name: string;
  domain: string;
  ensName: string;
  tier: number;
  tierLabel: TierLabel;
  placements: number;
  registeredAt: number;
  accountAgeDays: number;
}

export interface CategorySummary {
  category: string;
  placements: number;
  advertisers: number;
}

export interface ChallengeRecord {
  name: string;
  type: "TXT";
  value: string;
  instructions: string[];
}

export interface Health {
  ok: boolean;
  network: string;
  chainId: number;
  block: number;
  contracts: Record<string, string>;
  attestationKey: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    // Chain state changes under us; a cached badge is a wrong badge.
    cache: "no-store",
    ...init,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? "unknown",
      (body as { message?: string }).message ?? response.statusText,
    );
  }
  return body as T;
}

export const api = {
  health: () => get<Health>("/health"),

  advertisers: (options: { verified?: boolean; hideSponsored?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (options.verified) query.set("verified", "true");
    if (options.hideSponsored) query.set("hideSponsored", "true");
    const suffix = query.toString() ? `?${query}` : "";
    return get<{ count: number; advertisers: Badge[] }>(`/advertisers${suffix}`);
  },

  categories: () => get<{ count: number; categories: CategorySummary[] }>("/categories"),

  advertisersInCategory: (
    category: string,
    options: { verified?: boolean; hideSponsored?: boolean } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.verified) query.set("verified", "true");
    if (options.hideSponsored) query.set("hideSponsored", "true");
    const suffix = query.toString() ? `?${query}` : "";
    return get<{ category: string; count: number; advertisers: Badge[] }>(
      `/categories/${encodeURIComponent(category)}/advertisers${suffix}`,
    );
  },

  badge: (address: string) => get<Badge>(`/advertisers/${address}/status`),

  flag: (address: string) => get<{ address: string; flagged: boolean }>(`/advertisers/${address}/flag`),

  challenge: (address: string) =>
    get<{
      address: string;
      name: string;
      domain: string;
      status: AdvertiserStatus;
      challenge: string;
      record: ChallengeRecord;
    }>(`/advertisers/${address}/challenge`),

  verify: (address: string, dryRun = false) =>
    get<{
      advertiser: string;
      outcome: string;
      verified: boolean;
      attested: boolean;
      transaction?: { hash: string; blockNumber: number };
    }>(`/advertisers/${address}/verify${dryRun ? "?dryRun=true" : ""}`, { method: "POST" }),
};

/** Sepolia explorer links, so any claim in the UI can be checked independently. */
export const explorer = {
  address: (address: string) => `https://sepolia.etherscan.io/address/${address}`,
  tx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
};
