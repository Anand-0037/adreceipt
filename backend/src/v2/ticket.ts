import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, resolve } from "node:path";
import { promisify } from "node:util";
import {
  AbiCoder,
  getAddress,
  hexlify,
  id,
  isAddress,
  isHexString,
  keccak256,
  randomBytes,
  TypedDataEncoder,
  verifyTypedData,
} from "ethers";
import { settlementDeployment } from "../config";
import type { CampaignRecord, ContextDecision, PublicContext } from "./campaign";
import { hashContextEnvelope } from "./campaign";

const runFile = promisify(execFile);
const abi = AbiCoder.defaultAbiCoder();

export function creSimulationArguments(args: {
  projectRoot: string;
  configPath: string;
  envPath: string;
}): string[] {
  return [
    "--project-root",
    args.projectRoot,
    "workflow",
    "simulate",
    "placement-authorization",
    "--target",
    "staging-settings",
    "--config",
    args.configPath,
    "--env",
    args.envPath,
    "--non-interactive",
    "--trigger-index",
    "0",
  ];
}

export const SUBJECT_TYPES = {
  SubjectV1: [
    { name: "publisher", type: "address" },
    { name: "placementId", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "disclosureVersion", type: "uint16" },
  ],
} as const;

export const QUOTE_TYPES = {
  PlacementQuoteV1: [
    { name: "schemaVersion", type: "uint16" },
    { name: "campaignId", type: "bytes32" },
    { name: "subjectHash", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "settlementContract", type: "address" },
  ],
} as const;

export const TICKET_TYPES = {
  PlacementTicketV2: [
    { name: "schemaVersion", type: "uint16" },
    { name: "ticketNonce", type: "bytes32" },
    { name: "campaignId", type: "bytes32" },
    { name: "campaignRevisionHash", type: "bytes32" },
    { name: "publisher", type: "address" },
    { name: "contextCommitment", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "policyCommitment", type: "bytes32" },
    { name: "policyProofLevel", type: "uint8" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "chainId", type: "uint256" },
    { name: "settlementContract", type: "address" },
  ],
} as const;

export interface PlacementTicketV2 {
  schemaVersion: 2;
  ticketNonce: string;
  campaignId: string;
  campaignRevisionHash: string;
  publisher: string;
  contextCommitment: string;
  productRefHash: string;
  contentHash: string;
  policyCommitment: string;
  policyProofLevel: 1;
  asset: string;
  amount: string;
  validUntil: string;
  chainId: string;
  settlementContract: string;
}

export interface PlacementSubjectV1 {
  publisher: string;
  placementId: string;
  productRefHash: string;
  contentHash: string;
  disclosureVersion: 2;
}

export interface PlacementQuoteV1 {
  schemaVersion: 1;
  campaignId: string;
  subjectHash: string;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  validUntil: number;
  nonce: string;
  chainId: number;
  settlementContract: string;
}

export interface AuthorizationResult {
  proofLevel: "CRE_SIMULATED";
  eligible: true;
  ticketCommitment: string;
  quoteId: string;
  campaignId: string;
  campaignRevisionHash: string;
  subjectHash: string;
  contextCommitment: string;
  policyCommitment: string;
  policyProofLevel: 1;
  simulation: { broadcast: false };
}

export interface PlacementRecord {
  placementId: string;
  decisionId: string;
  campaignId: string;
  ticket: PlacementTicketV2;
  subject: PlacementSubjectV1;
  quote: PlacementQuoteV1;
  authorization: AuthorizationResult;
  signedQuote?: {
    subject: PlacementSubjectV1;
    quote: PlacementQuoteV1;
    signature: string;
    receiptId: string;
  };
  receiptId: string;
  displayText: string;
  landingPage: string;
  status: "AUTHORIZED" | "SIGNED" | "PAID_VERIFIED" | "INVALID";
  createdAt?: string;
}

export interface PlacementMetrics {
  campaignId: string;
  verifiedPlacements: number;
  spendAtomic: string;
  impressions: number;
  clicks: number;
  ctrPercent: string | null;
  effectiveCpcAtomic: string | null;
  effectiveCpmAtomic: string | null;
}

function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${field} is invalid`);
  const normalized = getAddress(value);
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${field} must not be zero`);
  }
  return normalized;
}

function amount(value: unknown, maximum: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error("amount must be a positive atomic-unit string");
  }
  if (BigInt(value) > BigInt(maximum)) throw new Error("amount exceeds campaign maximum");
  return value;
}

