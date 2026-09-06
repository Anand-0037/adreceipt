import { generateAuthorizationSignature } from "@privy-io/node";
import { config } from "../config";

type PrivyReadinessConfig = Pick<
  typeof config,
  | "privyAppId"
  | "privyAppSecret"
  | "privyWalletId"
  | "privyPolicyId"
  | "privyAuthorizationPrivateKey"
>;

type PrivyTransactionConfig = PrivyReadinessConfig & Pick<typeof config, "chainId">;

export interface PrivyTransaction {
  to: string;
  data: string;
  value?: string;
}

export function privyReadiness(settings: PrivyReadinessConfig = config) {
  const credentials = Boolean(settings.privyAppId && settings.privyAppSecret);
  const wallet = Boolean(settings.privyWalletId);
  const policy = Boolean(settings.privyPolicyId);
  const authorizationKey = Boolean(settings.privyAuthorizationPrivateKey);
  return {
    configured: credentials && wallet && policy && authorizationKey,
    credentials,
    wallet: wallet ? "configured" : "missing",
    policy: policy ? "configured" : "missing",
    authorizationKey: authorizationKey ? "configured" : "missing",
    providerVerified: false,
  };
}

export function buildPrivyTransactionRequest(
  transaction: PrivyTransaction,
  referenceId: string,
  settings: PrivyTransactionConfig = config,
) {
  if (
    !settings.privyAppId ||
    !settings.privyAppSecret ||
    !settings.privyWalletId ||
    !settings.privyPolicyId ||
    !settings.privyAuthorizationPrivateKey
  ) {
    throw new Error("Privy wallet, policy, and authorization key are required");
  }

  const url = `https://api.privy.io/v1/wallets/${encodeURIComponent(settings.privyWalletId)}/rpc`;
  const requestBody = {
    method: "eth_sendTransaction",
    caip2: `eip155:${settings.chainId}`,
    chain_type: "ethereum",
    reference_id: referenceId,
    params: {
      transaction: { ...transaction, value: transaction.value ?? "0x0" },
    },
  };
  const privyHeaders = {
    "privy-app-id": settings.privyAppId,
    "privy-idempotency-key": referenceId,
  };
  const authorizationSignature = generateAuthorizationSignature({
    authorizationPrivateKey: settings.privyAuthorizationPrivateKey,
    input: { version: 1, url, method: "POST", headers: privyHeaders, body: requestBody },
  });

  return {
    url,
    body: requestBody,
    headers: {
      authorization: `Basic ${Buffer.from(`${settings.privyAppId}:${settings.privyAppSecret}`).toString("base64")}`,
      ...privyHeaders,
      "privy-authorization-signature": authorizationSignature,
      "content-type": "application/json",
    },
  };
}

export async function sendPrivyTransaction(transaction: PrivyTransaction, referenceId: string) {
  const request = buildPrivyTransactionRequest(transaction, referenceId);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Privy returned HTTP ${response.status}`);
  return body;
}
