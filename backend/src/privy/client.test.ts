import assert from "node:assert/strict";
import test from "node:test";
import { generateP256KeyPair } from "@privy-io/node";

const complete = {
  privyAppId: "app-id",
  privyAppSecret: "app-secret",
  privyWalletId: "wallet-id",
  privyPolicyId: "policy-id",
  privyAuthorizationPrivateKey: "authorization-key",
};

test("reports Privy ready only when a policy is configured", async () => {
  process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:8545";
  const { privyReadiness } = await import("./client");

  assert.deepEqual(privyReadiness(complete), {
    configured: true,
    credentials: true,
    wallet: "configured",
    policy: "configured",
    authorizationKey: "configured",
    providerVerified: false,
  });

  assert.deepEqual(privyReadiness({ ...complete, privyPolicyId: "" }), {
    configured: false,
    credentials: true,
    wallet: "configured",
    policy: "missing",
    authorizationKey: "configured",
    providerVerified: false,
  });

  assert.equal(
    privyReadiness({ ...complete, privyAuthorizationPrivateKey: "" }).configured,
    false,
  );
});

test("builds an owner-authorized idempotent transaction request", async () => {
  process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:8545";
  const { buildPrivyTransactionRequest } = await import("./client");
  const { privateKey } = await generateP256KeyPair();
  const request = buildPrivyTransactionRequest(
    { to: "0x1111111111111111111111111111111111111111", data: "0x1234" },
    "receipt-1",
    { ...complete, privyAuthorizationPrivateKey: privateKey, chainId: 11155111 },
  );

  assert.equal(request.url, "https://api.privy.io/v1/wallets/wallet-id/rpc");
  assert.equal(request.headers["privy-idempotency-key"], "receipt-1");
  assert.ok(request.headers["privy-authorization-signature"].length > 0);
  assert.equal("idempotency-key" in request.headers, false);
  assert.deepEqual(request.body.params.transaction, {
    to: "0x1111111111111111111111111111111111111111",
    data: "0x1234",
    value: "0x0",
  });
});
