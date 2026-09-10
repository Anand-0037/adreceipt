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

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const verification = await fetch(`${base}/receipts/not-a-receipt`);
      assert.equal(verification.status, 503);
    }
    const limited = await fetch(`${base}/subjects/not-a-subject`);
    const limitedBody = (await limited.json()) as { error?: string; message?: string };
    assert.equal(limited.status, 429);
    assert.equal(limitedBody.error, "rate-limit");
    assert.match(limitedBody.message ?? "", /receipt verification requests/i);

    const invalidMeasurement = await fetch(
      `${base}/v2/placements/0x${"11".repeat(32)}/measurements`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "70c29e14-41b1-4da0-988e-1b97071ebf91",
          kind: "IMPRESSION",
        }),
      },
    );
    const invalidMeasurementBody = (await invalidMeasurement.json()) as { error?: string };
    assert.equal(invalidMeasurement.status, 400);
    assert.equal(invalidMeasurementBody.error, "invalid-event");

    const settlement = await fetch(`${base}/v2/placements/0x${"11".repeat(32)}/settle`, {
      method: "POST",
    });
    const settlementBody = (await settlement.json()) as { error?: string };
    assert.ok(settlement.status === 401 || settlement.status === 503);
    assert.ok(
      settlementBody.error === "operator-authorization-required" ||
        settlementBody.error === "operator-settlement-unavailable",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
