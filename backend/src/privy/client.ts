import { config } from "../config";

export function privyReadiness() {
  const credentials = Boolean(config.privyAppId && config.privyAppSecret);
  return { configured: credentials && Boolean(config.privyWalletId), credentials, wallet: config.privyWalletId ? "configured" : "missing", providerVerified: false };
}

export async function sendPrivyTransaction(data: string, referenceId: string) {
  if (!config.privyAppId || !config.privyAppSecret || !config.privyWalletId || !config.settlementAddress) throw new Error("Privy wallet and settlement configuration are required");
  const response = await fetch(`https://api.privy.io/v1/wallets/${encodeURIComponent(config.privyWalletId)}/rpc`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.privyAppId}:${config.privyAppSecret}`).toString("base64")}`, "privy-app-id": config.privyAppId, "content-type": "application/json", "idempotency-key": referenceId },
    body: JSON.stringify({ method: "eth_sendTransaction", caip2: `eip155:${config.chainId}`, chain_type: "ethereum", reference_id: referenceId, params: { transaction: { to: config.settlementAddress, data, value: "0x0" } } }), signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Privy returned HTTP ${response.status}`);
  return body;
}