function quoteDomain() {
  return {
    name: "AdReceipt",
    version: "1",
    chainId: settlementDeployment.chainId,
    verifyingContract: settlementDeployment.address,
  };
}

function hashTicket(ticket: PlacementTicketV2): string {
  return TypedDataEncoder.hashStruct("PlacementTicketV2", TICKET_TYPES as never, {
    ...ticket,
    amount: BigInt(ticket.amount),
    validUntil: BigInt(ticket.validUntil),
    chainId: BigInt(ticket.chainId),
  });
}

function publicContext(decision: ContextDecision): Omit<PublicContext, "contextCommitment"> {
  const { contextCommitment: _commitment, ...context } = decision.context;
  return context;
}

function privatePolicyJson(args: {
  campaign: CampaignRecord;
  decision: ContextDecision;
  publisher: string;
  payer: string;
  recipient: string;
  commitmentSalt: string;
}): string {
  const manifest = args.campaign.manifest;
  return JSON.stringify({
    allowedProductRefHashes: [id(manifest.productRef)],
    maxBid: manifest.maxPlacementAmount,
    campaignId: manifest.campaignId,
    campaignRevisionHash: manifest.campaignRevisionHash,
    allowedTopics: manifest.targetTopics,
    allowedIntents: manifest.targetIntents,
    publisher: args.publisher,
    payer: args.payer,
    recipient: args.recipient,
    asset: manifest.settlementAsset,
    chainId: String(settlementDeployment.chainId),
    settlementContract: settlementDeployment.address,
    commitmentSalt: args.commitmentSalt,
    contextSalt: args.decision.privateSalt,
  });
}

function policyCommitment(rawPolicy: string, salt: string): string {
  return keccak256(abi.encode(["bytes32", "bytes32"], [keccak256(Buffer.from(rawPolicy)), salt]));
}

