import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Contract, Wallet, ZeroHash, formatEther } from "ethers";
import { contracts, deployment } from "../config";
import { getProvider } from "../chain/provider";
import {
  ADVERTISER_REGISTRY_ABI,
  PLACEMENT_ESCROW_ABI,
  SUBNAME_REGISTRY_ABI,
} from "../chain/abi";
import { Tier, TIER_LABEL, getBadge } from "../chain/reads";
import { submitTierAttestation } from "../chain/writes";
import { StaleWindowError, computeTier, redact } from "../tiers/compute";
import { recordWindow } from "../tiers/window";
import { SEED_LOCK_DURATION, SEED_MAJOR_FROM, SEED_MIN_PLACEMENT, SEED_MODERATE_FROM } from "../seed/cast";
import { seedWallets } from "../seed/wallets";

/**
 * Fund the cast's placements and attest their tiers.
 *
 * Run after seed:identity - a placement is only possible once an advertiser is
 * verified, which is the ordering the whole system rests on.
 *
 *   npm run seed:spend            perform it
 *   npm run seed:spend -- --dry   read current state, write nothing
 */

const dryRun = process.argv.includes("--dry");
const ENV_PATH = join(__dirname, "..", "..", ".env");

const log = (step: string, detail = "") => console.log(`  ${step.padEnd(22)}${detail}`);

/**
 * Pin the tier bands to the demo scale.
 *
 * The seed deposits fractions of a milli-ether, so the default bands - which
 * assume real money - would put every advertiser in Minimal. Writing them into
 * .env keeps the seed, the API and the badges reading the same numbers, rather
 * than the seed computing one tier and the backend reporting another.
 */
function pinDemoBands(): void {
  const wanted: Record<string, string> = {
    TIER_MODERATE_FROM: formatEther(SEED_MODERATE_FROM),
    TIER_MAJOR_FROM: formatEther(SEED_MAJOR_FROM),
  };

  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const missing = Object.entries(wanted).filter(([key]) => !process.env[key]);
  if (missing.length === 0) return;

  const needsNewline = current !== "" && !current.endsWith("\n");
  const block = missing.map(([k, v]) => `${k}=${v}`).join("\n");
  appendFileSync(ENV_PATH, `${needsNewline ? "\n" : ""}# demo tier bands, scaled to seed amounts\n${block}\n`);
  for (const [k, v] of missing) process.env[k] = v;

  log("tier bands", `pinned ${missing.map(([k, v]) => `${k}=${v}`).join(", ")} in backend/.env`);
}

