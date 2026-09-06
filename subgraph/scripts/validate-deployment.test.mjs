import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "./validate-deployment.mjs";

const address = "0x1111111111111111111111111111111111111111";

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
