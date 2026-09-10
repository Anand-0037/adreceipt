import assert from "node:assert/strict";
import test from "node:test";
import { id } from "ethers";
import {
  assertPlacementEvidenceConsistency,
  creSimulationArguments,
  sanitizeCreDiagnostic,
} from "./ticket";

test("hosted CRE simulation pins the real project root", () => {
  const args = creSimulationArguments({
    projectRoot: "/srv/adreceipt/cre",
    configPath: "/tmp/config.json",
    envPath: "/tmp/policy.env",
  });

  assert.deepEqual(args.slice(0, 5), [
    "--project-root",
    "/srv/adreceipt/cre",
    "workflow",
    "simulate",
    "placement-authorization",
  ]);
  assert.equal(args[args.indexOf("--config") + 1], "/tmp/config.json");
  assert.equal(args[args.indexOf("--env") + 1], "/tmp/policy.env");
  assert.equal(args[args.indexOf("--target") + 1], "runtime-settings");
  assert.equal(args.includes("--non-interactive"), true);
});

test("CRE diagnostics preserve the failure while redacting paths and secrets", () => {
  const diagnostic = sanitizeCreDiagnostic(
    "/srv/backend/runtime-bin/cre: policy token-value-123 does not exist\n",
    [["/srv/backend/runtime-bin/cre", "[CRE_CLI]"]],
    ["token-value-123"],
  );

  assert.equal(diagnostic, "[CRE_CLI]: policy [REDACTED] does not exist |");
  assert.equal(diagnostic.includes("/srv/backend"), false);
  assert.equal(diagnostic.includes("token-value-123"), false);
});

function evidenceFixture() {
  const campaignId = `0x${"11".repeat(32)}`;
  const contextCommitment = `0x${"22".repeat(32)}`;
  const revisionHash = `0x${"33".repeat(32)}`;
  const displayText = "Exact headline\nExact body";
  const manifest = {
    campaignId,
    revision: 1,
    campaignRevisionHash: revisionHash,
    creativeHeadline: "Exact headline",
    creativeBody: "Exact body",
    landingPage: "https://advertiser.example/product",
  };
  return {
    placement: {
      decisionId: "decision-1",
      campaignId,
      ticket: {
        campaignId,
        campaignRevisionHash: revisionHash,
        contextCommitment,
        contentHash: id(displayText),
      },
      subject: { contentHash: id(displayText) },
      quote: { campaignId },
      displayText,
      landingPage: manifest.landingPage,
    },
    decision: {
      decisionId: "decision-1",
      status: "ELIGIBLE",
      context: { contextCommitment },
      winner: { campaignId, revision: 1 },
    },
    campaign: { manifest },
  };
}

test("placement evidence binds the original decision, campaign, and exact creative", () => {
  assert.doesNotThrow(() => assertPlacementEvidenceConsistency(evidenceFixture() as never));
  const changed = evidenceFixture();
  changed.placement.displayText = "Altered headline\nExact body";
  assert.throws(
    () => assertPlacementEvidenceConsistency(changed as never),
    /PLACEMENT_EVIDENCE_MISMATCH/,
  );
});
