import assert from "node:assert/strict";
import test from "node:test";
import { authorizeOperator, operatorSettlementReady } from "./operator";

const token = "operator-test-token-with-at-least-32-characters";

test("operator settlement requires a strong configured secret", () => {
  assert.equal(operatorSettlementReady("short"), false);
  assert.equal(operatorSettlementReady(token), true);
});

test("operator authorization accepts only the exact bearer token", () => {
  assert.equal(authorizeOperator(`Bearer ${token}`, token), true);
  assert.equal(authorizeOperator("Bearer wrong-token", token), false);
  assert.equal(authorizeOperator(token, token), false);
  assert.equal(authorizeOperator(undefined, token), false);
});
