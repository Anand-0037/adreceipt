import { Router } from "express";
import { config, settlementDeployment } from "../config";
import { getProvider } from "../chain/provider";
import { asyncRoute, badRequest } from "./errors";
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
    const atBlock =
      typeof atBlockRaw === "string" ? Number(atBlockRaw) : undefined;
    if (
      atBlock !== undefined &&
      (!Number.isSafeInteger(atBlock) || atBlock <= 0)
    )
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
