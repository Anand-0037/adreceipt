import assert from "node:assert/strict";
import test from "node:test";
import { creSimulationArguments } from "./ticket";

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
  assert.equal(args.includes("--non-interactive"), true);
});