async function simulateCre(config: Record<string, unknown>, rawPolicy: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "adreceipt-cre-"));
  const configPath = resolve(directory, "config.json");
  const envPath = resolve(directory, ".env");
  const repoRoot = resolve(__dirname, "../../..");
  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await writeFile(envPath, `CRE_CAMPAIGN_POLICY_JSON='${rawPolicy}'\n`, { mode: 0o600 });
    const childEnv = { ...process.env };
    if (process.env.CRE_CREDENTIALS_BASE64 || process.env.CRE_CONTEXT_BASE64) {
      if (!process.env.CRE_CREDENTIALS_BASE64 || !process.env.CRE_CONTEXT_BASE64) {
        throw new Error("CRE_SIMULATION_UNAVAILABLE");
      }
      const home = resolve(directory, "home");
      const creHome = resolve(home, ".cre");
      await mkdir(creHome, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(creHome, "cre.yaml"),
        Buffer.from(process.env.CRE_CREDENTIALS_BASE64, "base64"),
        { mode: 0o600 },
      );
      await writeFile(
        resolve(creHome, "context.yaml"),
        Buffer.from(process.env.CRE_CONTEXT_BASE64, "base64"),
        { mode: 0o600 },
      );
      childEnv.HOME = home;
    }
    const configuredCreCli = process.env.CRE_CLI_PATH || "cre";
    const creCli = configuredCreCli === "cre" ? configuredCreCli : resolve(configuredCreCli);
    if (creCli !== "cre") {
      childEnv.PATH = `${dirname(creCli)}${delimiter}${childEnv.PATH ?? ""}`;
    }
    // CRE_CLI_PATH belongs to the host application, not the CRE CLI. Keep it
    // out of Viper's environment lookup and pass the project root explicitly.
    delete childEnv.CRE_CLI_PATH;
    const creProjectRoot = resolve(repoRoot, "cre");
    const { stdout } = await runFile(
      creCli,
      creSimulationArguments({ projectRoot: creProjectRoot, configPath, envPath }),
      {
        cwd: creProjectRoot,
        env: childEnv,
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const match = stdout.match(
      /eligible=(true|false) ticketCommitment=(0x[0-9a-f]{64}) quoteId=(0x[0-9a-f]{64}) policyCommitment=(0x[0-9a-f]{64})/i,
    );
    if (!match) throw new Error("CRE_SIMULATION_UNAVAILABLE");
    return {
      eligible: match[1] === "true",
      ticketCommitment: match[2].toLowerCase(),
      quoteId: match[3].toLowerCase(),
      policyCommitment: match[4].toLowerCase(),
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: string;
      stderr?: string;
      stdout?: string;
    };
    const stderr = failure.stderr ?? "";
    const diagnostic = stderr.toLowerCase();
    const category =
      failure.code === "ENOENT"
        ? "CLI_NOT_FOUND"
        : failure.killed || failure.signal
          ? "CLI_TIMEOUT"
          : /unauth|login|token|credential|401|403/.test(diagnostic)
            ? "AUTHENTICATION"
            : /config|yaml|target|context/.test(diagnostic)
              ? "CONFIGURATION"
              : /compile|build|wasm|bun/.test(diagnostic)
                ? "COMPILATION"
                : /network|connect|timeout|dns/.test(diagnostic)
                  ? "NETWORK"
                  : "UNKNOWN";
    console.error("CRE simulation failed", {
      category,
      code: failure.code ?? null,
      signal: failure.signal ?? null,
      stdoutBytes: Buffer.byteLength(failure.stdout ?? ""),
      stderrBytes: Buffer.byteLength(stderr),
      indicators: {
        bun: /\bbun\b/.test(diagnostic),
        missing: /not found|no such file|does not exist/.test(diagnostic),
        permission: /permission denied|operation not permitted/.test(diagnostic),
        authentication: /unauth|login|token|credential|401|403/.test(diagnostic),
        configuration: /config|yaml|target|context/.test(diagnostic),
        compilation: /compile|build|wasm/.test(diagnostic),
        network: /network|connect|timeout|dns/.test(diagnostic),
        executable: /executable|fork\/exec/.test(diagnostic),
        workflow: /workflow|main\.ts/.test(diagnostic),
        dependencies: /node_modules|package\.json|module/.test(diagnostic),
        credentialsFile: /cre\.yaml|context\.yaml/.test(diagnostic),
        directory: /directory|path/.test(diagnostic),
        cliPath: stderr.includes(resolve(process.env.CRE_CLI_PATH || "cre")),
        projectPath: stderr.includes(resolve(repoRoot, "cre")),
        configPath: stderr.includes(configPath),
        envPath: stderr.includes(envPath),
        temporaryHome: stderr.includes(resolve(directory, "home")),
      },
    });
    throw new Error("CRE_SIMULATION_UNAVAILABLE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function preparePlacement(args: {
  decision: ContextDecision;
  campaign: CampaignRecord;
  publisher: unknown;
  payer: unknown;
  recipient: unknown;
  amount: unknown;
  now?: number;
}): Promise<PlacementRecord> {
  if (args.decision.status !== "ELIGIBLE" || !args.decision.winner) {
    throw new Error("DECISION_NOT_ELIGIBLE");
  }
  if (
    args.decision.winner.campaignId !== args.campaign.manifest.campaignId ||
    args.decision.winner.revision !== args.campaign.manifest.revision ||
    args.campaign.manifest.status !== "ACTIVE"
  ) {
    throw new Error("CAMPAIGN_DECISION_MISMATCH");
  }
  if (!args.campaign.advertiserSignature) throw new Error("CAMPAIGN_NOT_AUTHORIZED");

  const publisher = address(args.publisher, "publisher");
  const payer = address(args.payer, "payer");
  const recipient = address(args.recipient, "recipient");
  if (payer === recipient) throw new Error("payer and recipient must differ");
  const atomicAmount = amount(args.amount, args.campaign.manifest.maxPlacementAmount);
  const now = args.now ?? Math.floor(Date.now() / 1_000);
  const validUntil = now + 2 * 60 * 60;
  const commitmentSalt = hexlify(randomBytes(32));

  const recomputedContext = hashContextEnvelope(
    publicContext(args.decision),
    args.decision.privateSalt,
  );
  if (recomputedContext.toLowerCase() !== args.decision.context.contextCommitment.toLowerCase()) {
    throw new Error("CONTEXT_COMMITMENT_MISMATCH");
  }

  const rawPolicy = privatePolicyJson({
    campaign: args.campaign,
    decision: args.decision,
    publisher,
    payer,
    recipient,
    commitmentSalt,
  });
  const policyHash = policyCommitment(rawPolicy, commitmentSalt);
  const displayText = `${args.campaign.manifest.creativeHeadline}\n${args.campaign.manifest.creativeBody}`;
  const ticket: PlacementTicketV2 = {
    schemaVersion: 2,
    ticketNonce: hexlify(randomBytes(32)),
    campaignId: args.campaign.manifest.campaignId,
    campaignRevisionHash: args.campaign.manifest.campaignRevisionHash,
    publisher,
    contextCommitment: args.decision.context.contextCommitment,
    productRefHash: id(args.campaign.manifest.productRef),
    contentHash: id(displayText),
    policyCommitment: policyHash,
    policyProofLevel: 1,
    asset: args.campaign.manifest.settlementAsset,
    amount: atomicAmount,
    validUntil: String(validUntil),
    chainId: String(settlementDeployment.chainId),
    settlementContract: settlementDeployment.address,
  };
  const ticketCommitment = hashTicket(ticket);
  const subject: PlacementSubjectV1 = {
    publisher,
    placementId: ticketCommitment,
    productRefHash: ticket.productRefHash,
    contentHash: ticket.contentHash,
    disclosureVersion: 2,
  };
  const subjectHash = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);
  const quote: PlacementQuoteV1 = {
    schemaVersion: 1,
    campaignId: ticket.campaignId,
    subjectHash,
    payer,
    recipient,
    asset: ticket.asset,
    amount: ticket.amount,
    validUntil,
    nonce: hexlify(randomBytes(32)),
    chainId: settlementDeployment.chainId,
    settlementContract: settlementDeployment.address,
  };
  const quoteId = TypedDataEncoder.hash(quoteDomain(), QUOTE_TYPES as never, quote);
  const context = {
    schemaVersion: 2,
    topics: args.decision.context.topics,
    intent: args.decision.context.intent,
    commercialIntentBand: args.decision.context.commercialIntentBand,
    coarseLocale: args.decision.context.coarseLocale,
    surface: args.decision.context.surface,
    ageEligibility: args.decision.context.ageEligibility,
    sensitiveClass: args.decision.context.sensitiveClass,
    personalization: false,
  };
  const creConfig = {
    schedule: "0 */1 * * * *",
    schemaVersion: 1,
    quoteId,
    campaignId: quote.campaignId,
    subjectHash,
    subject,
    payer,
    recipient,
    asset: quote.asset,
    amount: quote.amount,
    chainId: String(quote.chainId),
    settlementContract: quote.settlementContract,
    validUntil: String(quote.validUntil),
    nonce: quote.nonce,
    policySecretId: "CAMPAIGN_POLICY",
    ticket,
    context,
  };
  const simulated = await simulateCre(creConfig, rawPolicy);
  if (
    !simulated.eligible ||
    simulated.ticketCommitment !== ticketCommitment.toLowerCase() ||
    simulated.quoteId !== quoteId.toLowerCase() ||
    simulated.policyCommitment !== policyHash.toLowerCase()
  ) {
    throw new Error("CRE_POLICY_DECLINED");
  }

  return {
    placementId: ticketCommitment,
    decisionId: args.decision.decisionId,
    campaignId: ticket.campaignId,
    ticket,
    subject,
    quote,
    authorization: {
      proofLevel: "CRE_SIMULATED",
      eligible: true,
      ticketCommitment,
      quoteId,
      campaignId: quote.campaignId,
      campaignRevisionHash: ticket.campaignRevisionHash,
      subjectHash,
      contextCommitment: ticket.contextCommitment,
      policyCommitment: policyHash,
      policyProofLevel: 1,
      simulation: { broadcast: false },
    },
    receiptId: quoteId,
    displayText,
    landingPage: args.campaign.manifest.landingPage,
    status: "AUTHORIZED",
  };
}

export function attachPublisherSignature(
  placement: PlacementRecord,
  signature: unknown,
): PlacementRecord {
  if (typeof signature !== "string" || !isHexString(signature, 65)) {
    throw new Error("publisher signature is invalid");
  }
  const recovered = verifyTypedData(
    quoteDomain(),
    QUOTE_TYPES as never,
    placement.quote,
    signature,
  );
  if (getAddress(recovered) !== getAddress(placement.subject.publisher)) {
    throw new Error("publisher signature does not match the ticket");
  }
  return {
    ...placement,
    status: "SIGNED",
    signedQuote: {
      subject: placement.subject,
      quote: placement.quote,
      signature,
      receiptId: placement.receiptId,
    },
  };
}