async function main() {
  pinDemoBands();

  const provider = getProvider();
  const wallets = seedWallets();

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY is required for the operator calls");
  const deployer = new Wallet(deployerKey, provider);

  const registry = new Contract(contracts.AdvertiserRegistry, ADVERTISER_REGISTRY_ABI as unknown as string[], provider);
  const escrowRead = new Contract(contracts.PlacementEscrow, PLACEMENT_ESCROW_ABI as unknown as string[], provider);
  const escrowAdmin = new Contract(contracts.PlacementEscrow, PLACEMENT_ESCROW_ABI as unknown as string[], deployer);
  const subnames = new Contract(contracts.DisclosedSubnameRegistry, SUBNAME_REGISTRY_ABI as unknown as string[], provider);

  console.log("Seeding spend\n");

  // ── 1. Scale the escrow to the demo ──────────────────────────────────────
  console.log("1. Escrow parameters");
  const lock = (await escrowRead.lockDuration()) as bigint;
  const min = (await escrowRead.minPlacement()) as bigint;
  log("current", `lock=${lock}s  minPlacement=${formatEther(min)} ETH`);

  if (!dryRun) {
    if (lock !== BigInt(SEED_LOCK_DURATION)) {
      // 7 days is right for production and impossible to demo: a withdrawal
      // cannot be shown on stage. This is mutable precisely so it can be tuned.
      await (await escrowAdmin.setLockDuration(SEED_LOCK_DURATION)).wait();
      log("", `lockDuration -> ${SEED_LOCK_DURATION}s, so a withdrawal is demoable`);
    }
    if (min !== SEED_MIN_PLACEMENT) {
      await (await escrowAdmin.setMinPlacement(SEED_MIN_PLACEMENT)).wait();
      log("", `minPlacement -> ${formatEther(SEED_MIN_PLACEMENT)} ETH`);
    }
  } else {
    log("would set", `lock=${SEED_LOCK_DURATION}s  minPlacement=${formatEther(SEED_MIN_PLACEMENT)} ETH`);
  }

  // ── 2. Placements ────────────────────────────────────────────────────────
  console.log("\n2. Placements");
  for (const { member, wallet, address } of wallets) {
    const wanted = member.placements.reduce((n, p) => n + p.count, 0);

    // Verification is checked first so an unverified advertiser is reported for
    // the reason that actually applies: it is barred from paying, not merely
    // choosing not to.
    if (!(await registry.isVerified(address))) {
      log(member.key, "not verified, so it cannot pay - as designed");
      continue;
    }
    if (wanted === 0) {
      log(member.key, "funds nothing - the 'no payment on record' case");
      continue;
    }
    const existing = Number(await escrowRead.placementCount(address));
    if (existing >= wanted) {
      log(member.key, `already has ${existing} placement(s)`);
      continue;
    }
    if (dryRun) {
      log(member.key, `would fund ${wanted - existing} placement(s)`);
      continue;
    }

    const escrowAsMember = new Contract(
      contracts.PlacementEscrow,
      PLACEMENT_ESCROW_ABI as unknown as string[],
      wallet,
    );
    let made = existing;
    for (const spec of member.placements) {
      for (let i = made; i < spec.count; i++) {
        await (await escrowAsMember.createPlacement(spec.category, { value: spec.amount })).wait();
        made += 1;
      }
    }
    log(member.key, `funded ${made} placement(s), ${formatEther(await escrowRead.lifetimeDeposited(address))} ETH total`);
  }

  // ── 3. Tiers ─────────────────────────────────────────────────────────────
  // Computed the real way: the exact figure is summed here and only the band is
  // written on-chain. Same code path the confidential handler uses.
  console.log("\n3. Tier attestations");
  for (const { member, address } of wallets) {
    if (!(await registry.isVerified(address))) {
      log(member.key, "not verified - no tier");
      continue;
    }
    try {
      const computation = await computeTier(address);
      if (computation.tier === Tier.None) {
        log(member.key, "no spend in the window - nothing to attest");
        continue;
      }
      if (dryRun) {
        log(member.key, `would attest ${TIER_LABEL[computation.tier]} (exact figure stays local)`);
        continue;
      }
      const receipt = await submitTierAttestation(
        address,
        computation.tier,
        computation.windowStart,
        computation.windowEnd,
      );
      recordWindow(address, computation.windowEnd, computation.tier);
      log(member.key, `${TIER_LABEL[computation.tier]}  tx ${receipt.hash}`);
      log("", `emitted ${JSON.stringify(redact(computation))}`);
    } catch (error) {
      if (error instanceof StaleWindowError) {
        log(member.key, "window has not advanced - already attested");
      } else {
        throw error;
      }
    }
  }

  // ── 4. Mirror tiers into the ENS records ─────────────────────────────────
  console.log("\n4. ENS record refresh");
  for (const { member, address } of wallets) {
    if ((await subnames.nodeOf(address)) === ZeroHash) {
      log(member.key, "no name");
      continue;
    }
    if (dryRun) {
      log(member.key, "would sync records");
      continue;
    }
    // Permissionless: every value it writes is already public on-chain.
    const subnamesWrite = new Contract(
      contracts.DisclosedSubnameRegistry,
      SUBNAME_REGISTRY_ABI as unknown as string[],
      deployer,
    );
    await (await subnamesWrite.syncRecords(address)).wait();
    log(member.key, "records synced");
  }

  // ── 5. Record what the demo cast is ──────────────────────────────────────
  console.log("\nFinal badges\n");
  const badges = [];
  for (const { member, address } of wallets) {
    const badge = await getBadge(address);
    badges.push({ key: member.key, demonstrates: member.demonstrates, ...badge });
    console.log(
      `  ${member.key.padEnd(12)} ${badge.status.padEnd(16)} tier=${badge.tierLabel.padEnd(9)} ` +
        `placements=${String(badge.placements).padStart(2)}  ${badge.ensName || "-"}`,
    );
  }

  if (!dryRun) {
    const dir = join(__dirname, "..", "..", "..", "deployments");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "seed.json");
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          network: deployment.network,
          chainId: deployment.chainId,
          seededAt: new Date().toISOString(),
          note: "All brands are fictional and all figures illustrative. Domain verdicts for the verified advertisers are seeded, not DNS-proven; HostFast's rejection is real.",
          bands: {
            moderateFrom: SEED_MODERATE_FROM.toString(),
            majorFrom: SEED_MAJOR_FROM.toString(),
          },
          cast: badges,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nwrote ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
