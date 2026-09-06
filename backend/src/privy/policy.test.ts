import assert from "node:assert/strict";
import test from "node:test";
import { buildSettlementPolicy } from "./policy";

test("builds default-deny rules for bounded approval and settlement", () => {
  const settlement = "0x1111111111111111111111111111111111111111";
  const asset = "0x3333333333333333333333333333333333333333";
  const policy = buildSettlementPolicy({
    settlement,
    asset,
    chainId: 11155111,
    recipient: "0x2222222222222222222222222222222222222222",
    maxAmount: "1000",
    abi: [
      { type: "error", name: "InvalidQuote", inputs: [] },
      { type: "function", name: "settlePlacement", inputs: [] },
    ],
  });

  assert.equal(policy.rules.length, 2);
  assert.deepEqual(
    policy.rules[0].conditions.map((condition) => condition.field),
    ["to", "chain_id", "function_name", "approve.spender", "approve.amount"],
  );
  assert.equal(policy.rules[0].conditions[0].value, asset);
  assert.equal(policy.rules[0].conditions[3].value, settlement);
  assert.equal(policy.rules[0].conditions[4].value, "1000");
  assert.deepEqual(
    policy.rules[1].conditions.map((condition) => condition.field),
    ["to", "chain_id", "function_name", "settlePlacement.quote.recipient", "settlePlacement.quote.amount"],
  );
  assert.equal(policy.rules[1].conditions[1].value, "11155111");
  assert.deepEqual(policy.rules[1].conditions[2].abi, [
    { type: "function", name: "settlePlacement", inputs: [] },
  ]);
});

test("rejects an ABI without settlePlacement", () => {
  assert.throws(
    () => buildSettlementPolicy({
      settlement: "0x1111111111111111111111111111111111111111",
      asset: "0x3333333333333333333333333333333333333333",
      chainId: 11155111,
      recipient: "0x2222222222222222222222222222222222222222",
      maxAmount: "1000",
      abi: [{ type: "error", name: "InvalidQuote", inputs: [] }],
    }),
    /exactly one settlePlacement/,
  );
});
