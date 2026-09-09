import { getAddress, hexlify, randomBytes, verifyMessage } from "ethers";

export const SIGNATURE_TTL_SECONDS = 300;

export interface DomainAuthorisation {
  address: string;
  domain: string;
  chainId: number;
  challenge: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

/** Human-readable wallet request, bound to one live registry challenge. */
export function authorisationMessage(input: DomainAuthorisation): string {
  return [
    "AdReceipt: record domain control",
    "",
    `Wallet: ${getAddress(input.address).toLowerCase()}`,
    `Domain: ${normaliseDomain(input.domain)}`,
    `Chain ID: ${input.chainId}`,
    `Registry challenge: ${input.challenge.toLowerCase()}`,
    `Request nonce: ${input.nonce.toLowerCase()}`,
    `Issued: ${input.issuedAt}`,
    `Expires: ${input.expiresAt}`,
    "",
    "Signing costs nothing and authorises one successful DNS proof for this wallet only.",
  ].join("\n");
}

export interface AuthorisationResult {
  ok: boolean;
  reason?: string;
}

/**
 * One-instance, short-lived authorization store. A restart intentionally
 * invalidates outstanding signatures. Scale-out requires shared atomic storage.
 */
export class DomainAuthorisationStore {
  private readonly entries = new Map<string, DomainAuthorisation>();

  constructor(
    private readonly chainId: number,
    private readonly ttlSeconds = SIGNATURE_TTL_SECONDS,
    private readonly nonce: () => string = () => hexlify(randomBytes(32)),
  ) {}

  issue(input: {
    address: string;
    domain: string;
    challenge: string;
    now?: number;
  }): DomainAuthorisation {
    const now = input.now ?? Math.floor(Date.now() / 1000);
    this.prune(now);
    const record: DomainAuthorisation = {
      address: getAddress(input.address),
      domain: normaliseDomain(input.domain),
      chainId: this.chainId,
      challenge: input.challenge.toLowerCase(),
      nonce: this.nonce().toLowerCase(),
      issuedAt: now,
      expiresAt: now + this.ttlSeconds,
    };
    this.entries.set(record.nonce, record);
    return record;
  }

  /** Verify and atomically consume a request. Only a valid signature burns it. */
  consume(input: DomainAuthorisation & { signature: string; now?: number }): AuthorisationResult {
    const now = input.now ?? Math.floor(Date.now() / 1000);
    this.prune(now);
    const nonce = input.nonce.toLowerCase();
    const stored = this.entries.get(nonce);
    if (!stored) {
      return { ok: false, reason: "This authorisation is unknown, expired, or already used." };
    }

    let address: string;
    try {
      address = getAddress(input.address);
    } catch {
      return { ok: false, reason: "The authorisation contains an invalid wallet address." };
    }
    const supplied: DomainAuthorisation = {
      address,
      domain: normaliseDomain(input.domain),
      chainId: input.chainId,
      challenge: input.challenge.toLowerCase(),
      nonce,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
    if (JSON.stringify(supplied) !== JSON.stringify(stored)) {
      return { ok: false, reason: "The authorisation fields do not match the issued request." };
    }
    if (stored.expiresAt <= now || stored.issuedAt > now + 60) {
      this.entries.delete(nonce);
      return { ok: false, reason: "The authorisation has expired. Sign again." };
    }

    let recovered: string;
    try {
      recovered = verifyMessage(authorisationMessage(stored), input.signature);
    } catch {
      return { ok: false, reason: "The signature could not be read." };
    }
    if (getAddress(recovered) !== stored.address) {
      return { ok: false, reason: "That signature belongs to a different wallet." };
    }

    this.entries.delete(nonce);
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [nonce, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(nonce);
    }
  }
}

export type ControlState =
  | "controlled"
  | "record-missing"
  | "record-mismatch"
  | "not-registered"
  | "undetermined";

export const CONTROL_COPY: Record<ControlState, string> = {
  controlled: "Domain control confirmed by DNS just now.",
  "record-missing":
    "Both resolvers answered and neither found the record. DNS can take a few minutes to propagate.",
  "record-mismatch":
    "A record exists but its value does not match the current challenge. The claim may have changed since it was published.",
  "not-registered": "This wallet has no claim to check.",
  undetermined:
    "The resolvers did not agree or could not both be reached, so nothing was established.",
};

export function isRecordable(state: ControlState): boolean {
  return state === "controlled";
}
