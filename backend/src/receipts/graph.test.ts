import assert from "node:assert/strict";
import test from "node:test";
import { parseGraphResponse } from "./graph";

const receipt = {
  id: `0x${"11".repeat(32)}`,
  campaignId: `0x${"22".repeat(32)}`,
  subjectHash: `0x${"33".repeat(32)}`,
  publisher: `0x${"44".repeat(20)}`,
  payer: `0x${"55".repeat(20)}`,
  recipient: `0x${"66".repeat(20)}`,
  asset: `0x${"77".repeat(20)}`,
  amount: "1000000",
  settledAt: "1700000000",
  schemaVersion: 1,
  settlementContract: `0x${"88".repeat(20)}`,
  transactionHash: `0x${"99".repeat(32)}`,
  logIndex: "2",
  blockNumber: "95",
  blockTimestamp: "1700000000",
};

test("parses a complete Graph response", () => {
  const parsed = parseGraphResponse({ data: { receipt, _meta: { block: { number: 100 }, hasIndexingErrors: false } } });
  assert.deepEqual(parsed, { receipt, blockNumber: 100, hasIndexingErrors: false });
});

test("accepts an indexed absence with valid metadata", () => {
  assert.equal(parseGraphResponse({ data: { receipt: null, _meta: { block: { number: 100 } } } }).receipt, null);
});

test("rejects malformed receipt fields instead of casting them", () => {
  for (const [key, value] of [
    ["id", "not-bytes32"], ["payer", "not-address"], ["amount", "1.5"],
    ["schemaVersion", "1"], ["transactionHash", `0x${"11".repeat(31)}`],
  ]) {
    assert.throws(
      () => parseGraphResponse({ data: { receipt: { ...receipt, [key]: value }, _meta: { block: { number: 100 } } } }),
      /invalid runtime schema/,
      key,
    );
  }
});

test("rejects Graph errors and malformed metadata", () => {
  assert.throws(() => parseGraphResponse({ errors: [{ message: "failed" }] }), /query errors/);
  assert.throws(() => parseGraphResponse({ data: { receipt, _meta: { block: { number: "100" } } } }), /valid metadata/);
});
