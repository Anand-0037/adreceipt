import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  buildCampaign,
  type CampaignInput,
  type CampaignManifestV2,
  type CampaignRecord,
  type ContextDecision,
  verifyCampaignAction,
  verifyCampaignApproval,
} from "./campaign";
import type { PlacementMetrics, PlacementRecord } from "./ticket";

interface RevisionRow {
  manifest: CampaignManifestV2;
  typed_data: CampaignRecord["typedData"];
  advertiser_signature: string | null;
  approved_at: Date | null;
}

interface DecisionRow {
  decision_id: string;
  status: ContextDecision["status"];
  reason_code: string;
  context: ContextDecision["context"] & { salt: string };
  winner_campaign_id: string | null;
  winner_revision: number | null;
  winner_relevance: string | null;
  rejected: ContextDecision["rejected"];
}

interface PlacementRow {
  placement_id: string;
  decision_id: string;
  campaign_id: string;
  ticket: PlacementRecord["ticket"];
  subject: PlacementRecord["subject"];
  quote: PlacementRecord["quote"];
  cre_authorization: PlacementRecord["authorization"];
  signed_quote: PlacementRecord["signedQuote"] | null;
  receipt_id: string;
  display_text: string;
  landing_page: string;
  status: PlacementRecord["status"];
  created_at: Date;
}

