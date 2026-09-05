import {
  assertNoSecrets,
  type DomainPublic,
  type DomainRequest,
  type DomainSecret,
  type TierPublic,
  type TierRequest,
  type TierSecret,
} from "./boundary";

/**
 * The two confidential handlers, as pure functions over injected dependencies.
 *
 * Written this way on purpose. The CRE SDK supplies its own HTTP/DNS primitives
 * inside the TEE, and those differ from Node's. Injecting the dependency means
 * the same logic runs unchanged in three places - Node during development, the
 * CRE simulator, and the real enclave - and only the adapter changes. It also
 * means the interesting part is unit-testable without a TEE at all.
 */

export interface DomainDeps {
  /** Resolve a TXT name. Inside the enclave this is the CRE-provided fetcher. */
  resolveTxt(name: string): Promise<{ resolver: string; records: string[] }[]>;
  now(): number;
}

export interface DomainResult {
  /** Crosses the boundary. */
  publicOutput: DomainPublic;
  /** Stays inside. Returned only so a local run can show what was withheld. */
  secret: DomainSecret;
}

/**
 * Fetch the DNS challenge inside the enclave and emit only the verdict.
 *
 * Two independent resolvers must agree before a positive verdict is produced. A
 * single resolver is a single point of trust, and on a hostile network it can be
 * substituted outright - which would let an attacker manufacture a verified
 * badge for a domain they do not control.
 *
 * Unreachable resolvers produce `verified: false` here, but the caller must not
 * attest that: absence of an answer is not evidence of absence of the record.
 * See `isAttestable` in the backend's dns/verify.
 */
export async function domainHandler(
  request: DomainRequest,
  deps: DomainDeps,
): Promise<DomainResult> {
  const answers = await deps.resolveTxt(request.recordName);
  const secret: DomainSecret = { answers };

  const reachable = answers.filter((a) => a.records.length > 0);
  const agreed =
    reachable.length === 0
      ? []
      : reachable[0].records.filter((r) => reachable.every((a) => a.records.includes(r)));

  const verified =
    reachable.length >= 2 &&
    agreed.some((record) => record.trim() === request.expectedValue.trim());

  const publicOutput = assertNoSecrets<DomainPublic>(
    {
      advertiser: request.advertiser,
      verified,
      challenge: request.challenge,
      checkedAt: deps.now(),
    },
    "domainHandler",
  );

  return { publicOutput, secret };
}

export interface TierDeps {
  /** Public: readable by anyone from PlacementEscrow. */
  onchainSpend(advertiser: string, windowStart: number, windowEnd: number): Promise<bigint>;
  /** Private: invoiced and fiat spend that never touches the chain. */
  offchainSpend(advertiser: string, windowStart: number, windowEnd: number): Promise<bigint>;
  /** Band edges. Policy, not secret. */
  bucket(totalWei: bigint): number;
}

export interface TierResult {
  publicOutput: TierPublic;
  secret: TierSecret;
}

/**
 * Sum a public figure with a private one inside the enclave, emit only the band.
 *
 * The on-chain half alone would protect nothing - anyone can recompute it. The
 * private half is what an advertiser would actually refuse to publish, and
 * because the two are summed before bucketing, the band leaks no more about
 * either than the band itself.
 */
export async function tierHandler(request: TierRequest, deps: TierDeps): Promise<TierResult> {
  const onchainWei = await deps.onchainSpend(
    request.advertiser,
    request.windowStart,
    request.windowEnd,
  );
  const offchainWei = await deps.offchainSpend(
    request.advertiser,
    request.windowStart,
    request.windowEnd,
  );
  const totalWei = onchainWei + offchainWei;

  const publicOutput = assertNoSecrets<TierPublic>(
    {
      advertiser: request.advertiser,
      tier: deps.bucket(totalWei),
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
    },
    "tierHandler",
  );

  return { publicOutput, secret: { onchainWei, offchainWei, totalWei } };
}
