import { getAddress, isAddress } from "ethers";
import { Router } from "express";
import { config } from "../config";
import { asyncRoute, badRequest, HttpError, notFound } from "../server/errors";
import { decideCampaign, parseCampaignInput } from "./campaign";
import { V2Store } from "./store";
import { createOrganicAnswer } from "./answer";
import { verifyReceipt } from "../receipts/service";
import { queryReceiptsByCampaign } from "../receipts/by-payer";
import { verifyReceiptCollection } from "../receipts/ledger";
import { attachPublisherSignature, preparePlacement } from "./ticket";
import { suggestCampaign } from "./agent";
import { authorizeOperator, operatorSettlementReady } from "./operator";
import { settleSignedPlacement } from "./settlement";

export const v2Routes = Router();
export const v2Store = new V2Store(config.databaseUrl);

function configuredAddress(value: string): string | null {
  if (!isAddress(value)) return null;
  const normalized = getAddress(value);
  return normalized === "0x0000000000000000000000000000000000000000" ? null : normalized;
}

const placementBindings = {
  publisher: configuredAddress(config.v2PublisherAddress),
  payer: configuredAddress(config.v2PayerAddress),
  recipient: configuredAddress(config.v2RecipientAddress),
};

function placementBindingsReady(): boolean {
  return (
    Object.values(placementBindings).every(Boolean) &&
    placementBindings.payer?.toLowerCase() !== placementBindings.recipient?.toLowerCase()
  );
}

function requirePlacementBindings(): { publisher: string; payer: string; recipient: string } {
  if (!placementBindingsReady()) {
    throw new HttpError(
      503,
      "placement-bindings-unavailable",
      "Publisher, Privy payer, and recipient bindings are not configured.",
    );
  }
  return placementBindings as { publisher: string; payer: string; recipient: string };
}

async function verifiedCampaignSpend(campaignId: string): Promise<bigint> {
  try {
    const graph = await queryReceiptsByCampaign(
      config.graphQueryUrl,
      config.graphApiKey,
      campaignId,
    );
    const verified = await verifyReceiptCollection(graph, 100);
    if (verified.hasMore) throw new Error("campaign receipt limit exceeded");
    return verified.receipts.reduce((total, receipt) => total + BigInt(receipt.amount), 0n);
  } catch {
    throw new Error("LEDGER_UNAVAILABLE");
  }
}

function storageError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message)) {
    throw new HttpError(
      503,
      "storage-unavailable",
      "Campaign storage is unavailable. Configure PostgreSQL and try again.",
    );
  }
  throw error;
}

function campaignError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "CAMPAIGN_NOT_FOUND")
    throw notFound("campaign-not-found", "Campaign revision not found.");
  if (message === "CAMPAIGN_NOT_DRAFT" || message === "CAMPAIGN_NOT_ACTIVE") {
    throw badRequest("invalid-campaign-state", message.toLowerCase().replaceAll("_", " "));
  }
  if (message === "REVISION_HASH_MISMATCH") {
    throw badRequest(
      "revision-hash-mismatch",
      "The approved hash does not match this campaign revision.",
    );
  }
  if (/signature/i.test(message)) throw badRequest("invalid-signature", message);
  throw badRequest("invalid-campaign", message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

function placementError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "CRE_SIMULATION_UNAVAILABLE") {
    throw new HttpError(
      503,
      "cre-simulation-unavailable",
      "Chainlink CRE simulation is unavailable. No placement ticket was authorized.",
    );
  }
  if (message === "LEDGER_UNAVAILABLE") {
    throw new HttpError(
      503,
      "ledger-unavailable",
      "Live Graph and RPC spend evidence is unavailable. No campaign budget was reserved.",
    );
  }
  if (message === "QUOTE_EXPIRED") {
    throw badRequest(
      "quote-expired",
      "The placement quote expired. Run the context decision again to create a fresh ticket.",
    );
  }
  if (message === "PLACEMENT_NOT_FOUND") {
    throw notFound("placement-not-found", "Placement ticket not found.");
  }
  if (message === "PLACEMENT_NOT_SIGNED") {
    throw badRequest(
      "placement-not-signed",
      "The publisher must sign the exact placement quote before settlement.",
    );
  }
  if (message === "QUOTE_ALREADY_USED") {
    throw badRequest("quote-already-used", "This placement quote has already been settled.");
  }
  if (/^PRIVY_|^PAYER_|^USDC_|^PLACEMENT_SETTLEMENT_|^RPC_TIMEOUT/.test(message)) {
    throw new HttpError(
      503,
      "settlement-unavailable",
      "The bounded Privy settlement could not be completed. No verified placement was shown.",
    );
  }
  if (message === "DECISION_NOT_FOUND") {
    throw notFound("decision-not-found", "Context decision not found.");
  }
  if (message === "PLACEMENT_NOT_VERIFIED" || message === "IMPRESSION_REQUIRED") {
    throw badRequest("measurement-not-allowed", message.toLowerCase().replaceAll("_", " "));
  }
  throw badRequest("invalid-placement", message);
}

