import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { Contract } from "ethers";
import { contracts, deployment } from "../config";
import { PLACEMENT_ESCROW_ABI } from "./abi";
import { escrow, getProvider, registry } from "./provider";
import { Tier, getBadge, type Badge } from "./reads";

/**
 * Multi-advertiser reads.
 *
 * These are the queries a chat UI actually makes - "who is verified in this
 * category, and at what tier" - which every per-address route in the API cannot
 * answer.
 *
 * They are honest N+1 loops over public getters, and that is fine at demo scale
 * and wrong at real scale. The Subgraph is the correct home for this: it can
 * answer the same questions in one indexed query without touching an RPC node
 * per advertiser. Until it exists, this keeps the frontend unblocked.
 */

/** Enumerate every registered advertiser, in registration order. */
export async function listAdvertiserAddresses(): Promise<string[]> {
  const reg = registry();
  const count = Number(await reg.advertiserCount());
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    addresses.push((await reg.advertiserAt(i)) as string);
  }
  return addresses;
}

export interface ListOptions {
  /** Only advertisers currently verified. */
  verifiedOnly?: boolean;
  /**
   * Drop advertisers with a current spend tier - the "hide sponsored" toggle.
   * What remains is verified advertisers with no payment on record.
   */
  hideSponsored?: boolean;
}

function applyFilters(badges: Badge[], options: ListOptions): Badge[] {
  let out = badges;
  if (options.verifiedOnly) out = out.filter((b) => b.verified);
  if (options.hideSponsored) out = out.filter((b) => b.tier === Tier.None);
  return out;
}

export async function listBadges(options: ListOptions = {}): Promise<Badge[]> {
  const addresses = await listAdvertiserAddresses();
  const badges = await Promise.all(addresses.map((address) => getBadge(address)));
  return applyFilters(badges, options);
}

export interface CategorySummary {
  category: string;
  placements: number;
  advertisers: number;
}

interface CategoryIndex {
  lastScannedBlock: number;
  categories: Record<string, { placements: number; advertisers: string[] }>;
}

const INDEX_PATH = resolve(
  process.env.CATEGORY_INDEX_STORE ?? join(__dirname, "..", "..", ".data", "categories.json"),
);

/**
 * Blocks per `eth_getLogs` call.
 *
 * Free RPC tiers cap this hard - Alchemy's is 10 blocks, and exceeding it fails
 * the whole request rather than truncating. Small chunks are the price of not
 * requiring a paid plan to run the demo.
 */
const CHUNK = Number(process.env.LOG_CHUNK_BLOCKS ?? 10);

function loadIndex(): CategoryIndex {
  if (!existsSync(INDEX_PATH)) {
    return {
      lastScannedBlock:
        (deployment.blocks?.PlacementEscrow ?? deployment.blocks?.earliest ?? 1) - 1,
      categories: {},
    };
  }
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf8")) as CategoryIndex;
  } catch {
    return {
      lastScannedBlock:
        (deployment.blocks?.PlacementEscrow ?? deployment.blocks?.earliest ?? 1) - 1,
      categories: {},
    };
  }
}

function saveIndex(index: CategoryIndex): void {
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  const tmp = `${INDEX_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(tmp, INDEX_PATH);
}

/**
 * Discover which categories exist.
 *
 * Category labels live only in `PlacementCreated` event data: the contract
 * stores their hashes, and a hash cannot be reversed into a label. So they are
 * recovered from logs.
 *
 * The scan is chunked and its progress persisted, so the first call walks from
 * the escrow's deployment block and every later call reads only new blocks.
 * Without the cache this would re-scan the entire history on every request, at
 * ten blocks per RPC round trip.
 *
 * All of which is a long way of saying this is an indexer's job. The Subgraph
 * answers the same question in one query, and this exists to keep the frontend
 * moving until it does.
 */
export async function listCategories(): Promise<CategorySummary[]> {
  const provider = getProvider();
  const contract = new Contract(
    contracts.PlacementEscrow,
    PLACEMENT_ESCROW_ABI as unknown as string[],
    provider,
  );

  const index = loadIndex();
  const head = await provider.getBlockNumber();
  const filter = contract.filters.PlacementCreated!;

  let from = index.lastScannedBlock + 1;
  while (from <= head) {
    const to = Math.min(from + CHUNK - 1, head);
    const logs = await contract.queryFilter(filter, from, to);

    for (const log of logs) {
      const args = (log as unknown as { args?: Record<string, unknown> }).args;
      if (!args) continue;
      const category = String(args.category ?? "").toLowerCase();
      const advertiser = String(args.advertiser ?? "").toLowerCase();
      if (!category) continue;

      const entry = index.categories[category] ?? { placements: 0, advertisers: [] };
      entry.placements += 1;
      if (!entry.advertisers.includes(advertiser)) entry.advertisers.push(advertiser);
      index.categories[category] = entry;
    }

    index.lastScannedBlock = to;
    from = to + 1;
  }

  saveIndex(index);

  return Object.entries(index.categories)
    .map(([category, entry]) => ({
      category,
      placements: entry.placements,
      advertisers: entry.advertisers.length,
    }))
    .sort((a, b) => b.placements - a.placements);
}

/**
 * Badges for advertisers that have paid into a category.
 *
 * Reads the escrow's own index rather than logs, so it reflects current state.
 * Ordered by tier then placement count - the assistant needs a ranking, and
 * doing it here keeps that ranking auditable rather than something an LLM
 * invented.
 */
export async function badgesInCategory(
  category: string,
  options: ListOptions = {},
): Promise<Badge[]> {
  const esc = escrow();
  const ids = (await esc.placementsInCategory(category)) as bigint[];

  const advertisers = new Set<string>();
  for (const id of ids) {
    const placement = await esc.getPlacement(id);
    advertisers.add(String(placement.advertiser));
  }

  const badges = await Promise.all([...advertisers].map((address) => getBadge(address)));
  return applyFilters(badges, options).sort(
    (a, b) => b.tier - a.tier || b.placements - a.placements,
  );
}
