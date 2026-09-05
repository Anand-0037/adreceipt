import { Wallet, formatEther } from "ethers";
import { getProvider } from "../chain/provider";
import { CAST, totalDeposits } from "../seed/cast";
import { describePlan, planFunding } from "../seed/wallets";

/**
 * Provision and fund the demo cast wallets.
 *
 * Separate from the seeding itself so funding can be checked, and retried after
 * a faucet top-up, without touching chain state. Run this until it says READY,
 * then run the seed.
 *
 *   npm run seed:wallets            show the plan, fund nothing
 *   npm run seed:wallets -- --fund  transfer from the deployer
 */

const shouldFund = process.argv.includes("--fund");

/** Deployer keeps this back for the redeploys still owed. */
const DEPLOYER_RESERVE = 10_000_000_000_000_000n; // 0.01 ETH

async function main() {
  const provider = getProvider();

  console.log("Demo cast\n");
  for (const member of CAST) {
    console.log(`  ${member.key.padEnd(12)} "${member.name}" / ${member.domain}`);
    console.log(`  ${"".padEnd(12)} ${member.demonstrates}`);
  }

  console.log(`\nTotal deposits across the cast: ${formatEther(totalDeposits())} ETH\n`);

  const plan = await planFunding();
  console.log("Funding\n");
  console.log(describePlan(plan));

  const needed = plan.reduce((sum, p) => sum + p.topUp, 0n);
  if (needed === 0n) {
    console.log("\nREADY - every cast wallet is funded. Run the seed next.");
    return;
  }

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    console.log("\nDEPLOYER_PRIVATE_KEY is not set, so funding cannot be automated.");
    console.log("Send the amounts above to each address, then re-run.");
    return;
  }

  const deployer = new Wallet(deployerKey, provider);
  const balance = await provider.getBalance(deployer.address);
  console.log(`\ndeployer ${deployer.address}  ${formatEther(balance)} ETH`);

  if (balance - needed < DEPLOYER_RESERVE) {
    console.log(
      `\nBLOCKED: funding the cast would leave the deployer below its ` +
        `${formatEther(DEPLOYER_RESERVE)} ETH reserve, which is held for redeploys.`,
    );
    console.log(`Top the deployer up by at least ${formatEther(needed + DEPLOYER_RESERVE - balance)} ETH.`);
    process.exitCode = 1;
    return;
  }

  if (!shouldFund) {
    console.log(`\nWould send ${formatEther(needed)} ETH. Re-run with --fund to do it.`);
    return;
  }

  for (const entry of plan) {
    if (entry.topUp === 0n) continue;
    const tx = await deployer.sendTransaction({ to: entry.wallet.address, value: entry.topUp });
    const receipt = await tx.wait();
    console.log(
      `  funded ${entry.wallet.member.key.padEnd(12)} ${formatEther(entry.topUp)} ETH  tx ${receipt?.hash}`,
    );
  }

  console.log(`\ndeployer now ${formatEther(await provider.getBalance(deployer.address))} ETH`);
  console.log("READY - run the seed next.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
