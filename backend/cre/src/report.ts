import { AbiCoder } from "ethers";
import type { DomainPublic, TierPublic } from "./boundary";

/**
 * Report encoding, done locally.
 *
 * `CREAttestationReceiver` exposes `encodeDomainReport` / `encodeTierReport` as
 * pure helpers, but calling them costs an RPC round trip from inside the
 * workflow. Encoding here keeps the enclave step self-contained; the shape is
 * asserted against the on-chain encoders in the verification script, so drift
 * between the two is caught rather than discovered at submission time.
 *
 * Wire format, matching the receiver:
 *   abi.encode(uint8 kind, bytes payload)
 * with
 *   kind 1 -> abi.encode(address advertiser, bool verified, bytes32 challenge, uint64 checkedAt)
 *   kind 2 -> abi.encode(address advertiser, uint8 tier, uint64 windowStart, uint64 windowEnd)
 */
export const REPORT_DOMAIN_VERIFICATION = 1;
export const REPORT_TIER_ATTESTATION = 2;

const coder = AbiCoder.defaultAbiCoder();

export function encodeDomainReport(output: DomainPublic): string {
  const payload = coder.encode(
    ["address", "bool", "bytes32", "uint64"],
    [output.advertiser, output.verified, output.challenge, output.checkedAt],
  );
  return coder.encode(["uint8", "bytes"], [REPORT_DOMAIN_VERIFICATION, payload]);
}

export function encodeTierReport(output: TierPublic): string {
  const payload = coder.encode(
    ["address", "uint8", "uint64", "uint64"],
    [output.advertiser, output.tier, output.windowStart, output.windowEnd],
  );
  return coder.encode(["uint8", "bytes"], [REPORT_TIER_ATTESTATION, payload]);
}

/**
 * Metadata accompanying a delivery.
 *
 * The receiver keys replay protection on `keccak256(metadata)`, so this must be
 * unique per delivery. In production the CRE Forwarder supplies its own workflow
 * provenance here; this exists for simulation runs and local delivery.
 */
export function simulationMetadata(runId: string): string {
  return coder.encode(["string", "uint256"], [runId, Date.now()]);
}
