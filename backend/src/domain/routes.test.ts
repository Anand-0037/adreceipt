import assert from "node:assert/strict";
import test from "node:test";

process.env.SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "http://127.0.0.1:1";

/**
 * Route-level guards for domain control.
 *
 * The previous implementation let anyone trigger an on-chain write for any
 * address, and turned a failed lookup into a revocation. These assert the two
 * rules that close that: recording requires a signature from the wallet
 * concerned, and the unsafe legacy route stays gone.
 */
test("recording a proof refuses unauthenticated and malformed requests", async () => {
  const { createServer } = await import("../server/index");
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const subject = "0x0000000000000000000000000000000000000001";

  try {
    // No signature at all.
    const bare = await fetch(`${base}/advertisers/${subject}/domain/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(bare.status, 400);
    assert.equal(((await bare.json()) as { error: string }).error, "authorisation-required");

    // A signature without a timestamp is equally unusable.
    const partial = await fetch(`${base}/advertisers/${subject}/domain/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: "0x00" }),
    });
    assert.equal(partial.status, 400);

    // A malformed address is rejected before any chain call.
    const badAddress = await fetch(`${base}/advertisers/not-an-address/domain/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: "0x00", issuedAt: 1 }),
    });
    assert.equal(badAddress.status, 400);

    // Malformed address on /domain and /domain/status endpoints
    const badDomain = await fetch(`${base}/advertisers/not-an-address/domain`);
    assert.equal(badDomain.status, 400);

    const badStatus = await fetch(`${base}/advertisers/not-an-address/domain/status`);
    assert.equal(badStatus.status, 400);

    const badStatusWait = await fetch(
      `${base}/advertisers/not-an-address/domain/status?wait=true`,
    );
    assert.equal(badStatusWait.status, 400);

    // The route removed for being unsafe must stay removed.
    const legacy = await fetch(`${base}/advertisers/${subject}/verify`, { method: "POST" });
    assert.equal(legacy.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

