import assert from "node:assert/strict";
import test from "node:test";
import { classifyReceipt, type GraphEvidence } from "./verify";
const id = `0x${"11".repeat(32)}`, contract = `0x${"22".repeat(20)}`;
const receipt = { id, settlementContract: contract, schemaVersion: 1, blockNumber: "95" };
const graph: GraphEvidence = { receipt, blockNumber: 100, hasIndexingErrors: false };
test("verifies matching fresh evidence", () => assert.equal(classifyReceipt({ receiptId:id, graph, rpcHead:102, expectedContract:contract, maxLag:5 }).status, "PAID_VERIFIED"));
test("fails closed without configuration", () => assert.equal(classifyReceipt({ receiptId:id, maxLag:5 }).status, "UNAVAILABLE"));
test("returns pending for stale indexing", () => assert.equal(classifyReceipt({ receiptId:id, graph, rpcHead:110, expectedContract:contract, maxLag:5 }).status, "PENDING"));
test("distinguishes pending and indexed absence", () => {
  const empty={...graph,receipt:null};
  assert.equal(classifyReceipt({receiptId:id,graph:empty,rpcHead:102,expectedContract:contract,maxLag:5,atBlock:105}).status,"PENDING");
  assert.equal(classifyReceipt({receiptId:id,graph:empty,rpcHead:102,expectedContract:contract,maxLag:5,atBlock:99}).status,"NOT_FOUND_AT_BLOCK");
});
test("rejects indexing errors and wrong deployments", () => {
  assert.equal(classifyReceipt({receiptId:id,graph:{...graph,hasIndexingErrors:true},rpcHead:102,expectedContract:contract,maxLag:5}).status,"INVALID");
  assert.equal(classifyReceipt({receiptId:id,graph,rpcHead:102,expectedContract:`0x${"33".repeat(20)}`,maxLag:5}).status,"INVALID");
});
