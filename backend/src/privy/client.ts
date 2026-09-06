import { config } from "../config";

type PrivyReadinessConfig = Pick<
  typeof config,
  "privyAppId" | "privyAppSecret" | "privyWalletId" | "privyPolicyId"
>;

export function privyReadiness(settings: PrivyReadinessConfig = config) {
  const credentials = Boolean(settings.privyAppId && settings.privyAppSecret);
  const wallet = Boolean(settings.privyWalletId);
  const policy = Boolean(settings.privyPolicyId);
  return {
    configured: credentials && wallet && policy,
    credentials,
    wallet: wallet ? "configured" : "missing",
    policy: policy ? "configured" : "missing",
    providerVerified: false,
  };
}

export async function sendPrivyTransaction(data: string, referenceId: string) {
  if (!config.privyAppId || !config.privyAppSecret || !config.privyWalletId || !config.privyPolicyId || !config.settlementAddress) throw new Error("Privy wallet, policy, and settlement configuration are required");
  const response = await fetch(`https://api.privy.io/v1/wallets/${encodeURIComponent(config.privyWalletId)}/rpc`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.privyAppId}:${config.privyAppSecret}`).toString("base64")}`, "privy-app-id": config.privyAppId, "content-type": "application/json", "idempotency-key": referenceId },
    body: JSON.stringify({ method: "eth_sendTransaction", caip2: `eip155:${config.chainId}`, chain_type: "ethereum", reference_id: referenceId, params: { transaction: { to: config.settlementAddress, data, value: "0x0" } } }), signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Privy returned HTTP ${response.status}`);
  return body;
}
