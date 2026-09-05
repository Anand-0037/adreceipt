import { Resolver } from "node:dns/promises";
import { config } from "../config";

export interface ResolverResult {
  resolver: string;
  records: string[];
  error?: string;
}

export interface LookupResult {
  name: string;
  perResolver: ResolverResult[];
  /** Records every reachable resolver agreed on. */
  agreed: string[];
  /** True when at least two resolvers answered and their answers matched. */
  quorum: boolean;
  reachable: number;
}

/** A TXT answer can be split into chunks of <=255 bytes; join them back. */
function flatten(chunks: string[][]): string[] {
  return chunks.map((parts) => parts.join(""));
}

/**
 * Codes that are a definitive answer rather than a failure to get one.
 *
 * ENOTFOUND is NXDOMAIN: the name does not exist. ENODATA: the name exists but
 * holds no TXT. Both mean "there is no record", which is exactly what we asked.
 * Everything else - timeout, refused, SERVFAIL - means we did not learn anything.
 *
 * The distinction is load-bearing. Folding NXDOMAIN into "unreachable" would
 * make an advertiser who simply never publishes the record un-attestable
 * forever, because `isAttestable` refuses to write a verdict we could not
 * establish. The negative path of the entire verification flow depends on this.
 */
const DEFINITIVE_EMPTY = new Set(["ENOTFOUND", "ENODATA"]);

async function queryOne(name: string, server: string): Promise<ResolverResult> {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers([server]);
  try {
    const records = flatten(await resolver.resolveTxt(name));
    return { resolver: server, records: records.map((r) => r.trim()).sort() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (DEFINITIVE_EMPTY.has(code)) {
      // Answered, and the answer is "nothing here".
      return { resolver: server, records: [] };
    }
    return {
      resolver: server,
      records: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve a TXT record across several independent resolvers and require them to
 * agree.
 *
 * A single resolver is a single point of both failure and trust: it can be stale,
 * it can be poisoned, and on a hostile network it can be substituted outright.
 * Requiring agreement between independent resolvers is the cheapest meaningful
 * defence, and it is the part of the check that has to happen inside the enclave
 * once this logic moves into the confidential workflow.
 */
export async function resolveTxt(name: string): Promise<LookupResult> {
  const perResolver = await Promise.all(
    config.dnsResolvers.map((server) => queryOne(name, server)),
  );

  const answered = perResolver.filter((r) => !r.error);
  const reachable = answered.length;

  if (reachable === 0) {
    return { name, perResolver, agreed: [], quorum: false, reachable };
  }

  // Intersection: only records every reachable resolver returned.
  const agreed = answered[0].records.filter((record) =>
    answered.every((r) => r.records.includes(record)),
  );

  return { name, perResolver, agreed, quorum: reachable >= 2, reachable };
}
