import { Resolver } from "node:dns/promises";
import { config } from "../../src/config";
import { getDepositedSince } from "../../src/chain/reads";
import { offchainSpendInWindow } from "../../src/tiers/offchain";
import { bucket } from "../../src/tiers/config";
import type { DomainDeps, TierDeps } from "./handlers";

/**
 * Node-backed dependencies, for local runs and CRE CLI simulation.
 *
 * The enclave build swaps these for CRE's own primitives. Nothing above this
 * file changes when it does - that is the point of injecting them.
 */

async function queryOne(name: string, server: string) {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers([server]);
  try {
    const chunks = await resolver.resolveTxt(name);
    return { resolver: server, records: chunks.map((parts) => parts.join("").trim()) };
  } catch {
    return { resolver: server, records: [] as string[] };
  }
}

export const nodeDomainDeps: DomainDeps = {
  resolveTxt: (name) => Promise.all(config.dnsResolvers.map((s) => queryOne(name, s))),
  now: () => Math.floor(Date.now() / 1000),
};

export const nodeTierDeps: TierDeps = {
  onchainSpend: (advertiser, windowStart) => getDepositedSince(advertiser, windowStart),
  offchainSpend: async (advertiser, windowStart, windowEnd) =>
    offchainSpendInWindow(advertiser, windowStart, windowEnd),
  bucket,
};

/**
 * Deterministic dependencies for a reproducible simulation run.
 *
 * Useful as track evidence: the same inputs must always produce the same public
 * output, and the fixture makes that checkable without a live domain or funded
 * escrow.
 */
export function fixtureDomainDeps(records: string[], resolvers = 2): DomainDeps {
  return {
    resolveTxt: async (_name) =>
      Array.from({ length: resolvers }, (_, i) => ({ resolver: `fixture-${i}`, records })),
    now: () => 1_700_000_000,
  };
}

export function fixtureTierDeps(onchainWei: bigint, offchainWei: bigint): TierDeps {
  return {
    onchainSpend: async () => onchainWei,
    offchainSpend: async () => offchainWei,
    bucket,
  };
}