v2Routes.get("/v2/status", (_req, res) =>
  res.json({
    schemaVersion: 2,
    storage: v2Store.configured() ? "configured" : "unavailable",
    organicAnswer: config.groqApiKey ? "configured-unverified" : "unavailable",
    policyProofLevel: "CRE_SIMULATED",
    settlement: "PlacementSettlementV1",
    placementBindings: placementBindingsReady() ? placementBindings : "unavailable",
    operatorSettlement: operatorSettlementReady(config.operatorSettlementToken)
      ? "configured"
      : "unavailable",
  }),
);

v2Routes.post(
  "/v2/answers",
  asyncRoute(async (req, res) => {
    try {
      return res.json(
        await createOrganicAnswer({
          apiKey: config.groqApiKey,
          model: config.groqModel,
          baseUrl: config.groqBaseUrl,
          query: req.body?.query,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "MODEL_UNAVAILABLE" || message === "MODEL_EMPTY_RESPONSE") {
        throw new HttpError(
          503,
          "model-unavailable",
          "The independent answer provider is unavailable. No sponsored placement was shown.",
        );
      }
      if (/query must/.test(message)) throw badRequest("invalid-query", message);
      throw new HttpError(
        503,
        "model-unavailable",
        "The independent answer provider could not complete the request. No sponsored placement was shown.",
      );
    }
  }),
);

v2Routes.post(
  "/v2/campaigns/suggest",
  asyncRoute(async (req, res) => {
    try {
      return res.json(
        await suggestCampaign({
          apiKey: config.groqApiKey,
          model: config.groqModel,
          baseUrl: config.groqBaseUrl,
          brief: req.body?.brief,
          brandDisplayName: req.body?.brandDisplayName,
          productRef: req.body?.productRef,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/BRIEF|BRAND|PRODUCT/.test(message)) throw badRequest("invalid-brief", message);
      throw new HttpError(
        503,
        "model-unavailable",
        "The campaign agent is unavailable. No targeting or creative was inferred.",
      );
    }
  }),
);

v2Routes.post(
  "/v2/placements",
  asyncRoute(async (req, res) => {
    const decisionId = req.body?.decisionId;
    if (typeof decisionId !== "string" || !UUID.test(decisionId)) {
      throw badRequest("invalid-decision", "decisionId must be a UUID.");
    }
    try {
      const decision = await v2Store.getDecision(decisionId);
      if (!decision) throw new Error("DECISION_NOT_FOUND");
      if (!decision.winner) throw new Error("DECISION_NOT_ELIGIBLE");
      const campaign = await v2Store.getCampaign(decision.winner.campaignId);
      if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
      const bindings = requirePlacementBindings();
      const prepared = await preparePlacement({
        decision,
        campaign,
        publisher: bindings.publisher,
        payer: bindings.payer,
        recipient: bindings.recipient,
        amount: req.body?.amount,
      });
      return res.status(201).json(await v2Store.savePlacement(prepared));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message)) {
        storageError(error);
      }
      placementError(error);
    }
  }),
);

v2Routes.get(
  "/v2/placements/:placementId",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.placementId)) {
      throw badRequest("invalid-placement", "placementId must be bytes32.");
    }
    try {
      const placement = await v2Store.getPlacement(req.params.placementId);
      if (!placement) throw new Error("PLACEMENT_NOT_FOUND");
      return res.json(placement);
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.get(
  "/v2/receipts/:receiptId/evidence",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.receiptId)) {
      throw badRequest("invalid-receipt", "receiptId must be bytes32.");
    }
    try {
      const placement = await v2Store.getPlacementByReceipt(req.params.receiptId);
      if (!placement) throw new Error("PLACEMENT_NOT_FOUND");
      const [decision, campaign] = await Promise.all([
        v2Store.getDecision(placement.decisionId),
        v2Store.getCampaign(placement.campaignId),
      ]);
      if (!decision || !campaign) throw new Error("PLACEMENT_EVIDENCE_INCOMPLETE");
      const { privateSalt: _privateSalt, ...publicDecision } = decision;
      return res.json({ placement, decision: publicDecision, campaign });
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.post(
  "/v2/placements/:placementId/sign",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.placementId)) {
      throw badRequest("invalid-placement", "placementId must be bytes32.");
    }
    try {
      const existing = await v2Store.getPlacement(req.params.placementId);
      if (!existing) throw new Error("PLACEMENT_NOT_FOUND");
      if (existing.quote.validUntil <= Math.floor(Date.now() / 1_000)) {
        throw new Error("QUOTE_EXPIRED");
      }
      const signed = attachPublisherSignature(existing, req.body?.signature);
      const indexedSpend = await verifiedCampaignSpend(existing.campaignId);
      return res.json(await v2Store.saveSignedPlacement(signed, indexedSpend));
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.post(
  "/v2/placements/:placementId/verify",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.placementId)) {
      throw badRequest("invalid-placement", "placementId must be bytes32.");
    }
    try {
      const placement = await v2Store.getPlacement(req.params.placementId);
      if (!placement) throw new Error("PLACEMENT_NOT_FOUND");
      if (!placement.signedQuote) throw new Error("PUBLISHER_SIGNATURE_REQUIRED");
      const verification = await verifyReceipt(placement.receiptId);
      if (verification.status === "PAID_VERIFIED") {
        const receipt = verification.evidence?.rpc?.receipt;
        const quote = placement.quote;
        const matches =
          receipt &&
          receipt.campaignId.toLowerCase() === quote.campaignId.toLowerCase() &&
          receipt.subjectHash.toLowerCase() === quote.subjectHash.toLowerCase() &&
          receipt.publisher.toLowerCase() === placement.subject.publisher.toLowerCase() &&
          receipt.payer.toLowerCase() === quote.payer.toLowerCase() &&
          receipt.recipient.toLowerCase() === quote.recipient.toLowerCase() &&
          receipt.asset.toLowerCase() === quote.asset.toLowerCase() &&
          receipt.amount === quote.amount &&
          receipt.settlementContract.toLowerCase() === quote.settlementContract.toLowerCase();
        if (!matches) {
          await v2Store.setPlacementStatus(placement.placementId, "INVALID");
          return res.json({
            placement: { ...placement, status: "INVALID" },
            verification: {
              status: "INVALID",
              reason: "Receipt evidence does not match the stored placement ticket and quote.",
              evidence: verification.evidence,
            },
          });
        }
        await v2Store.setPlacementStatus(placement.placementId, "PAID_VERIFIED");
        return res.json({
          placement: { ...placement, status: "PAID_VERIFIED" },
          verification,
        });
      }
      if (verification.status === "INVALID") {
        await v2Store.setPlacementStatus(placement.placementId, "INVALID");
      }
      return res.status(verification.status === "UNAVAILABLE" ? 503 : 200).json({
        placement:
          verification.status === "INVALID" ? { ...placement, status: "INVALID" } : placement,
        verification,
      });
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.post(
  "/v2/placements/:placementId/settle",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.placementId)) {
      throw badRequest("invalid-placement", "placementId must be bytes32.");
    }
    if (!operatorSettlementReady(config.operatorSettlementToken)) {
      throw new HttpError(
        503,
        "operator-settlement-unavailable",
        "Authenticated settlement is not configured on this deployment.",
      );
    }
    if (!authorizeOperator(req.headers.authorization, config.operatorSettlementToken)) {
      throw new HttpError(
        401,
        "operator-authorization-required",
        "A valid operator token is required.",
      );
    }
    try {
      return res.json(await settleSignedPlacement(v2Store, req.params.placementId));
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.post(
  "/v2/placements/:placementId/measurements",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.placementId)) {
      throw badRequest("invalid-placement", "placementId must be bytes32.");
    }
    if (typeof req.body?.eventId !== "string" || !UUID.test(req.body.eventId)) {
      throw badRequest("invalid-event", "eventId must be a UUID.");
    }
    if (typeof req.body?.sessionId !== "string" || !UUID.test(req.body.sessionId)) {
      throw badRequest("invalid-event", "sessionId must be a UUID.");
    }
    if (req.body?.kind !== "IMPRESSION" && req.body?.kind !== "CLICK") {
      throw badRequest("invalid-event", "kind must be IMPRESSION or CLICK.");
    }
    try {
      return res.json(
        await v2Store.recordMeasurement({
          placementId: req.params.placementId,
          eventId: req.body.eventId,
          sessionId: req.body.sessionId,
          kind: req.body.kind,
        }),
      );
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.get(
  "/v2/campaigns/:campaignId/metrics",
  asyncRoute(async (req, res) => {
    if (!BYTES32.test(req.params.campaignId)) {
      throw badRequest("invalid-campaign", "campaignId must be bytes32.");
    }
    try {
      return res.json(await v2Store.campaignMetrics(req.params.campaignId));
    } catch (error) {
      placementError(error);
    }
  }),
);

v2Routes.post(
  "/v2/campaigns",
  asyncRoute(async (req, res) => {
    try {
      const campaign = await v2Store.createCampaign(parseCampaignInput(req.body));
      return res.status(201).json(campaign);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message))
        storageError(error);
      campaignError(error);
    }
  }),
);

