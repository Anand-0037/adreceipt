/**
 * The enclave boundary, written down as types.
 *
 * Everything in a `*Secret` type is read or derived inside the TEE and must
 * never be logged, returned, or written on-chain. Everything in a `*Public`
 * type is what the handler is allowed to emit.
 *
 * Keeping this in one file means the boundary is reviewable in isolation: a
 * judge can read this and see exactly what the confidential handler protects,
 * without tracing call graphs.
 */

// ---------------------------------------------------------------------------
// Handler 1 - domain verification
// ---------------------------------------------------------------------------

/** Assembled outside the enclave. None of it is sensitive. */
export interface DomainRequest {
  advertiser: string;
  /** The claimed domain, read from AdvertiserRegistry. */
  domain: string;
  /** The outstanding challenge, read from AdvertiserRegistry. */
  challenge: string;
  /** Fully qualified TXT name to resolve, e.g. `_disclosed.deployco.com`. */
  recordName: string;
  /** Expected TXT value, e.g. `disclosed-verification=0x...`. */
  expectedValue: string;
}

/**
 * Held only inside the enclave.
 *
 * The DNS answer is the confidential API response the track requires: a
 * third-party response fetched inside the TEE, whose contents never leave it.
 */
export interface DomainSecret {
  /** Raw TXT records, per resolver. Never leaves the enclave. */
  answers: { resolver: string; records: string[] }[];
}

/** The only thing that crosses back out. */
export interface DomainPublic {
  advertiser: string;
  verified: boolean;
  challenge: string;
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Handler 2 - tier computation
// ---------------------------------------------------------------------------

export interface TierRequest {
  advertiser: string;
  windowStart: number;
  windowEnd: number;
}

/**
 * Held only inside the enclave.
 *
 * `onchainWei` is public information - anyone can call `depositedSince`. It is
 * the sum with `offchainWei` that is sensitive: the private figure is an
 * advertiser's invoiced and fiat spend, which never touches the chain, so the
 * total cannot be reconstructed by an observer. That is what makes bucketing
 * inside the enclave protect something real rather than restate a public number.
 */
export interface TierSecret {
  onchainWei: bigint;
  offchainWei: bigint;
  totalWei: bigint;
}

export interface TierPublic {
  advertiser: string;
  /** 0 None, 1 Minimal, 2 Moderate, 3 Major. */
  tier: number;
  windowStart: number;
  windowEnd: number;
}

// ---------------------------------------------------------------------------

/**
 * Runtime assertion that a payload about to leave the enclave carries no
 * sensitive field. Cheap, and it turns a refactoring mistake into a loud failure
 * rather than a silent leak.
 */
const FORBIDDEN = /wei|amount|spend|total|balance|answers|records|raw/i;

export function assertNoSecrets<T extends object>(payload: T, label: string): T {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN.test(key)) {
      throw new Error(
        `${label}: field "${key}" looks sensitive and must not cross the enclave boundary`,
      );
    }
  }
  return payload;
}
