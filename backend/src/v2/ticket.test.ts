import assert from "node:assert/strict";
import test from "node:test";
import { creSimulationArguments, sanitizeCreDiagnostic } from "./ticket";

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
