CREATE TABLE IF NOT EXISTS v2_campaigns (
  campaign_id text PRIMARY KEY,
  advertiser_wallet text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED')),
  current_revision integer NOT NULL CHECK (current_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_campaign_revisions (
  campaign_id text NOT NULL REFERENCES v2_campaigns(campaign_id),
  revision integer NOT NULL CHECK (revision > 0),
  revision_hash text NOT NULL,
  manifest jsonb NOT NULL,
  typed_data jsonb NOT NULL,
  advertiser_signature text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, revision),
  UNIQUE (revision_hash)
);

CREATE TABLE IF NOT EXISTS v2_context_decisions (
  decision_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('ELIGIBLE', 'SUPPRESSED', 'NO_MATCH', 'UNAVAILABLE')),
  reason_code text NOT NULL,
  context jsonb NOT NULL,
  winner_campaign_id text,
  winner_revision integer,
  winner_relevance numeric(4,3),
  rejected jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE v2_context_decisions
  ADD COLUMN IF NOT EXISTS winner_relevance numeric(4,3);

CREATE INDEX IF NOT EXISTS v2_campaigns_status_idx ON v2_campaigns(status);
CREATE INDEX IF NOT EXISTS v2_context_decisions_created_idx ON v2_context_decisions(created_at DESC);

CREATE TABLE IF NOT EXISTS v2_placements (
  placement_id text PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES v2_context_decisions(decision_id),
  campaign_id text NOT NULL REFERENCES v2_campaigns(campaign_id),
  ticket jsonb NOT NULL,
  subject jsonb NOT NULL,
  quote jsonb NOT NULL,
  cre_authorization jsonb NOT NULL,
  signed_quote jsonb,
  receipt_id text NOT NULL UNIQUE,
  display_text text NOT NULL,
  landing_page text NOT NULL,
  status text NOT NULL CHECK (status IN ('AUTHORIZED', 'SIGNED', 'PAID_VERIFIED', 'INVALID')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_measurements (
  event_id uuid PRIMARY KEY,
  placement_id text NOT NULL REFERENCES v2_placements(placement_id),
  session_id uuid,
  kind text NOT NULL CHECK (kind IN ('IMPRESSION', 'CLICK')),
  surface text NOT NULL CHECK (surface IN ('CHAT_ANSWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (placement_id, event_id)
);

ALTER TABLE v2_measurements
  ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE INDEX IF NOT EXISTS v2_placements_campaign_idx
  ON v2_placements(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS v2_measurements_placement_idx
  ON v2_measurements(placement_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS v2_measurements_placement_session_kind_idx
  ON v2_measurements(placement_id, session_id, kind)
  WHERE session_id IS NOT NULL;

-- Consumed CRE reports, for replay protection.
--
-- The primary key is the DON execution id, so claiming one is a single atomic
-- INSERT: two concurrent submissions of the same report cannot both succeed,
-- which a check-then-write in application code could not guarantee.
CREATE TABLE IF NOT EXISTS v2_cre_reports (
  execution_id text PRIMARY KEY,
  placement_id text NOT NULL REFERENCES v2_placements(placement_id),
  report_id text NOT NULL,
  workflow_id text NOT NULL,
  don_id integer NOT NULL,
  report_timestamp integer NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS v2_cre_reports_placement_idx ON v2_cre_reports(placement_id);
