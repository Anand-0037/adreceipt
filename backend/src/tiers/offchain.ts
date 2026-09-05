import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Off-chain spend reported privately by an advertiser.
 *
 * This exists to make the tier workflow genuinely confidential rather than
 * decoratively so.
 *
 * Escrow deposits are public: anyone can read `depositedSince` and recompute the
 * band, so an enclave that only reads the escrow protects nothing. Real
 * advertisers also spend through invoices, insertion orders and fiat rails that
 * never touch this chain, and those figures are commercially sensitive in
 * exactly the way the design assumes - a competitor who learns them can snipe a
 * budget.
 *
 * So the enclave sums the public on-chain figure with this private one and emits
 * only the band. The total cannot be reconstructed from chain state, which is
 * what makes the confidential handler load-bearing instead of ornamental.
 *
 * The store is gitignored and never served over the API. Nothing outside the
 * enclave boundary should ever read it.
 */
export interface OffchainSpendEntry {
  /** Wei-denominated, same unit as the escrow, so the two can simply be added. */
  amountWei: string;
  /** Unix seconds. Only entries inside the window are counted. */
  settledAt: number;
  /** Free-text provenance: invoice id, IO number. Never published. */
  reference?: string;
}

export interface OffchainSpendStore {
  [advertiser: string]: OffchainSpendEntry[];
}

const STORE_PATH = resolve(
  process.env.OFFCHAIN_SPEND_STORE ??
    join(__dirname, "..", "..", ".data", "offchain-spend.json"),
);

function load(): OffchainSpendStore {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as OffchainSpendStore;
  } catch {
    return {};
  }
}

function save(store: OffchainSpendStore): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, STORE_PATH);
}

const key = (address: string) => address.toLowerCase();

/** Sum private spend inside a window. Runs inside the enclave; result never leaves. */
export function offchainSpendInWindow(
  advertiser: string,
  windowStart: number,
  windowEnd: number,
): bigint {
  const entries = load()[key(advertiser)] ?? [];
  return entries
    .filter((e) => e.settledAt >= windowStart && e.settledAt <= windowEnd)
    .reduce((total, e) => total + BigInt(e.amountWei), 0n);
}

export function recordOffchainSpend(advertiser: string, entry: OffchainSpendEntry): void {
  const store = load();
  const k = key(advertiser);
  store[k] = [...(store[k] ?? []), entry];
  save(store);
}

export function hasOffchainSpend(advertiser: string): boolean {
  return (load()[key(advertiser)] ?? []).length > 0;
}

export function storePath(): string {
  return STORE_PATH;
}
