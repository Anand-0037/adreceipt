import { Router } from "express";
import { ZeroHash } from "ethers";
import { config, settlementDeployment } from "../config";
import { getProvider } from "../chain/provider";
import { asyncRoute, badRequest, notFound, parseAddress } from "./errors";
import { getAdvertiser, getChallenge } from "../chain/reads";
import { submitDomainVerification } from "../chain/writes";
import { buildRecord } from "../dns/record";
import { checkDomain, isAttestable } from "../dns/verify";
import { queryReceiptsByPayer } from "../receipts/by-payer";
import { verifyReceipt, verifySubject } from "../receipts/service";
import { privyReadiness } from "../privy/client";

export const routes = Router();

/**
 * Public V1 readiness. Configuration is reported separately from provider
 * proof so clients never mistake a populated environment variable for a live
 * integration check.
 */
routes.get(
  "/health",
  asyncRoute(async (_req, res) => {
    const provider = getProvider();
    const block = await provider.getBlockNumber();
    return res.json({
      ok: true,
      network: config.network,
      chainId: config.chainId,
      block,
      settlement: {
        address: settlementDeployment.address,
        asset: settlementDeployment.constructor.settlementAsset,
        deploymentBlock: settlementDeployment.deploymentBlock,
        deploymentTransaction: settlementDeployment.deploymentTransaction,
      },
      graph: { configured: Boolean(config.graphQueryUrl) },
      privy: privyReadiness(),
    });
  }),
);

routes.get("/deployment", (_req, res) => res.json(settlementDeployment));

routes.get("/health/privy", (_req, res) => res.json(privyReadiness()));

routes.get(
  "/receipts/:receiptId",
  asyncRoute(async (req, res) => {
    const atBlockRaw = req.query.atBlock;
    const atBlock = typeof atBlockRaw === "string" ? Number(atBlockRaw) : undefined;
    if (atBlock !== undefined && (!Number.isSafeInteger(atBlock) || atBlock <= 0))
      throw badRequest("invalid-block", "atBlock must be a positive integer");
    const result = await verifyReceipt(req.params.receiptId, atBlock);
    return res.status(result.status === "UNAVAILABLE" ? 503 : 200).json(result);
  }),
);

routes.get(
  "/subjects/:subjectHash",
  asyncRoute(async (req, res) => {
    const result = await verifySubject(req.params.subjectHash);
    return res.status(result.status === "UNAVAILABLE" ? 503 : 200).json(result);
  }),
);

// ---------------------------------------------------------------------------
// Advertiser identity
//
// The domain proof is what makes a payer someone rather than an address. The
// logic lives in ../dns and ../chain and predates the V1 settlement path; these
// routes re-expose it so the advertiser dashboard can drive it, without
// duplicating any of it.
// ---------------------------------------------------------------------------

/** The DNS record an advertiser must publish, read live from the chain. */
routes.get(
  "/advertisers/:address/challenge",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const advertiser = await getAdvertiser(address);

    if (advertiser.challenge === ZeroHash || !advertiser.domain) {
      throw notFound(
        "not-registered",
        "No advertiser claim for this address. Register a name and domain first.",
      );
    }

    return res.json({
      address,
      name: advertiser.name,
      domain: advertiser.domain,
      status: advertiser.statusLabel,
      verified: advertiser.status === 2,
      challenge: advertiser.challenge,
      record: buildRecord(advertiser.domain, advertiser.challenge),
    });
  }),
);

/**
 * Run the DNS check and record the verdict.
 *
 * `?dryRun=true` performs the lookup without writing, which is what the UI
 * polls while an advertiser waits for propagation - it costs no gas and cannot
 * revoke anything.
 */
routes.post(
  "/advertisers/:address/verify",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const dryRun = req.query.dryRun === "true";

    const result = await checkDomain(address);

    if (result.outcome === "not-registered") {
      throw notFound("not-registered", "No advertiser claim for this address.");
    }

    if (!isAttestable(result)) {
      // No resolver could be reached. That establishes nothing, so writing
      // `false` would revoke a legitimate claim over a network problem.
      return res.status(503).json({
        address,
        outcome: result.outcome,
        verified: false,
        attested: false,
        message: "No resolver could be reached. Nothing was written on-chain.",
      });
    }

    if (dryRun) return res.json({ ...result, attested: false, dryRun: true });

    // Re-read at the last moment: if the claim changed during the lookup, this
    // verdict belongs to a claim that no longer exists.
    const current = await getChallenge(address);
    if (current !== result.challenge) {
      throw badRequest(
        "challenge-changed",
        "The claim changed during verification. Publish the new record and retry.",
      );
    }

    const receipt = await submitDomainVerification(
      address,
      result.verified,
      result.challenge,
      result.checkedAt,
    );

    return res.json({ ...result, attested: true, transaction: receipt });
  }),
);

/** Everything this advertiser has paid for. */
routes.get(
  "/advertisers/:address/receipts",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);

    if (!config.graphQueryUrl) {
      throw badRequest("graph-not-configured", "GRAPH_QUERY_URL is not set.");
    }

    const evidence = await queryReceiptsByPayer(
      config.graphQueryUrl,
      config.graphApiKey ?? "",
      address,
    );

    return res.json({
      address,
      count: evidence.receipts.length,
      receipts: evidence.receipts,
      indexedBlock: evidence.blockNumber,
      hasIndexingErrors: evidence.hasIndexingErrors,
    });
  }),
);
