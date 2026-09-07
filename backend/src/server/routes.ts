import { Router } from "express";
import { config, settlementDeployment } from "../config";
import { getProvider } from "../chain/provider";
import { queryAllReceipts, queryReceiptsByPayer } from "../receipts/by-payer";
import type { GraphSubjectEvidence } from "../receipts/graph";
import { verifyReceiptCollection } from "../receipts/ledger";
import { verifyReceipt, verifySubject } from "../receipts/service";
import { privyReadiness } from "../privy/client";
import { asyncRoute, badRequest, parseAddress } from "./errors";

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
