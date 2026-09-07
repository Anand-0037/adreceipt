import { Router } from "express";
import { config, settlementDeployment } from "../config";
import { getProvider } from "../chain/provider";
import { queryAllReceipts, queryReceiptsByPayer } from "../receipts/by-payer";
import type { GraphSubjectEvidence } from "../receipts/graph";
import { verifyReceiptCollection } from "../receipts/ledger";
import { verifyReceipt, verifySubject } from "../receipts/service";
import { privyReadiness } from "../privy/client";
import { asyncRoute, badRequest, notFound, parseAddress } from "./errors";

import { ZeroHash } from "ethers";
import { getAdvertiser, getChallenge } from "../chain/reads";
import { submitDomainVerification } from "../chain/writes";
import { buildRecord } from "../dns/record";
import { checkDomain } from "../dns/verify";
import {
  authorisationMessage,
  checkAuthorisation,
  CONTROL_COPY,
  isRecordable,
  normaliseDomain,
  SIGNATURE_TTL_SECONDS,
} from "../domain/control";

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

async function loadVerifiedCollection(load: () => Promise<GraphSubjectEvidence>) {
  if (!config.graphQueryUrl || !config.settlementAddress) {
    throw new Error("Receipt ledger providers are not configured");
  }
  return verifyReceiptCollection(await load());
}

/** Latest verified receipts paid by one address. This endpoint never writes. */
routes.get(
  "/payers/:address/receipts",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    try {
      const collection = await loadVerifiedCollection(() =>
        queryReceiptsByPayer(config.graphQueryUrl, config.graphApiKey, address),
      );
      return res.json({ address, ...collection });
    } catch {
      return res.status(503).json({
        error: "ledger-unavailable",
        message: "The Graph and canonical RPC evidence could not be verified.",
      });
    }
  }),
);

