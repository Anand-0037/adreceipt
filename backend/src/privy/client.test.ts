import assert from "node:assert/strict";
import test from "node:test";

const complete = {
  privyAppId: "app-id",
  privyAppSecret: "app-secret",
  privyWalletId: "wallet-id",
  privyPolicyId: "policy-id",
};

test("reports Privy ready only when a policy is configured", async () => {
  process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:8545";
  const { privyReadiness } = await import("./client");

  assert.deepEqual(privyReadiness(complete), {
    configured: true,
    credentials: true,
    wallet: "configured",
    policy: "configured",
    providerVerified: false,
  });

  assert.deepEqual(privyReadiness({ ...complete, privyPolicyId: "" }), {
    configured: false,
    credentials: true,
    wallet: "configured",
    policy: "missing",
    providerVerified: false,
  });
});
