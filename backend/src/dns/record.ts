import { config } from "../config";

export interface ChallengeRecord {
  /** Fully qualified name the advertiser creates, e.g. `_disclosed.deployco.com`. */
  name: string;
  /** Record type to create. */
  type: "TXT";
  /** Exact value to publish. */
  value: string;
  /** Copy-paste guidance for the advertiser's DNS panel. */
  instructions: string[];
}

/**
 * The DNS challenge format.
 *
 * A dedicated `_disclosed` subdomain rather than a TXT on the apex, for the same
 * reason ACME uses `_acme-challenge`: apex TXT records already carry SPF, DMARC
 * and vendor verification strings, and asking an advertiser to append to that set
 * invites them to overwrite something that matters.
 *
 * The value is prefixed with a key so a resolver returning several TXT records
 * can be filtered without guessing which one is ours.
 */
export function buildRecord(domain: string, challenge: string): ChallengeRecord {
  const name = `${config.dnsRecordPrefix}.${domain.toLowerCase()}`;
  const value = `${config.dnsRecordKey}=${challenge}`;

  return {
    name,
    type: "TXT",
    value,
    instructions: [
      `In your DNS provider for ${domain}, create a TXT record.`,
      `Name / host: ${config.dnsRecordPrefix}   (some panels want the full name: ${name})`,
      `Value: ${value}`,
      "Save, then wait for propagation - usually under a minute, occasionally longer.",
      "Then trigger verification. The record can be removed once you are verified.",
    ],
  };
}

/** True if a TXT string is our challenge record carrying exactly this challenge. */
export function matchesChallenge(txt: string, challenge: string): boolean {
  const trimmed = txt.trim();
  if (!trimmed.startsWith(`${config.dnsRecordKey}=`)) return false;
  const value = trimmed.slice(config.dnsRecordKey.length + 1).trim();
  return value.toLowerCase() === challenge.toLowerCase();
}
