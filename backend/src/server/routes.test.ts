import assert from "node:assert/strict";
import test from "node:test";

process.env.SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "http://127.0.0.1:1";

test("serves the V1 deployment and does not expose legacy advertiser writes", async () => {
  const { createServer } = await import("./index");
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const deployment = await fetch(`${base}/deployment`);
    const body = (await deployment.json()) as {
      contract: string;
      address: string;
    };
    assert.equal(deployment.status, 200);
    assert.equal(body.contract, "PlacementSettlementV1");
    assert.equal(body.address, "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576");

    const legacyWrite = await fetch(
      `${base}/advertisers/0x0000000000000000000000000000000000000001/verify`,
      { method: "POST" },
    );
    assert.equal(legacyWrite.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
