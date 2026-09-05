import { ContractTransactionReceipt, TransactionResponse, hexlify, randomBytes } from "ethers";
import { getSimulator, receiverWrite } from "./provider";
import { Tier } from "./reads";

export interface SubmitResult {
  hash: string;
  blockNumber: number;
  gasUsed: string;
}

/**
 * All attestation transactions are funnelled through one promise chain.
 *
 * The simulator is a single key. Two concurrent `sendTransaction` calls read the
 * same pending nonce, and the second either replaces the first or sticks in the
 * mempool forever. Serialising is not an optimisation here - it is the only
 * correct behaviour for a single-key sender.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  // Keep the chain alive after a rejection so one failure cannot wedge the queue.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function confirm(tx: TransactionResponse): Promise<SubmitResult> {
  const receipt = (await tx.wait()) as ContractTransactionReceipt;
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Record a domain verdict through the simulator path.
 *
 * `challenge` must be the one currently outstanding for this advertiser - read it
 * immediately before calling, never from a cache. `checkedAt` must not be in the
 * future or the receiver reverts `CheckTimestampInFuture`.
 */
export function submitDomainVerification(
  advertiser: string,
  verified: boolean,
  challenge: string,
  checkedAt: number,
): Promise<SubmitResult> {
  return serialise(async () => {
    const tx = await receiverWrite().submitDomainVerification(
      advertiser,
      verified,
      challenge,
      checkedAt,
    );
    return confirm(tx);
  });
}

/**
 * Record a spend tier through the simulator path.
 *
 * `windowEnd` must strictly exceed the last one recorded for this advertiser or
 * the tier contract reverts `StaleWindow`, and it must not exceed the current
 * block timestamp. See tiers/window.ts for the persistence that enforces the
 * first rule across restarts.
 */
export function submitTierAttestation(
  advertiser: string,
  tier: Tier,
  windowStart: number,
  windowEnd: number,
): Promise<SubmitResult> {
  return serialise(async () => {
    const tx = await receiverWrite().submitTierAttestation(
      advertiser,
      tier,
      windowStart,
      windowEnd,
    );
    return confirm(tx);
  });
}

/**
 * Deliver a pre-encoded CRE report through the forwarder entry point.
 *
 * Only usable once FORWARDER_ROLE is granted to the sending key. `metadata` must
 * be unique per delivery - the receiver keys replay protection on its hash and
 * rejects a repeat with `ReportAlreadyConsumed`.
 */
export function deliverReport(report: string, metadata?: string): Promise<SubmitResult> {
  const md = metadata ?? hexlify(randomBytes(32));
  return serialise(async () => {
    const tx = await receiverWrite().onReport(md, report);
    return confirm(tx);
  });
}

export async function encodeDomainReport(
  advertiser: string,
  verified: boolean,
  challenge: string,
  checkedAt: number,
): Promise<string> {
  return (await receiverWrite().encodeDomainReport(
    advertiser,
    verified,
    challenge,
    checkedAt,
  )) as string;
}

export async function encodeTierReport(
  advertiser: string,
  tier: Tier,
  windowStart: number,
  windowEnd: number,
): Promise<string> {
  return (await receiverWrite().encodeTierReport(
    advertiser,
    tier,
    windowStart,
    windowEnd,
  )) as string;
}

export async function simulatorStatus() {
  const signer = getSimulator();
  const provider = signer.provider!;
  const [balance, nonce] = await Promise.all([
    provider.getBalance(signer.address),
    provider.getTransactionCount(signer.address),
  ]);
  const receiver = receiverWrite();
  const role = await receiver.SIMULATOR_ROLE();
  const authorised = (await receiver.hasRole(role, signer.address)) as boolean;
  return { address: signer.address, balance: balance.toString(), nonce, authorised };
}
