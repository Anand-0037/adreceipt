import deployment from "../../deployments/placement-settlement-sepolia.json";
import legacyDeployment from "../../deployments/sepolia.json";

/** Public protocol coordinates come from the deployment artifact used by the backend. */
export const protocol = Object.freeze({
  chainId: deployment.chainId,
  network: deployment.network,
  settlement: deployment.address,
  asset: deployment.constructor.settlementAsset,
  deploymentBlock: deployment.deploymentBlock,
  advertiserRegistry: legacyDeployment.contracts.AdvertiserRegistry,
});
