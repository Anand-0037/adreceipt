import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest, validateReceiptAbi } from "./validate-deployment.mjs";

const address = "0x1111111111111111111111111111111111111111";
const receiptCreated = {
  anonymous: false,
  inputs: [
    { indexed: true, name: "receiptId", type: "bytes32" },
    { indexed: true, name: "campaignId", type: "bytes32" },
    { indexed: true, name: "subjectHash", type: "bytes32" },
    { indexed: false, name: "publisher", type: "address" },
    { indexed: false, name: "payer", type: "address" },
    { indexed: false, name: "recipient", type: "address" },
    { indexed: false, name: "asset", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "settledAt", type: "uint64" },
    { indexed: false, name: "schemaVersion", type: "uint16" },
  ],
  name: "ReceiptCreated",
  type: "event",
};

test("accepts a real contract address and positive start block", () => {
  assert.deepEqual(validateManifest(`address: "${address}"\nstartBlock: 12345\n`), {
    address,
    startBlock: 12345,
  });
});

test("rejects the zero-address build sentinel", () => {
  assert.throws(
    () =>
      validateManifest(
        'address: "0x0000000000000000000000000000000000000000"\nstartBlock: 12345\n',
      ),
    /zero-address/,
  );
});

test("rejects a genesis start block", () => {
  assert.throws(() => validateManifest(`address: "${address}"\nstartBlock: 0\n`), /deployment block/);
});

test("rejects a malformed contract address", () => {
  assert.throws(() => validateManifest("address: nope\nstartBlock: 12345\n"), /valid settlement/);
});

test("accepts the frozen ReceiptCreated ABI", () => {
  assert.equal(validateReceiptAbi([receiptCreated]), receiptCreated);
});

test("rejects an ABI without ReceiptCreated", () => {
  assert.throws(() => validateReceiptAbi([]), /exactly one ReceiptCreated/);
});

test("rejects a changed ReceiptCreated field", () => {
  const changed = structuredClone(receiptCreated);
  changed.inputs[7].type = "uint128";
  assert.throws(() => validateReceiptAbi([changed]), /inputs do not match/);
});

test("rejects a changed ReceiptCreated index", () => {
  const changed = structuredClone(receiptCreated);
  changed.inputs[2].indexed = false;
  assert.throws(() => validateReceiptAbi([changed]), /inputs do not match/);
});
