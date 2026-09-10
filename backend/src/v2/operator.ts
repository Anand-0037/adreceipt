import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function operatorSettlementReady(token: string): boolean {
  return token.length >= 32;
}

export function authorizeOperator(header: unknown, configuredToken: string): boolean {
  if (!operatorSettlementReady(configuredToken) || typeof header !== "string") return false;
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(configuredToken));
}
