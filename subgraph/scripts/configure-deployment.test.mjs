import assert from "node:assert/strict";
import test from "node:test";
import { configureManifest } from "./configure-deployment.mjs";

const sentinel = `dataSources:
  - kind: ethereum
    network: sepolia
    source:
      address: "0x0000000000000000000000000000000000000000"
      startBlock: 0
`;
const address = "0x1111111111111111111111111111111111111111";

test("configures the public deployment coordinates", () => {
  const configured = configureManifest(sentinel, { address, startBlock: "12345" });
  assert.match(configured, /network: sepolia/);
  assert.match(configured, new RegExp(`address: "${address}"`));
  assert.match(configured, /startBlock: 12345/);
});

test("rejects missing or invalid deployment coordinates", () => {
  assert.throws(
    () => configureManifest(sentinel, { address: "", startBlock: "12345" }),
    /valid EVM address/,
  );
  assert.throws(
    () => configureManifest(sentinel, { address, startBlock: "0" }),
    /positive integer/,
  );
});

test("rejects deployment to a different network", () => {
  assert.throws(
    () => configureManifest(sentinel, { address, startBlock: "12345", network: "mainnet" }),
    /must be "sepolia"/,
  );
});
