import { Contract, Wallet, ZeroHash } from "ethers";
import { contracts } from "../config";
import { getProvider } from "../chain/provider";
import { ADVERTISER_REGISTRY_ABI, SUBNAME_REGISTRY_ABI } from "../chain/abi";
import { submitDomainVerification } from "../chain/writes";
import { seedWallets, type SeedWallet } from "../seed/wallets";

/**
 * Seed the demo identities: register each cast member, record a domain verdict,
 * and issue ENS subnames to the ones that pass.
 *
 * ─── An honest note about the verdicts ───────────────────────────────────────
 *
 * We do not control deployco.com, renderstack.com or quickdeploy.io, so their
 * DNS checks cannot genuinely pass. This script records `verified = true` for
 * them anyway, because the demo needs advertisers in the verified state.
 *
 * That is seeded data, not proof, and the script says so on every run. The
 * mechanism itself is real and demonstrated elsewhere: the confidential
 * workflow performs an actual DNS-over-HTTPS lookup, and the live pipeline run
 * recorded a genuine `verified = false` for a domain whose record was missing.
 *
 * HostFast is different, and deliberately so. Its verdict is not seeded: we
 * submit a genuine `true` first and let the contract reject it, because
 * DeployCo already holds the brand. That rejection is the Act 2 centrepiece and
 * it is real.
 *
 *   npm run seed:identity            perform it
 *   npm run seed:identity -- --dry   read current state, write nothing
 */

const dryRun = process.argv.includes("--dry");

function log(step: string, detail = "") {
  console.log(`  ${step.padEnd(22)}${detail}`);
}

async function main() {
  const provider = getProvider();
  const wallets = seedWallets();

  const registry = new Contract(
    contracts.AdvertiserRegistry,
    ADVERTISER_REGISTRY_ABI as unknown as string[],
    provider,
  );

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY is required to issue subnames");
  const deployer = new Wallet(deployerKey, provider);
  const subnames = new Contract(
    contracts.DisclosedSubnameRegistry,
    SUBNAME_REGISTRY_ABI as unknown as string[],
    deployer,
  );

  console.log("Seeding demo identities\n");
  console.log("  NOTE: verdicts for DeployCo, RenderStack and QuickDeploy are SEEDED.");
  console.log("  We do not control those domains, so their DNS checks cannot truly pass.");
  console.log("  HostFast's rejection is real - the contract refuses it.\n");

  // ── Phase 1: register ────────────────────────────────────────────────────
  console.log("1. Registration");
  for (const { member, wallet, address } of wallets) {
    const existing = await registry.getAdvertiser(address);
    if (Number(existing.status) !== 0) {
      log(member.key, `already registered as "${existing.name}" / ${existing.domain}`);
      continue;
    }
    if (dryRun) {
      log(member.key, `would register "${member.name}" / ${member.domain}`);
      continue;
    }
    const asMember = new Contract(
      contracts.AdvertiserRegistry,
      ADVERTISER_REGISTRY_ABI as unknown as string[],
      wallet,
    );
    const receipt = await (await asMember.register(member.name, member.domain)).wait();
    log(member.key, `registered "${member.name}" / ${member.domain}  tx ${receipt.hash}`);
  }

  // ── Phase 2: domain verdicts ─────────────────────────────────────────────
  // Order matters. DeployCo must hold the brand before HostFast is attempted,
  // or the rejection we are demonstrating would not fire.
  console.log("\n2. Domain verdicts");
  const ordered = [...wallets].sort((a, b) =>
    a.member.verdict === b.member.verdict ? 0 : a.member.verdict === "verified" ? -1 : 1,
  );

  for (const { member, address } of ordered) {
    const challenge = await registry.challengeOf(address);
    if (challenge === ZeroHash) {
      log(member.key, "not registered yet - skipping");
      continue;
    }
    const alreadyVerified = (await registry.isVerified(address)) as boolean;
    if (alreadyVerified && member.verdict === "verified") {
      log(member.key, "already verified");
      continue;
    }
    if (dryRun) {
      log(member.key, `would submit verified=${member.verdict === "verified"}`);
      continue;
    }

    if (member.verdict === "rejected") {
      // Prove the block is real: submit a genuine positive verdict and let the
      // registry refuse it, because the brand is already spoken for.
      try {
        await submitDomainVerification(address, true, challenge, 0);
        log(member.key, "UNEXPECTED: impersonation was accepted");
      } catch (error) {
        const name = (error as { revert?: { name?: string } })?.revert?.name ?? "reverted";
        log(member.key, `impersonation rejected on-chain (${name}) - as designed`);
      }
      const receipt = await submitDomainVerification(address, false, challenge, 0);
      log("", `recorded verified=false  tx ${receipt.hash}`);
      continue;
    }

    const receipt = await submitDomainVerification(address, true, challenge, 0);
    log(member.key, `verified=true (seeded)  tx ${receipt.hash}`);
  }

  // ── Phase 3: ENS subnames ────────────────────────────────────────────────
  console.log("\n3. ENS subnames");
  const parent = (await subnames.parentName()) as string;
  log("parent", parent);

  for (const { member, address } of wallets) {
    if (!member.label) {
      log(member.key, "no name - never earned verification");
      continue;
    }
    const existing = (await subnames.nodeOf(address)) as string;
    if (existing !== ZeroHash) {
      log(member.key, `already named ${await subnames.nameOfAdvertiser(address)}`);
      continue;
    }
    if (dryRun) {
      log(member.key, `would issue ${member.label}.${parent}`);
      continue;
    }
    const receipt = await (await subnames.issue(member.label, address)).wait();
    log(member.key, `issued ${member.label}.${parent}  tx ${receipt.hash}`);
  }

  // ── Result ───────────────────────────────────────────────────────────────
  console.log("\nState");
  for (const { member, address } of wallets) {
    const record = await registry.getAdvertiser(address);
    const name = ((await subnames.nameOfAdvertiser(address)) as string) || "-";
    console.log(
      `  ${member.key.padEnd(12)} status=${["none", "pending", "verified", "revoked"][Number(record.status)].padEnd(9)} ens=${name}`,
    );
  }
  console.log(`\n  subnames issued: ${await subnames.issuedCount()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
