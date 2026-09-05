import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

/**
 * Environment comes from `backend/.env` first, then the repo-root `.env`.
 * The root file is where the contract work already put CRE_SIMULATOR_PRIVATE_KEY,
 * so a fresh clone works without copying secrets around.
 */
const backendRoot = resolve(__dirname, "..");
const repoRoot = resolve(backendRoot, "..");

loadEnv({ path: join(backendRoot, ".env"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  admin: string;
  parameters: {
    parentName: string;
    parentNode: string;
    placementLockSeconds: number;
    minPlacementWei: string;
    tierValiditySeconds: number;
    maxAccountAgeSeconds: number;
    minPlacements: number;
  };
  /** Block each contract was deployed in. Used as a log-scan lower bound. */
  blocks?: Record<string, number>;
  contracts: {
    AdvertiserRegistry: string;
    PlacementEscrow: string;
    TierAttestation: string;
    CREAttestationReceiver: string;
    PermissionedResolver: string;
    DisclosedSubnameRegistry: string;
    SuspiciousPatternRule: string;
  };
  roles: { creForwarder: string | null; creSimulator: string | null };
}

const NETWORK = process.env.NETWORK ?? "sepolia";

/**
 * Addresses are read from the deployment record the deploy script writes, never
 * hardcoded. A redeploy therefore needs no code change here - which matters,
 * because PlacementEscrow and DisclosedSubnameRegistry are both expected to be
 * redeployed at least once before the demo.
 */
function loadDeployment(): Deployment {
  const path = join(repoRoot, "deployments", `${NETWORK}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `No deployment record at ${path}. Run the deploy script for "${NETWORK}" first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

export const deployment = loadDeployment();
export const contracts = deployment.contracts;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  network: NETWORK,
  chainId: deployment.chainId,
  rpcUrl: required("SEPOLIA_RPC_URL"),

  /**
   * The attestation key. This is deliberately NOT the deployer key: it holds
   * SIMULATOR_ROLE on the receiver and nothing else, so a leak costs us
   * attestations, not admin control of the registry.
   */
  simulatorPrivateKey: process.env.CRE_SIMULATOR_PRIVATE_KEY ?? "",

  port: Number(process.env.PORT ?? 8080),

  /** Prefix for the DNS TXT record an advertiser publishes. */
  dnsRecordPrefix: process.env.DNS_RECORD_PREFIX ?? "_disclosed",
  dnsRecordKey: process.env.DNS_RECORD_KEY ?? "disclosed-verification",

  /** Resolvers queried for the challenge lookup. Agreement is required. */
  dnsResolvers: (process.env.DNS_RESOLVERS ?? "1.1.1.1,8.8.8.8").split(",").map((s) => s.trim()),
};

export function requireSimulatorKey(): string {
  if (!config.simulatorPrivateKey) {
    throw new Error(
      "CRE_SIMULATOR_PRIVATE_KEY is not set. Attestation submission is disabled; reads still work.",
    );
  }
  return config.simulatorPrivateKey;
}
