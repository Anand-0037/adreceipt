import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Keep one runtime source of truth. Every package reads the repo-root `.env`. */
const backendRoot = resolve(__dirname, "..");
const repoRoot = resolve(backendRoot, "..");

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

export interface SettlementDeployment {
  mode: "deployed";
  network: string;
  chainId: number;
  contract: "PlacementSettlementV1";
  constructor: { settlementAsset: string };
  address: string;
  deploymentBlock: number;
  deploymentTransaction: string;
  deployedAt: string;
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

function loadSettlementDeployment(): SettlementDeployment {
  const path = join(repoRoot, "deployments", `placement-settlement-${NETWORK}.json`);
  if (!existsSync(path)) {
    throw new Error(`No settlement deployment record at ${path}.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as SettlementDeployment;
}

export const settlementDeployment = loadSettlementDeployment();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const config = {
  network: NETWORK,
  chainId: deployment.chainId,
  rpcUrl: required("SEPOLIA_RPC_URL"),
  operatorRpcUrl: process.env.SEPOLIA_OPERATOR_RPC_URL ?? "",

  /**
   * The attestation key. This is deliberately NOT the deployer key: it holds
   * SIMULATOR_ROLE on the receiver and nothing else, so a leak costs us
   * attestations, not admin control of the registry.
   */
  simulatorPrivateKey: process.env.CRE_SIMULATOR_PRIVATE_KEY ?? "",

  // 8080 is a common default for local Apache/XAMPP installs, and a collision
  // there produces an EADDRINUSE that looks like our bug and is not.
  port: Number(process.env.PORT ?? 8787),

  /** Prefix for the DNS TXT record an advertiser publishes. */
  dnsRecordPrefix: process.env.DNS_RECORD_PREFIX ?? "_disclosed",
  dnsRecordKey: process.env.DNS_RECORD_KEY ?? "disclosed-verification",

  /** Resolvers queried for the challenge lookup. Agreement is required. */
  dnsResolvers: (process.env.DNS_RESOLVERS ?? "1.1.1.1,8.8.8.8").split(",").map((s) => s.trim()),
  graphQueryUrl: process.env.GRAPH_QUERY_URL ?? "",
  graphApiKey: process.env.GRAPH_API_KEY ?? "",
  graphMaxLag: Number(process.env.GRAPH_MAX_BLOCK_LAG ?? 20),
  receiptReadLimit: positiveInteger("RECEIPT_READ_LIMIT", 60),
  receiptReadWindowMs: positiveInteger("RECEIPT_READ_WINDOW_MS", 60_000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  settlementAddress: process.env.PLACEMENT_SETTLEMENT_ADDRESS ?? "",
  v2PublisherAddress: process.env.V2_PUBLISHER_ADDRESS ?? "",
  v2PayerAddress: process.env.V2_PAYER_ADDRESS ?? "",
  v2RecipientAddress: process.env.V2_RECIPIENT_ADDRESS ?? "",
  privyAppId: process.env.PRIVY_APP_ID ?? "",
  privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
  privyWalletId: process.env.PRIVY_WALLET_ID ?? "",
  privyPolicyId: process.env.PRIVY_POLICY_ID ?? "",
  privyAuthorizationPrivateKey:
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ?? process.env.PRIVATE_KEY_PRIVY ?? "",
};

export function requireSimulatorKey(): string {
  if (!config.simulatorPrivateKey) {
    throw new Error(
      "CRE_SIMULATOR_PRIVATE_KEY is not set. Attestation submission is disabled; reads still work.",
    );
  }
  return config.simulatorPrivateKey;
}