function placement(row: PlacementRow): PlacementRecord {
  return {
    placementId: row.placement_id,
    decisionId: row.decision_id,
    campaignId: row.campaign_id,
    ticket: row.ticket,
    subject: row.subject,
    quote: row.quote,
    authorization: row.cre_authorization,
    ...(row.signed_quote ? { signedQuote: row.signed_quote } : {}),
    receiptId: row.receipt_id,
    displayText: row.display_text,
    landingPage: row.landing_page,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

function record(row: RevisionRow): CampaignRecord {
  return {
    manifest: row.manifest,
    typedData: row.typed_data,
    ...(row.advertiser_signature ? { advertiserSignature: row.advertiser_signature } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at.toISOString() } : {}),
  };
}

export function assertCampaignBudget(args: {
  total: bigint;
  indexed: bigint;
  reserved: bigint;
  next: bigint;
}): void {
  if (Object.values(args).some((value) => value < 0n)) {
    throw new Error("CAMPAIGN_BUDGET_INVALID");
  }
  if (args.indexed + args.reserved + args.next > args.total) {
    throw new Error("CAMPAIGN_BUDGET_EXCEEDED");
  }
}

export class V2Store {
  private pool?: Pool;
  private ready?: Promise<void>;

  constructor(private readonly databaseUrl: string) {}

  configured(): boolean {
    return Boolean(this.databaseUrl);
  }

  private db(): Pool {
    if (!this.databaseUrl) throw new Error("V2_STORAGE_UNAVAILABLE");
    this.pool ??= new Pool({ connectionString: this.databaseUrl, max: 5 });
    return this.pool;
  }

  async ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      const migration = await readFile(
        join(resolve(__dirname, "../.."), "migrations", "001_v2.sql"),
        "utf8",
      );
      await this.db().query(migration);
    })();
    return this.ready;
  }

  async createCampaign(input: CampaignInput): Promise<CampaignRecord> {
    await this.ensureSchema();
    const built = buildCampaign(input);
    const client = await this.db().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO v2_campaigns
          (campaign_id, advertiser_wallet, status, current_revision)
         VALUES ($1, $2, 'DRAFT', 1)`,
        [built.manifest.campaignId, built.manifest.advertiserWallet],
      );
      await client.query(
        `INSERT INTO v2_campaign_revisions
          (campaign_id, revision, revision_hash, manifest, typed_data)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          built.manifest.campaignId,
          built.manifest.revision,
          built.manifest.campaignRevisionHash,
          JSON.stringify(built.manifest),
          JSON.stringify(built.typedData),
        ],
      );
      await client.query("COMMIT");
      return built;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async load(
    client: Pool | PoolClient,
    campaignId: string,
  ): Promise<CampaignRecord | null> {
    const result = await client.query<RevisionRow>(
      `SELECT r.manifest, r.typed_data, r.advertiser_signature, r.approved_at
         FROM v2_campaigns c
         JOIN v2_campaign_revisions r
           ON r.campaign_id = c.campaign_id AND r.revision = c.current_revision
        WHERE c.campaign_id = $1`,
      [campaignId],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    await this.ensureSchema();
    return this.load(this.db(), campaignId);
  }

  async listCampaigns(activeOnly = false): Promise<CampaignRecord[]> {
    await this.ensureSchema();
    const result = await this.db().query<RevisionRow>(
      `SELECT r.manifest, r.typed_data, r.advertiser_signature, r.approved_at
         FROM v2_campaigns c
         JOIN v2_campaign_revisions r
           ON r.campaign_id = c.campaign_id AND r.revision = c.current_revision
        ${activeOnly ? "WHERE c.status = 'ACTIVE'" : ""}
        ORDER BY c.created_at DESC`,
    );
    return result.rows.map(record);
  }

  async approveCampaign(
    campaignId: string,
    revision: number,
    revisionHash: string,
    signature: string,
  ): Promise<CampaignRecord> {
    await this.ensureSchema();
    const client = await this.db().connect();
    try {
      await client.query("BEGIN");
      const existing = await this.load(client, campaignId);
      if (!existing || existing.manifest.revision !== revision)
        throw new Error("CAMPAIGN_NOT_FOUND");
      if (existing.manifest.status !== "DRAFT") throw new Error("CAMPAIGN_NOT_DRAFT");
      if (existing.manifest.campaignRevisionHash.toLowerCase() !== revisionHash.toLowerCase()) {
        throw new Error("REVISION_HASH_MISMATCH");
      }
      verifyCampaignApproval(existing, signature);
      const manifest = { ...existing.manifest, status: "ACTIVE" as const };
      await client.query(
        `UPDATE v2_campaign_revisions
            SET advertiser_signature = $3, approved_at = now(), manifest = $4::jsonb
          WHERE campaign_id = $1 AND revision = $2`,
        [campaignId, revision, signature, JSON.stringify(manifest)],
      );
      await client.query(
        `UPDATE v2_campaigns SET status = 'ACTIVE', updated_at = now() WHERE campaign_id = $1`,
        [campaignId],
      );
      await client.query("COMMIT");
      return {
        ...existing,
        manifest,
        advertiserSignature: signature,
        approvedAt: new Date().toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pauseCampaign(
    campaignId: string,
    validUntil: unknown,
    signature: unknown,
  ): Promise<CampaignRecord> {
    await this.ensureSchema();
    const client = await this.db().connect();
    try {
      await client.query("BEGIN");
      const existing = await this.load(client, campaignId);
      if (!existing) throw new Error("CAMPAIGN_NOT_FOUND");
      if (existing.manifest.status !== "ACTIVE") throw new Error("CAMPAIGN_NOT_ACTIVE");
      verifyCampaignAction(existing, "PAUSE", validUntil, signature);
      const manifest = { ...existing.manifest, status: "PAUSED" as const };
      await client.query(
        `UPDATE v2_campaign_revisions SET manifest = $2::jsonb WHERE campaign_id = $1 AND revision = $3`,
        [campaignId, JSON.stringify(manifest), existing.manifest.revision],
      );
      await client.query(
        `UPDATE v2_campaigns SET status = 'PAUSED', updated_at = now() WHERE campaign_id = $1`,
        [campaignId],
      );
      await client.query("COMMIT");
      return { ...existing, manifest };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveDecision(decision: ContextDecision): Promise<void> {
    await this.ensureSchema();
    await this.db().query(
      `INSERT INTO v2_context_decisions
        (decision_id, status, reason_code, context, winner_campaign_id, winner_revision,
         winner_relevance, rejected)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7::numeric, $8::jsonb)`,
      [
        decision.decisionId,
        decision.status,
        decision.reasonCode,
        JSON.stringify({ ...decision.context, salt: decision.privateSalt }),
        decision.winner?.campaignId ?? null,
        decision.winner?.revision ?? null,
        decision.winner?.relevance ?? null,
        JSON.stringify(decision.rejected),
      ],
    );
  }

  async getDecision(decisionId: string): Promise<ContextDecision | null> {
    await this.ensureSchema();
    const result = await this.db().query<DecisionRow>(
      `SELECT decision_id, status, reason_code, context, winner_campaign_id,
              winner_revision, winner_relevance, rejected
         FROM v2_context_decisions
        WHERE decision_id = $1::uuid`,
      [decisionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const { salt, ...context } = row.context;
    const decision: ContextDecision = {
      decisionId: row.decision_id,
      status: row.status,
      reasonCode: row.reason_code,
      context,
      rejected: row.rejected,
      privateSalt: salt,
    };
    if (row.winner_campaign_id && row.winner_revision) {
      if (row.winner_relevance === null) throw new Error("CAMPAIGN_DECISION_MISMATCH");
      const campaign = await this.getCampaign(row.winner_campaign_id);
      if (!campaign || campaign.manifest.revision !== row.winner_revision) {
        throw new Error("CAMPAIGN_DECISION_MISMATCH");
      }
      decision.winner = {
        campaignId: row.winner_campaign_id,
        revision: row.winner_revision,
        relevance: Number(row.winner_relevance).toFixed(2),
        campaign: campaign.manifest,
      };
    }
    return decision;
  }

  async savePlacement(value: PlacementRecord): Promise<PlacementRecord> {
    await this.ensureSchema();
    await this.db().query(
      `INSERT INTO v2_placements
        (placement_id, decision_id, campaign_id, ticket, subject, quote,
         cre_authorization, receipt_id, display_text, landing_page, status)
       VALUES ($1, $2::uuid, $3, $4::jsonb, $5::jsonb, $6::jsonb,
               $7::jsonb, $8, $9, $10, $11)`,
      [
        value.placementId,
        value.decisionId,
        value.campaignId,
        JSON.stringify(value.ticket),
        JSON.stringify(value.subject),
        JSON.stringify(value.quote),
        JSON.stringify(value.authorization),
        value.receiptId,
        value.displayText,
        value.landingPage,
        value.status,
      ],
    );
    return value;
  }

  async getPlacement(placementId: string): Promise<PlacementRecord | null> {
    await this.ensureSchema();
    const result = await this.db().query<PlacementRow>(
      `SELECT placement_id, decision_id, campaign_id, ticket, subject, quote,
              cre_authorization, signed_quote, receipt_id, display_text, landing_page,
              status, created_at
         FROM v2_placements
        WHERE placement_id = $1`,
      [placementId],
    );
    return result.rows[0] ? placement(result.rows[0]) : null;
  }

  async getPlacementByReceipt(receiptId: string): Promise<PlacementRecord | null> {
    await this.ensureSchema();
    const result = await this.db().query<PlacementRow>(
      `SELECT placement_id, decision_id, campaign_id, ticket, subject, quote,
              cre_authorization, signed_quote, receipt_id, display_text, landing_page,
              status, created_at
         FROM v2_placements
        WHERE receipt_id = $1`,
      [receiptId],
    );
    return result.rows[0] ? placement(result.rows[0]) : null;
  }

  async saveSignedPlacement(
    value: PlacementRecord,
    indexedSpend: bigint,
  ): Promise<PlacementRecord> {
    if (!value.signedQuote || value.status !== "SIGNED") throw new Error("SIGNED_QUOTE_REQUIRED");
    await this.ensureSchema();
    const client = await this.db().connect();
    try {
      await client.query("BEGIN");
      const campaign = await client.query<{ manifest: CampaignManifestV2 }>(
        `SELECT r.manifest
           FROM v2_campaigns c
           JOIN v2_campaign_revisions r
             ON r.campaign_id = c.campaign_id AND r.revision = c.current_revision
          WHERE c.campaign_id = $1
          FOR UPDATE OF c`,
        [value.campaignId],
      );
      const current = campaign.rows[0]?.manifest;
      if (current?.status !== "ACTIVE") throw new Error("CAMPAIGN_NOT_AUTHORIZED");
      const reserved = await client.query<{ amount: string }>(
        `SELECT COALESCE(SUM((quote->>'amount')::numeric), 0)::text AS amount
           FROM v2_placements
          WHERE campaign_id = $1
            AND status = 'SIGNED'
            AND (quote->>'validUntil')::bigint > floor(extract(epoch FROM now()))::bigint`,
        [value.campaignId],
      );
      const reservation = BigInt(reserved.rows[0]?.amount.split(".")[0] ?? "0");
      assertCampaignBudget({
        total: BigInt(current.totalBudget),
        indexed: indexedSpend,
        reserved: reservation,
        next: BigInt(value.quote.amount),
      });
      const result = await client.query(
        `UPDATE v2_placements
          SET signed_quote = $2::jsonb, status = 'SIGNED', updated_at = now()
        WHERE placement_id = $1 AND status = 'AUTHORIZED'`,
        [value.placementId, JSON.stringify(value.signedQuote)],
      );
      if (result.rowCount !== 1) throw new Error("PLACEMENT_NOT_AUTHORIZED");
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setPlacementStatus(
    placementId: string,
    status: "PAID_VERIFIED" | "INVALID",
  ): Promise<void> {
    await this.ensureSchema();
    await this.db().query(
      `UPDATE v2_placements SET status = $2, updated_at = now() WHERE placement_id = $1`,
      [placementId, status],
    );
  }

  async recordMeasurement(args: {
    placementId: string;
    eventId: string;
    sessionId: string;
    kind: "IMPRESSION" | "CLICK";
  }): Promise<PlacementMetrics> {
    await this.ensureSchema();
    const client = await this.db().connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ campaign_id: string; status: string }>(
        `SELECT campaign_id, status FROM v2_placements
          WHERE placement_id = $1 FOR UPDATE`,
        [args.placementId],
      );
      const current = locked.rows[0];
      if (!current) throw new Error("PLACEMENT_NOT_FOUND");
      if (current.status !== "PAID_VERIFIED") throw new Error("PLACEMENT_NOT_VERIFIED");
      if (args.kind === "CLICK") {
        const impression = await client.query(
          `SELECT 1 FROM v2_measurements
            WHERE placement_id = $1 AND session_id = $2::uuid AND kind = 'IMPRESSION' LIMIT 1`,
          [args.placementId, args.sessionId],
        );
        if (!impression.rows[0]) throw new Error("IMPRESSION_REQUIRED");
      }
      await client.query(
        `INSERT INTO v2_measurements (event_id, placement_id, session_id, kind, surface)
         VALUES ($1::uuid, $2, $3::uuid, $4, 'CHAT_ANSWER')
         ON CONFLICT DO NOTHING`,
        [args.eventId, args.placementId, args.sessionId, args.kind],
      );
      await client.query("COMMIT");
      return this.campaignMetrics(current.campaign_id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async campaignMetrics(campaignId: string): Promise<PlacementMetrics> {
    await this.ensureSchema();
    const result = await this.db().query<{
      verified_placements: string;
      spend_atomic: string;
      impressions: string;
      clicks: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM v2_placements p
           WHERE p.campaign_id = c.campaign_id AND p.status = 'PAID_VERIFIED')
           AS verified_placements,
         (SELECT COALESCE(SUM((p.quote->>'amount')::numeric), 0)::text
            FROM v2_placements p
           WHERE p.campaign_id = c.campaign_id AND p.status = 'PAID_VERIFIED')
           AS spend_atomic,
         (SELECT COUNT(*)::text FROM v2_measurements m
            JOIN v2_placements p ON p.placement_id = m.placement_id
           WHERE p.campaign_id = c.campaign_id AND m.kind = 'IMPRESSION') AS impressions,
         (SELECT COUNT(*)::text FROM v2_measurements m
            JOIN v2_placements p ON p.placement_id = m.placement_id
           WHERE p.campaign_id = c.campaign_id AND m.kind = 'CLICK') AS clicks
       FROM v2_campaigns c
       WHERE c.campaign_id = $1`,
      [campaignId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("CAMPAIGN_NOT_FOUND");
    const spend = BigInt(row.spend_atomic.split(".")[0]);
    const impressions = Number(row.impressions);
    const clicks = Number(row.clicks);
    return {
      campaignId,
      verifiedPlacements: Number(row.verified_placements),
      spendAtomic: spend.toString(),
      impressions,
      clicks,
      ctrPercent: impressions ? ((clicks * 100) / impressions).toFixed(2) : null,
      effectiveCpcAtomic: clicks ? (spend / BigInt(clicks)).toString() : null,
      effectiveCpmAtomic: impressions ? ((spend * 1_000n) / BigInt(impressions)).toString() : null,
    };
  }

  newDecisionId(): string {
    return randomUUID();
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}
