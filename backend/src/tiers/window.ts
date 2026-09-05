import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Remembers the last window closed for each advertiser.
 *
 * `TierAttestation.recordTier` requires `windowEnd` to strictly exceed the last
 * one recorded for that advertiser and reverts `StaleWindow` otherwise. Holding
 * that in memory means the first attestation after any restart or redeploy of
 * the backend reverts, which is exactly the kind of failure that looks like a
 * contract bug at 2am on demo day. So it goes to disk.
 *
 * The chain remains the authority - `getAttestation(advertiser).windowEnd` is
 * the real answer. This file is a cache that spares a read before every
 * submission; `reconcile` exists to repair it from chain state when it drifts.
 */
export interface WindowState {
  [advertiser: string]: {
    lastWindowEnd: number;
    lastTier: number;
    updatedAt: string;
  };
}

const STORE_PATH = resolve(
  process.env.TIER_WINDOW_STORE ?? join(__dirname, "..", "..", ".data", "tier-windows.json"),
);

function load(): WindowState {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as WindowState;
  } catch {
    // A corrupt cache must not stop attestations. Start clean; the pre-submit
    // chain read still protects against a stale window.
    return {};
  }
}

/** Write via a temp file and rename, so a crash mid-write cannot truncate it. */
function save(state: WindowState): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, STORE_PATH);
}

const key = (address: string) => address.toLowerCase();

export function getLastWindowEnd(advertiser: string): number {
  return load()[key(advertiser)]?.lastWindowEnd ?? 0;
}

export function recordWindow(advertiser: string, windowEnd: number, tier: number): void {
  const state = load();
  state[key(advertiser)] = {
    lastWindowEnd: windowEnd,
    lastTier: tier,
    updatedAt: new Date().toISOString(),
  };
  save(state);
}

/** Adopt the chain's value when it is ahead of ours, e.g. after a data loss. */
export function reconcile(advertiser: string, onChainWindowEnd: number, tier: number): void {
  if (onChainWindowEnd > getLastWindowEnd(advertiser)) {
    recordWindow(advertiser, onChainWindowEnd, tier);
  }
}

export function storePath(): string {
  return STORE_PATH;
}

export function allWindows(): WindowState {
  return load();
}
