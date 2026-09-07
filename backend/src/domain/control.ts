import { verifyMessage } from "ethers";

/**
 * Domain control, done safely.
 *
 * Three rules, each of which closes a hole the previous implementation had:
 *
 * 1. A negative result is NEVER written on-chain. A missing record, a resolver
 *    timeout or a disagreement means we learned nothing - and because a `false`
 *    verdict revokes in the registry, writing one would let anybody knock a
 *    legitimate advertiser out by asking at the wrong moment.
 *
 * 2. Reading is public and writing is signed. Anyone may check whether a domain
 *    currently resolves - DNS is public, so gatekeeping it protects nothing. But
 *    recording a proof spends gas and touches someone's identity, so it must be
 *    authorised by the wallet it concerns.
 *
 * 3. The words are exact. A TXT record proves control of DNS at a moment in
 *    time. It does not prove trademark ownership, company employment, or any
 *    right to the textual brand name - so this module says "domain control"
 *    and never "verified brand".
 */

/** How long a signed authorisation stays usable. */
export const SIGNATURE_TTL_SECONDS = 300;

/**
 * The message a wallet signs to authorise recording its own proof.
 *
 * Includes the address so a signature cannot be replayed for a different
 * advertiser, the domain so it cannot be moved to another claim, and a
 * timestamp so an old signature stops working. Deliberately human-readable:
 * someone should be able to read what they are signing in the wallet prompt.
 */
export function authorisationMessage(input: {
  address: string;
  domain: string;
  issuedAt: number;
}): string {
  return [
    "AdReceipt: record domain control",
    "",
    `Wallet: ${input.address.toLowerCase()}`,
    `Domain: ${normaliseDomain(input.domain)}`,
    `Issued: ${input.issuedAt}`,
    "",
    "Signing costs nothing and authorises recording a successful DNS proof for this wallet only.",
  ].join("\n");
}

/**
 * One spelling of a domain.
 *
 * Compared, resolved and signed in the same normalised form, so a trailing dot
 * or a capital letter cannot produce a signature that authorises one string and
 * a lookup that checks another.
 */
export function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

export interface AuthorisationResult {
  ok: boolean;
  reason?: string;
}

/** Recover the signer and confirm it is the advertiser, recently. */
export function checkAuthorisation(input: {
  address: string;
  domain: string;
  issuedAt: number;
  signature: string;
  now?: number;
}): AuthorisationResult {
  const now = input.now ?? Math.floor(Date.now() / 1000);

  if (!Number.isFinite(input.issuedAt)) {
    return { ok: false, reason: "The authorisation has no valid timestamp." };
  }
  // A little tolerance for a clock that runs fast, but not enough to be useful.
  if (input.issuedAt > now + 60) {
    return { ok: false, reason: "The authorisation is dated in the future." };
  }
  if (now - input.issuedAt > SIGNATURE_TTL_SECONDS) {
    return { ok: false, reason: "The authorisation has expired. Sign again." };
  }

  let recovered: string;
  try {
    recovered = verifyMessage(
      authorisationMessage({
        address: input.address,
        domain: input.domain,
        issuedAt: input.issuedAt,
      }),
      input.signature,
    );
  } catch {
    return { ok: false, reason: "The signature could not be read." };
  }

  if (recovered.toLowerCase() !== input.address.toLowerCase()) {
    return {
      ok: false,
      reason: "That signature belongs to a different wallet than the one being recorded.",
    };
  }

  return { ok: true };
}

export type ControlState =
  | "controlled"
  | "record-missing"
  | "record-mismatch"
  | "not-registered"
  | "undetermined";

/**
 * How to describe each state to a person.
 *
 * `undetermined` exists so a resolver problem is never phrased as a failure by
 * the advertiser. Nothing about the domain was learned, and the interface must
 * not imply otherwise.
 */
export const CONTROL_COPY: Record<ControlState, string> = {
  controlled: "Domain control confirmed by DNS just now.",
  "record-missing":
    "Both resolvers answered and neither found the record. DNS can take a few minutes to propagate.",
  "record-mismatch":
    "A record exists but its value does not match the current challenge. The claim may have changed since it was published.",
  "not-registered": "This wallet has no claim to check.",
  undetermined:
    "No resolver could be reached, so nothing was established. This says nothing about the domain.",
};

/** Only a positive, current proof may ever be written on-chain. */
export function isRecordable(state: ControlState): boolean {
  return state === "controlled";
}