v2Routes.get(
  "/v2/campaigns",
  asyncRoute(async (_req, res) => {
    try {
      return res.json({ campaigns: await v2Store.listCampaigns() });
    } catch (error) {
      storageError(error);
    }
  }),
);

v2Routes.get(
  "/v2/campaigns/:campaignId",
  asyncRoute(async (req, res) => {
    try {
      const campaign = await v2Store.getCampaign(req.params.campaignId);
      if (!campaign) throw notFound("campaign-not-found", "Campaign not found.");
      return res.json(campaign);
    } catch (error) {
      storageError(error);
    }
  }),
);

v2Routes.post(
  "/v2/campaigns/:campaignId/revisions/:revision/approve",
  asyncRoute(async (req, res) => {
    const revision = Number(req.params.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw badRequest("invalid-revision", "Revision must be a positive integer.");
    }
    const { revisionHash, signature } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof revisionHash !== "string" || typeof signature !== "string") {
      throw badRequest("approval-required", "Revision hash and advertiser signature are required.");
    }
    try {
      return res.json(
        await v2Store.approveCampaign(req.params.campaignId, revision, revisionHash, signature),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message))
        storageError(error);
      campaignError(error);
    }
  }),
);

v2Routes.post(
  "/v2/campaigns/:campaignId/pause",
  asyncRoute(async (req, res) => {
    if (!Number.isSafeInteger(req.body?.validUntil) || typeof req.body?.signature !== "string") {
      throw badRequest(
        "campaign-action-required",
        "A valid expiry and advertiser action signature are required.",
      );
    }
    try {
      return res.json(
        await v2Store.pauseCampaign(
          req.params.campaignId,
          req.body?.validUntil,
          req.body?.signature,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message))
        storageError(error);
      campaignError(error);
    }
  }),
);

v2Routes.post(
  "/v2/decisions",
  asyncRoute(async (req, res) => {
    try {
      const campaigns = await v2Store.listCampaigns(true);
      const decision = decideCampaign({
        decisionId: v2Store.newDecisionId(),
        query: req.body?.query,
        ageEligibility: req.body?.ageEligibility,
        coarseLocale: req.body?.coarseLocale,
        campaigns,
      });
      await v2Store.saveDecision(decision);
      const { privateSalt: _privateSalt, ...publicDecision } = decision;
      return res.json(publicDecision);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "V2_STORAGE_UNAVAILABLE" || /ECONNREFUSED|database/i.test(message))
        storageError(error);
      throw badRequest("invalid-decision", message);
    }
  }),
);
