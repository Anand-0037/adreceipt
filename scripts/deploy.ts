import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DAY = 24 * 60 * 60;

/**
 * Deployment parameters. Overridable by environment variable so a demo
 * deployment can run on a compressed clock without editing the file.
 */
const PARENT_NAME = process.env.PARENT_NAME ?? "disclosed.eth";
const PLACEMENT_LOCK = Number(process.env.PLACEMENT_LOCK ?? 7 * DAY);
const MIN_PLACEMENT = ethers.parseEther(process.env.MIN_PLACEMENT ?? "0.001");
const TIER_VALIDITY = Number(process.env.TIER_VALIDITY ?? 30 * DAY);
const MAX_ACCOUNT_AGE = Number(process.env.MAX_ACCOUNT_AGE ?? 7 * DAY);
const MIN_PLACEMENTS = Number(process.env.MIN_PLACEMENTS ?? 10);

/**
 * The address the Chainlink CRE Forwarder will deliver reports from. Left unset
 * until the workflow is registered; the simulator key carries the demo in the
 * meantime, exactly as the track rules allow.
 */
const FORWARDER = process.env.CRE_FORWARDER ?? "";
const SIMULATOR = process.env.CRE_SIMULATOR ?? "";

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS ?? deployer.address;

  console.log(`network   ${network.name}`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`admin     ${admin}`);
  console.log(`balance   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // --- contracts -----------------------------------------------------------

  const registry = await ethers.deployContract("AdvertiserRegistry", [admin, ethers.ZeroAddress]);
  await registry.waitForDeployment();
  console.log(`AdvertiserRegistry      ${await registry.getAddress()}`);

  const escrow = await ethers.deployContract("PlacementEscrow", [
    admin,
    await registry.getAddress(),
    PLACEMENT_LOCK,
    MIN_PLACEMENT,
  ]);
  await escrow.waitForDeployment();
  console.log(`PlacementEscrow         ${await escrow.getAddress()}`);

  const tiers = await ethers.deployContract("TierAttestation", [admin, ethers.ZeroAddress, TIER_VALIDITY]);
  await tiers.waitForDeployment();
  console.log(`TierAttestation         ${await tiers.getAddress()}`);

  const receiver = await ethers.deployContract("CREAttestationReceiver", [
    admin,
    await registry.getAddress(),
    await tiers.getAddress(),
  ]);
  await receiver.waitForDeployment();
  console.log(`CREAttestationReceiver  ${await receiver.getAddress()}`);

  const resolver = await ethers.deployContract("PermissionedResolver", [admin, ethers.ZeroAddress]);
  await resolver.waitForDeployment();
  console.log(`PermissionedResolver    ${await resolver.getAddress()}`);

  const parentNode = ethers.namehash(PARENT_NAME);
  const subnames = await ethers.deployContract("DisclosedSubnameRegistry", [
    admin,
    await registry.getAddress(),
    await tiers.getAddress(),
    await resolver.getAddress(),
    parentNode,
    PARENT_NAME,
  ]);
  await subnames.waitForDeployment();
  console.log(`DisclosedSubnameRegistry ${await subnames.getAddress()}`);

  const rule = await ethers.deployContract("SuspiciousPatternRule", [
    admin,
    await registry.getAddress(),
    await escrow.getAddress(),
    await tiers.getAddress(),
    MAX_ACCOUNT_AGE,
    MIN_PLACEMENTS,
  ]);
  await rule.waitForDeployment();
  console.log(`SuspiciousPatternRule   ${await rule.getAddress()}\n`);

  // --- roles ---------------------------------------------------------------
  //
  // The receiver is the sole writer on the registry and the tier contract; the
  // subname registry is the sole controller of the resolver. Nothing else, the
  // deployer included, can write attestations or create nodes.

  console.log("wiring roles...");

  await (await registry.grantRole(await registry.ATTESTOR_ROLE(), await receiver.getAddress())).wait();
  await (await tiers.grantRole(await tiers.ATTESTOR_ROLE(), await receiver.getAddress())).wait();
  await (await resolver.grantRole(await resolver.CONTROLLER_ROLE(), await subnames.getAddress())).wait();

  if (FORWARDER) {
    await (await receiver.grantRole(await receiver.FORWARDER_ROLE(), FORWARDER)).wait();
    console.log(`  FORWARDER_ROLE -> ${FORWARDER}`);
  } else {
    console.log("  FORWARDER_ROLE  unset (grant once the CRE workflow is registered)");
  }

  if (SIMULATOR) {
    await (await receiver.grantRole(await receiver.SIMULATOR_ROLE(), SIMULATOR)).wait();
    console.log(`  SIMULATOR_ROLE -> ${SIMULATOR}`);
  } else {
    console.log("  SIMULATOR_ROLE  unset (grant to replay CRE CLI simulation output)");
  }

  // --- record --------------------------------------------------------------

  // Capture the block each contract landed in. The subgraph needs these as
  // startBlock values, and without them a backfill scans millions of empty
  // blocks before reaching anything.
  const blocks: Record<string, number> = {};
  for (const [name, contract] of Object.entries({
    AdvertiserRegistry: registry,
    PlacementEscrow: escrow,
    TierAttestation: tiers,
    CREAttestationReceiver: receiver,
    PermissionedResolver: resolver,
    DisclosedSubnameRegistry: subnames,
    SuspiciousPatternRule: rule,
  })) {
    const tx = contract.deploymentTransaction();
    const receipt = tx ? await tx.wait() : null;
    blocks[name] = receipt?.blockNumber ?? 0;
  }
  blocks.earliest = Math.min(...Object.values(blocks).filter((b) => b > 0));

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    parameters: {
      parentName: PARENT_NAME,
      parentNode,
      placementLockSeconds: PLACEMENT_LOCK,
      minPlacementWei: MIN_PLACEMENT.toString(),
      tierValiditySeconds: TIER_VALIDITY,
      maxAccountAgeSeconds: MAX_ACCOUNT_AGE,
      minPlacements: MIN_PLACEMENTS,
    },
    blocks,
    contracts: {
      AdvertiserRegistry: await registry.getAddress(),
      PlacementEscrow: await escrow.getAddress(),
      TierAttestation: await tiers.getAddress(),
      CREAttestationReceiver: await receiver.getAddress(),
      PermissionedResolver: await resolver.getAddress(),
      DisclosedSubnameRegistry: await subnames.getAddress(),
      SuspiciousPatternRule: await rule.getAddress(),
    },
    roles: {
      creForwarder: FORWARDER || null,
      creSimulator: SIMULATOR || null,
    },
  };

  const dir = join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${network.name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nwrote ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
