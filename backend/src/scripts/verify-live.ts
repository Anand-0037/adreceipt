import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { Contract, Wallet, formatEther, ZeroHash } from "ethers";
import { config, contracts } from "../config";
import { getProvider, hasSimulator } from "../chain/provider";
import { ADVERTISER_REGISTRY_ABI } from "../chain/abi";
import { Tier, getBadge, getChallenge } from "../chain/reads";
import { simulatorStatus, submitDomainVerification, submitTierAttestation } from "../chain/writes";
import { buildRecord } from "../dns/record";
import { checkDomain, isAttestable } from "../dns/verify";
import { StaleWindowError, computeTier, redact } from "../tiers/compute";
import { recordWindow } from "../tiers/window";

/**
 * Drives one advertiser through the whole pipeline against the live deployment:
 * registration, DNS challenge, confidential verdict, tier attestation.
 *
 * Two reasons this exists rather than a unit test. It is the only thing that
 * proves the deployed contracts, the attestation key and this code agree - the
 * test suite runs against a fresh in-memory chain and cannot catch a role that
 * was never granted or an address that drifted. And it produces the transaction
 * hashes the Chainlink submission needs as evidence.
 *
 * Usage:
 *   npm run verify:live:dry                   reads and simulations only, writes nothing
 *   npm run verify:live                       performs real transactions
 *   npm run verify:live -- --advertiser 0x..  target an existing advertiser
 *   npm run verify:live -- --seed-verdict     record a verdict DNS did not prove (demo data)
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const seedVerdict = args.includes("--seed-verdict");
const advertiserArg = args[args.indexOf("--advertiser") + 1];
const explicitAdvertiser = args.includes("--advertiser") ? advertiserArg : undefined;

const TIER_NAME = ["None", "Minimal", "Moderate", "Major"];
let failures = 0;

function step(n: number, title: string) {
  console.log(`\n${"-".repeat(70)}\n${n}. ${title}\n${"-".repeat(70)}`);
}
const ok = (m: string) => console.log(`  ok    ${m}`);
const info = (m: string) => console.log(`        ${m}`);
const warn = (m: string) => console.log(`  warn  ${m}`);
const fail = (m: string) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

async function main() {
  console.log("Disclosed - live pipeline check");
  console.log(`mode: ${dryRun ? "DRY RUN (nothing is written)" : "LIVE (transactions will be sent)"}`);

  // 1 -----------------------------------------------------------------------
  step(1, "Connectivity and deployment");
  const provider = getProvider();
  const net = await provider.getNetwork();
  const block = await provider.getBlockNumber();
  if (Number(net.chainId) !== config.chainId) {
    fail(`RPC is chain ${net.chainId}, deployment record says ${config.chainId}`);
    return;
  }
  ok(`chain ${net.chainId} at block ${block}`);
  for (const [name, address] of Object.entries(contracts)) {
    const code = await provider.getCode(address);
    code === "0x" ? fail(`${name} has no code at ${address}`) : ok(`${name} live`);
  }

  // 2 -----------------------------------------------------------------------
  step(2, "Attestation key");
  if (!hasSimulator()) {
    fail("CRE_SIMULATOR_PRIVATE_KEY is not set");
    return;
  }
  const sim = await simulatorStatus();
  info(`address ${sim.address}`);
  info(`balance ${formatEther(sim.balance)} ETH, nonce ${sim.nonce}`);
  sim.authorised ? ok("holds SIMULATOR_ROLE") : fail("does NOT hold SIMULATOR_ROLE on the receiver");
  if (BigInt(sim.balance) === 0n) fail("attestation key has no gas");

  // 3 -----------------------------------------------------------------------
  step(3, "Advertiser under test");
  const registry = new Contract(
    contracts.AdvertiserRegistry,
    ADVERTISER_REGISTRY_ABI as unknown as string[],
    provider,
  );

  let advertiser = explicitAdvertiser;
  let advertiserWallet: Wallet | undefined;

  if (!advertiser) {
    const key = process.env.TEST_ADVERTISER_PRIVATE_KEY;
    if (!key) {
      // Generate, and write the key straight into the gitignored backend/.env.
      // Never print it: stdout ends up in scrollback, CI logs and screen shares,
      // and a key that has been shown once should be treated as burned.
      const fresh = Wallet.createRandom();
      const envPath = join(__dirname, "..", "..", ".env");
      const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      const needsNewline = existing !== "" && !existing.endsWith("\n");
      appendFileSync(
        envPath,
        `${needsNewline ? "\n" : ""}TEST_ADVERTISER_PRIVATE_KEY=${fresh.privateKey}\n`,
      );
      warn("No --advertiser and no TEST_ADVERTISER_PRIVATE_KEY.");
      info(`Generated ${fresh.address}`);
      info(`Key written to ${envPath} (gitignored). Not printed here on purpose.`);
      info("Fund that address with ~0.005 ETH and re-run.");
      return;
    }
    advertiserWallet = new Wallet(key, provider);
    advertiser = advertiserWallet.address;
  }
  info(`advertiser ${advertiser}`);

  const record = await registry.getAdvertiser(advertiser);
  const registered = Number(record.status) !== 0;

  if (!registered) {
    if (!advertiserWallet) {
      fail("Not registered, and no key available to register it. Pass --advertiser or set TEST_ADVERTISER_PRIVATE_KEY.");
      return;
    }
    const balance = await provider.getBalance(advertiser);
    info(`not registered yet, balance ${formatEther(balance)} ETH`);
    if (balance === 0n) {
      fail("advertiser wallet has no gas to register with");
      return;
    }
    const name = process.env.TEST_ADVERTISER_NAME ?? "SmokeTest";
    const domain = process.env.TEST_ADVERTISER_DOMAIN ?? "smoketest.example";
    if (dryRun) {
      const sim = await registry.register.staticCall(name, domain, { from: advertiser });
      ok(`register("${name}", "${domain}") would succeed -> ${String(sim).slice(0, 14)}...`);
    } else {
      // Build a fresh instance bound to the advertiser's own wallet. The
      // backend's keys must never be the ones registering a claim.
      const asAdvertiser = new Contract(
        contracts.AdvertiserRegistry,
        ADVERTISER_REGISTRY_ABI as unknown as string[],
        advertiserWallet,
      );
      const tx = await asAdvertiser.register(name, domain);
      const receipt = await tx.wait();
      ok(`registered as "${name}" / ${domain}`);
      info(`tx ${receipt.hash}`);
    }
  } else {
    ok(`already registered: "${record.name}" / ${record.domain} (status ${record.status})`);
  }

  // 4 -----------------------------------------------------------------------
  step(4, "DNS challenge");
  const challenge = await getChallenge(advertiser);
  if (challenge === ZeroHash) {
    if (dryRun) {
      warn("No challenge yet - registration was only simulated. Re-run without --dry-run.");
      return;
    }
    fail("no challenge issued");
    return;
  }
  const current = await registry.getAdvertiser(advertiser);
  const dns = buildRecord(current.domain, challenge);
  ok(`challenge ${challenge.slice(0, 18)}...`);
  info(`publish: ${dns.name}  TXT  "${dns.value}"`);

  // 5 -----------------------------------------------------------------------
  step(5, "DNS lookup");
  const result = await checkDomain(advertiser);
  info(`resolvers reachable: ${result.lookup?.reachable ?? 0}`);
  info(`records agreed on:   ${JSON.stringify(result.lookup?.agreed ?? [])}`);
  info(`outcome:             ${result.outcome}`);
  result.verified ? ok("domain control proved") : warn(`not proved (${result.outcome})`);

  // 6 -----------------------------------------------------------------------
  step(6, "Domain attestation");
  let verdict = result.verified;
  if (seedVerdict && !verdict) {
    console.log("  !!!!  --seed-verdict: recording verified=true WITHOUT a DNS proof.");
    console.log("  !!!!  Demo seeding only. Never do this on a registry anyone relies on.");
    verdict = true;
  }

  if (!isAttestable(result) && !seedVerdict) {
    warn(`${result.outcome} is not attestable - nothing written, by design`);
  } else if (dryRun) {
    ok(`would submit verified=${verdict}`);
  } else {
    const receipt = await submitDomainVerification(advertiser, verdict, challenge, result.checkedAt);
    ok(`attested verified=${verdict}`);
    info(`tx ${receipt.hash}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
    const after = await registry.isVerified(advertiser);
    after === verdict ? ok(`registry now reports isVerified=${after}`) : fail(`registry reports ${after}`);
  }

  // 7 -----------------------------------------------------------------------
  step(7, "Tier attestation");
  try {
    const computation = await computeTier(advertiser);
    info(`window ${computation.windowStart} -> ${computation.windowEnd}`);
    info(`on-chain  ${formatEther(computation.onchainWei)} ETH   (public)`);
    info(`off-chain ${formatEther(computation.offchainWei)} ETH   (private, never published)`);
    info(`band      ${TIER_NAME[computation.tier]}`);
    info(`emitted   ${JSON.stringify(redact(computation))}`);

    if (computation.tier === Tier.None) {
      warn("no spend in the window, so there is no tier to attest");
    } else if (dryRun) {
      ok(`would submit tier=${computation.tier}`);
    } else {
      const receipt = await submitTierAttestation(
        advertiser,
        computation.tier,
        computation.windowStart,
        computation.windowEnd,
      );
      recordWindow(advertiser, computation.windowEnd, computation.tier);
      ok(`attested tier=${TIER_NAME[computation.tier]}`);
      info(`tx ${receipt.hash}`);
    }
  } catch (error) {
    if (error instanceof StaleWindowError) {
      warn("window has not advanced since the last attestation - correctly refused");
    } else {
      throw error;
    }
  }

  // 8 -----------------------------------------------------------------------
  step(8, "Badge as the assistant would render it");
  console.log(JSON.stringify(await getBadge(advertiser), null, 2));

  console.log(`\n${"=".repeat(70)}`);
  console.log(failures === 0 ? "PASS - pipeline healthy" : `FAIL - ${failures} problem(s)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nunhandled:", error);
  process.exitCode = 1;
});
