import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { HDNodeWallet, Mnemonic, Wallet, formatEther, parseEther } from "ethers";
import { getProvider } from "../chain/provider";
import { CAST, type CastMember } from "./cast";

/**
 * Deterministic wallets for the demo cast.
 *
 * One mnemonic, one derivation index per cast member, so the same addresses
 * come back on every machine that has the phrase. That matters more than it
 * sounds: the frontend, the subgraph and the demo script all need to agree on
 * which address is DeployCo, and passing four separate private keys around a
 * four-person team is how keys end up in a commit.
 *
 * The phrase lives in the gitignored backend/.env and is never printed.
 */

const ENV_PATH = join(__dirname, "..", "..", ".env");
const MNEMONIC_VAR = "SEED_MNEMONIC";

/** Each cast member gets a fixed index, so order changes cannot reshuffle them. */
const DERIVATION_PATH = (index: number) => `m/44'/60'/0'/0/${index}`;

function loadOrCreateMnemonic(): string {
  const existing = process.env[MNEMONIC_VAR];
  if (existing) return existing;

  const phrase = Wallet.createRandom().mnemonic?.phrase;
  if (!phrase) throw new Error("Could not generate a mnemonic");

  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const needsNewline = current !== "" && !current.endsWith("\n");
  appendFileSync(ENV_PATH, `${needsNewline ? "\n" : ""}${MNEMONIC_VAR}="${phrase}"\n`);

  process.env[MNEMONIC_VAR] = phrase;
  return phrase;
}

export interface SeedWallet {
  member: CastMember;
  index: number;
  address: string;
  wallet: HDNodeWallet;
}

export function seedWallets(): SeedWallet[] {
  const mnemonic = Mnemonic.fromPhrase(loadOrCreateMnemonic());
  const provider = getProvider();

  return CAST.map((member, index) => {
    const wallet = HDNodeWallet.fromMnemonic(mnemonic, DERIVATION_PATH(index)).connect(provider);
    return { member, index, address: wallet.address, wallet };
  });
}

/**
 * Gas floor per cast wallet.
 *
 * Registration is ~200k and each placement ~120k, so the busiest member needs
 * roughly 1.5M gas plus its deposits. This leaves room for a retry.
 */
export function gasBudgetFor(member: CastMember): bigint {
  const placements = member.placements.reduce((n, p) => n + p.count, 0);
  const deposits = member.placements.reduce((s, p) => s + p.amount * BigInt(p.count), 0n);
  const gasUnits = 250_000n + BigInt(placements) * 150_000n;
  // Sepolia sits around 1 gwei; 5 gwei gives headroom without over-funding.
  return deposits + gasUnits * parseEther("0.000000005");
}

export interface FundingPlan {
  wallet: SeedWallet;
  balance: bigint;
  needed: bigint;
  topUp: bigint;
}

export async function planFunding(): Promise<FundingPlan[]> {
  const provider = getProvider();
  const wallets = seedWallets();

  return Promise.all(
    wallets.map(async (wallet) => {
      const balance = await provider.getBalance(wallet.address);
      const needed = gasBudgetFor(wallet.member);
      return { wallet, balance, needed, topUp: balance >= needed ? 0n : needed - balance };
    }),
  );
}

export function describePlan(plan: FundingPlan[]): string {
  const lines = plan.map(
    (p) =>
      `  ${p.wallet.member.key.padEnd(12)} ${p.wallet.address}  ` +
      `have ${formatEther(p.balance).padStart(10)}  need ${formatEther(p.needed).padStart(10)}  ` +
      (p.topUp === 0n ? "ok" : `top up ${formatEther(p.topUp)}`),
  );
  const total = plan.reduce((s, p) => s + p.topUp, 0n);
  lines.push(`  ${"".padEnd(12)} total top-up ${formatEther(total)} ETH`);
  return lines.join("\n");
}