/** Latest verified sponsorship receipts with deterministic payer/publisher totals. */
routes.get(
  "/receipts",
  asyncRoute(async (_req, res) => {
    try {
      const collection = await loadVerifiedCollection(() =>
        queryAllReceipts(config.graphQueryUrl, config.graphApiKey),
      );
      const byPayer = new Map<string, { paid: bigint; placements: number }>();
      const byPublisher = new Map<string, { earned: bigint; placements: number }>();
      let total = 0n;

      for (const receipt of collection.receipts) {
        const amount = BigInt(receipt.amount);
        total += amount;

        const payer = receipt.payer.toLowerCase();
        const payerTotal = byPayer.get(payer) ?? { paid: 0n, placements: 0 };
        byPayer.set(payer, {
          paid: payerTotal.paid + amount,
          placements: payerTotal.placements + 1,
        });

        const publisher = receipt.publisher.toLowerCase();
        const publisherTotal = byPublisher.get(publisher) ?? { earned: 0n, placements: 0 };
        byPublisher.set(publisher, {
          earned: publisherTotal.earned + amount,
          placements: publisherTotal.placements + 1,
        });
      }

      const sponsors = [...byPayer].map(([address, value]) => ({ address, ...value }));
      sponsors.sort((a, b) => (a.paid === b.paid ? 0 : a.paid > b.paid ? -1 : 1));
      const publishers = [...byPublisher].map(([address, value]) => ({ address, ...value }));
      publishers.sort((a, b) => (a.earned === b.earned ? 0 : a.earned > b.earned ? -1 : 1));

      return res.json({
        ...collection,
        totalAmount: total.toString(),
        sponsors: sponsors.map(({ address, paid, placements }) => ({
          address,
          paid: paid.toString(),
          placements,
        })),
        publishers: publishers.map(({ address, earned, placements }) => ({
          address,
          earned: earned.toString(),
          placements,
        })),
      });
    } catch {
      return res.status(503).json({
        error: "ledger-unavailable",
        message: "The Graph and canonical RPC evidence could not be verified.",
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// Domain control
//
// Reading is public because DNS is public; writing is signed because it spends
// gas and touches an identity. A negative result is never written on-chain -
// see backend/src/domain/control.ts for why that rule is load-bearing.
// ---------------------------------------------------------------------------

/**
 * The current claim and a live DNS check. Read-only, unauthenticated, no gas.
 *
 * Live rather than cached on purpose: DNS is a public source anyone can query,
 * so re-reading it now is stronger evidence than replaying a verdict we stored
 * earlier, and it cannot go stale.
 */
routes.get(
  "/advertisers/:address/domain",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const advertiser = await getAdvertiser(address);

    if (advertiser.challenge === ZeroHash || !advertiser.domain) {
      return res.json({
        address,
        registered: false,
        state: "not-registered" as const,
        message: CONTROL_COPY["not-registered"],
      });
    }

    const record = buildRecord(advertiser.domain, advertiser.challenge);
    const result = await checkDomain(address);

    const state =
      result.outcome === "verified"
        ? ("controlled" as const)
        : result.outcome === "record-mismatch"
          ? ("record-mismatch" as const)
          : result.outcome === "record-missing"
            ? ("record-missing" as const)
            : ("undetermined" as const);

    return res.json({
      address,
      registered: true,
      name: advertiser.name,
      domain: normaliseDomain(advertiser.domain),
      // What the registry currently holds, which may lag a live DNS change.
      recordedOnChain: advertiser.status === 2,
      state,
      message: CONTROL_COPY[state],
      recordable: isRecordable(state),
      checkedAt: result.checkedAt,
      record,
      resolversAnswered: result.lookup?.reachable ?? 0,
    });
  }),
);

/** The message a wallet signs to authorise recording its own proof. */
routes.get(
  "/advertisers/:address/domain/authorisation",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const advertiser = await getAdvertiser(address);
    if (!advertiser.domain) throw notFound("not-registered", "This wallet has no claim.");

    const issuedAt = Math.floor(Date.now() / 1000);
    return res.json({
      address,
      domain: normaliseDomain(advertiser.domain),
      issuedAt,
      expiresInSeconds: SIGNATURE_TTL_SECONDS,
      message: authorisationMessage({ address, domain: advertiser.domain, issuedAt }),
    });
  }),
);

/**
 * Record a successful proof on-chain.
 *
 * Writes only when the check passes right now, and only when the wallet whose
 * identity is affected has signed for it. Anything else returns 200 with
 * `attested: false` - a failure to prove control is not an event worth
 * recording, and recording it would revoke the advertiser.
 */
routes.post(
  "/advertisers/:address/domain/attest",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const { issuedAt, signature } = (req.body ?? {}) as {
      issuedAt?: number;
      signature?: string;
    };

    if (!signature || typeof issuedAt !== "number") {
      throw badRequest(
        "authorisation-required",
        "Recording a proof needs a wallet signature. Fetch the authorisation message, sign it, and send it back.",
      );
    }

    const advertiser = await getAdvertiser(address);
    if (advertiser.challenge === ZeroHash || !advertiser.domain) {
      throw notFound("not-registered", "This wallet has no claim.");
    }

    const auth = checkAuthorisation({
      address,
      domain: advertiser.domain,
      issuedAt,
      signature,
    });
    if (!auth.ok) throw badRequest("bad-authorisation", auth.reason ?? "Invalid signature.");

    const result = await checkDomain(address);
    if (result.outcome !== "verified") {
      const state =
        result.outcome === "record-mismatch"
          ? ("record-mismatch" as const)
          : result.outcome === "record-missing"
            ? ("record-missing" as const)
            : ("undetermined" as const);
      // Deliberately not an error, and deliberately not a write.
      return res.json({
        address,
        attested: false,
        state,
        message: CONTROL_COPY[state],
      });
    }

    // Re-read at the last moment: a claim changed during the lookup would make
    // this proof belong to a domain the advertiser no longer claims.
    const current = await getChallenge(address);
    if (current !== result.challenge) {
      throw badRequest(
        "challenge-changed",
        "The claim changed while checking. Publish the new record and try again.",
      );
    }

    const receipt = await submitDomainVerification(address, true, current, result.checkedAt);

    return res.json({
      address,
      attested: true,
      state: "controlled" as const,
      message: "Domain control recorded on-chain.",
      transaction: receipt,
    });
  }),
);
