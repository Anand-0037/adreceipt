import { ethers, network } from "hardhat";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const BROADCAST_CONFIRMATION = "I_UNDERSTAND_THIS_BROADCASTS";

function configureSubgraph(address: string, startBlock: number) {
  const manifestPath = join(__dirname, "..", "subgraph", "subgraph.yaml");
  const manifest = readFileSync(manifestPath, "utf8")
    .replace(/^(\s*address:)\s*["']?[^"'\s]+["']?\s*$/m, `$1 "${address}"`)
    .replace(/^(\s*startBlock:)\s*\d+\s*$/m, `$1 ${startBlock}`);
  writeFileSync(manifestPath, manifest);
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (network.name !== "sepolia" || chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("PlacementSettlementV1 deployment is restricted to Ethereum Sepolia");
  }

  const asset = ethers.getAddress(process.env.SETTLEMENT_ASSET ?? SEPOLIA_USDC);
  if ((await ethers.provider.getCode(asset)) === "0x") {
    throw new Error(`No ERC-20 contract found at settlement asset ${asset}`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY is required");

  const factory = await ethers.getContractFactory("PlacementSettlementV1", deployer);
  const unsigned = await factory.getDeployTransaction(asset);
  if (!unsigned.data) throw new Error("Deployment bytecode is unavailable");
  const [nonce, balance, feeData, gasEstimate] = await Promise.all([
    ethers.provider.getTransactionCount(deployer.address, "pending"),
    ethers.provider.getBalance(deployer.address),
    ethers.provider.getFeeData(),
    ethers.provider.estimateGas({ from: deployer.address, data: unsigned.data }),
  ]);
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas) throw new Error("RPC did not return a usable gas price");
  const maximumCost = gasEstimate * feePerGas;
  if (balance < maximumCost) throw new Error("Deployer balance is below the estimated maximum cost");

  const predictedAddress = ethers.getCreateAddress({ from: deployer.address, nonce });
  const preflight = {
    mode: "preflight",
    network: network.name,
    chainId,
    contract: "PlacementSettlementV1",
    constructor: { settlementAsset: asset },
    deployer: deployer.address,
    deployerNonce: nonce,
    predictedAddress,
    gasEstimate: gasEstimate.toString(),
    maxFeePerGas: feePerGas.toString(),
    maximumCostWei: maximumCost.toString(),
    deployerBalanceWei: balance.toString(),
  };
  console.log(JSON.stringify(preflight, null, 2));

  if (process.env.BROADCAST_SETTLEMENT !== BROADCAST_CONFIRMATION) {
    console.log(`Preflight only. Set BROADCAST_SETTLEMENT=${BROADCAST_CONFIRMATION} after approval.`);
    return;
  }

  const settlement = await factory.deploy(asset);
  const transaction = settlement.deploymentTransaction();
  if (!transaction) throw new Error("Settlement deployment transaction is unavailable");
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Settlement deployment failed");

  const address = await settlement.getAddress();
  const runtimeCode = await ethers.provider.getCode(address);
  if (runtimeCode === "0x" || await settlement.settlementAsset() !== asset) {
    throw new Error("Deployed settlement contract failed read-back verification");
  }
  const record = {
    ...preflight,
    mode: "deployed",
    address,
    deploymentBlock: receipt.blockNumber,
    deploymentTransaction: transaction.hash,
    runtimeCodeHash: ethers.keccak256(runtimeCode),
    deployedAt: new Date().toISOString(),
  };
  const deploymentsDir = join(__dirname, "..", "deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  writeFileSync(
    join(deploymentsDir, "placement-settlement-sepolia.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  configureSubgraph(address, receipt.blockNumber);
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
