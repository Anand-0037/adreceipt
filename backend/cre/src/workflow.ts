import { getAdvertiser, getChallenge } from "../../src/chain/reads";
import { buildRecord } from "../../src/dns/record";
import { closeWindow } from "../../src/tiers/compute";
import { nodeDomainDeps, nodeTierDeps } from "./adapters";
import { domainHandler, tierHandler, type DomainResult, type TierResult } from "./handlers";
import { encodeDomainReport, encodeTierReport } from "./report";
import type { DomainRequest, TierRequest } from "./boundary";

/**
 * Workflow orchestration.
 *
 * The split below mirrors how a CRE Confidential Workflow is structured:
 *
 *   prepare*   runs in the ordinary workflow context. Reads public chain state,
 *              assembles the handler input. Nothing sensitive happens here.
 *
 *   *Handler   runs inside the confidential TEE handler. This is the step that
 *              must be registered as confidential; it touches the DNS answer and
 *              the private spend figure.
 *
 *   encode*    turns the handler's public output into the report the Forwarder
 *              delivers to CREAttestationReceiver.onReport.
 *
 * The SDK registration itself is the one piece not written here - see
 * backend/cre/README.md for exactly what has to be filled in and why it was left
 * out rather than guessed.
 */

export async function prepareDomainRequest(advertiser: string): Promise<DomainRequest> {
  const record = await getAdvertiser(advertiser);
  const challenge = await getChallenge(advertiser);
  const dns = buildRecord(record.domain, challenge);

  return {
    advertiser,
    domain: record.domain,
    challenge,
    recordName: dns.name,
    expectedValue: dns.value,
  };
}

export async function runDomainWorkflow(advertiser: string): Promise<{
  request: DomainRequest;
  result: DomainResult;
  report: string;
}> {
  const request = await prepareDomainRequest(advertiser);
  // >>> confidential handler boundary >>>
  const result = await domainHandler(request, nodeDomainDeps);
  // <<< only result.publicOutput crosses back <<<
  return { request, result, report: encodeDomainReport(result.publicOutput) };
}

export async function prepareTierRequest(advertiser: string): Promise<TierRequest> {
  const { windowStart, windowEnd } = await closeWindow();
  return { advertiser, windowStart, windowEnd };
}

export async function runTierWorkflow(advertiser: string): Promise<{
  request: TierRequest;
  result: TierResult;
  report: string;
}> {
  const request = await prepareTierRequest(advertiser);
  // >>> confidential handler boundary >>>
  const result = await tierHandler(request, nodeTierDeps);
  // <<< only result.publicOutput crosses back <<<
  return { request, result, report: encodeTierReport(result.publicOutput) };
}
