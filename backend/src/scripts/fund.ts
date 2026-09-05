import { Wallet, formatEther, parseEther } from "ethers";
import { getProvider } from "../chain/provider";
import { config } from "../config";

/**
 * Top up the working keys from the deployer.
 *
 * Three keys do three jobs and are deliberately separate:
 *
 *   deployer    holds DEFAULT_ADMIN_ROLE on every contract. Never leaves this
 *               machine, never goes near the backend.
 *   simulator   holds SIMULATOR_ROLE and pays for attestations. Lives in the
 *               backend's environment, so a leak costs attestations rather than
 *               admin control.
 *   advertiser  a throwaway that registers a claim, so the demo has a subject
 *               that is not one of the two privileged keys.
 *
 * Usage:
 *   npm run fund -- --dry-run          show balances and what would be sent
 *   npm run fund                       top up anything below its floor
 *   npm run fund -- --amount 0.01      override the top-up size
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const amountArg = args.includes("--amount") ? args[args.indexOf("--amount") + 1] : undefined;

/** Enough to register, verify and fund a placement, with room for retries. */
const DEFAULT_TOPUP = parseEther(amountArg ?? "0.006");
/** Below this, a key is considered unable to do its job. */
const FLOOR = parseEther("0.002");
/** Never leave the deployer below this - it still has redeploys to pay for. */
const DEPLOYER_RESERVE = parseEther("0.01");

interface Target {
  label: string;
  address: string;
}

async function main() {
  const provider = getProvider();

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  const deployer = new Wallet(deployerKey, provider);

  const targets: Target[] = [];

  if (config.simulatorPrivateKey) {
    targets.push({
      label: "simulator",
      address: new Wallet(config.simulatorPrivateKey).address,
    });
  }
  if (process.env.TEST_ADVERTISER_PRIVATE_KEY) {
    targets.push({
      label: "advertiser",
      address: new Wallet(process.env.TEST_ADVERTISER_PRIVATE_KEY).address,
    });
  }

  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`deployer  ${deployer.address}`);
  console.log(`          ${formatEther(deployerBalance)} ETH\n`);

  if (targets.length === 0) {
    console.log("No target keys configured. Nothing to do.");
    return;
  }

  let spend = 0n;
  const plan: { target: Target; amount: bigint; balance: bigint }[] = [];

  for (const target of targets) {
    const balance = await provider.getBalance(target.address);
    const needsTopUp = balance < FLOOR;
    console.log(`${target.label.padEnd(11)} ${target.address}`);
    console.log(`            ${formatEther(balance)} ETH  ${needsTopUp ? "-> below floor" : "ok"}`);
    if (needsTopUp) {
      plan.push({ target, amount: DEFAULT_TOPUP, balance });
      spend += DEFAULT_TOPUP;
    }
  }

  if (plan.length === 0) {
    console.log("\nEverything is funded. Nothing to send.");
    return;
  }

  console.log(`\nwould send ${formatEther(spend)} ETH across ${plan.length} key(s)`);

  if (deployerBalance - spend < DEPLOYER_RESERVE) {
    console.log(
      `REFUSING: that would leave the deployer below its ${formatEther(DEPLOYER_RESERVE)} ETH ` +
        "reserve, which is held back for redeploys.",
    );
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("dry run - nothing sent");
    return;
  }

  for (const { target, amount } of plan) {
    const tx = await deployer.sendTransaction({ to: target.address, value: amount });
    const receipt = await tx.wait();
    console.log(`  sent ${formatEther(amount)} ETH to ${target.label}  tx ${receipt?.hash}`);
  }

  console.log(`\ndeployer now ${formatEther(await provider.getBalance(deployer.address))} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
