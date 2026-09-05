import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { config, contracts, requireSimulatorKey } from "../config";
import {
  ADVERTISER_REGISTRY_ABI,
  CRE_ATTESTATION_RECEIVER_ABI,
  PLACEMENT_ESCROW_ABI,
  SUBNAME_REGISTRY_ABI,
  SUSPICIOUS_PATTERN_RULE_ABI,
  TIER_ATTESTATION_ABI,
} from "./abi";

let provider: JsonRpcProvider | undefined;

export function getProvider(): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: config.network,
    });
  }
  return provider;
}

let simulator: Wallet | undefined;

/** The attestation signer. Holds SIMULATOR_ROLE on the receiver, nothing else. */
export function getSimulator(): Wallet {
  if (!simulator) {
    simulator = new Wallet(requireSimulatorKey(), getProvider());
  }
  return simulator;
}

export function hasSimulator(): boolean {
  return Boolean(config.simulatorPrivateKey);
}

const read = (address: string, abi: readonly string[]) =>
  new Contract(address, abi as unknown as string[], getProvider());

export const registry = () => read(contracts.AdvertiserRegistry, ADVERTISER_REGISTRY_ABI);
export const escrow = () => read(contracts.PlacementEscrow, PLACEMENT_ESCROW_ABI);
export const tiers = () => read(contracts.TierAttestation, TIER_ATTESTATION_ABI);
export const subnames = () => read(contracts.DisclosedSubnameRegistry, SUBNAME_REGISTRY_ABI);
export const rule = () => read(contracts.SuspiciousPatternRule, SUSPICIOUS_PATTERN_RULE_ABI);

export const receiverRead = () =>
  read(contracts.CREAttestationReceiver, CRE_ATTESTATION_RECEIVER_ABI);

/** Write-capable receiver, signed by the simulator key. */
export const receiverWrite = () =>
  new Contract(
    contracts.CREAttestationReceiver,
    CRE_ATTESTATION_RECEIVER_ABI as unknown as string[],
    getSimulator(),
  );
