import { Router } from "express";
import { ZeroHash } from "ethers";
import { config, contracts, deployment } from "../config";
import { getProvider, hasSimulator } from "../chain/provider";
import { getAdvertiser, getBadge, getChallenge, isFlagged } from "../chain/reads";
import { simulatorStatus, submitDomainVerification } from "../chain/writes";
import { buildRecord } from "../dns/record";
import { checkDomain, isAttestable } from "../dns/verify";
import { asyncRoute, badRequest, notFound, parseAddress } from "./errors";

export const routes = Router();

/**
 * Liveness plus enough context to tell which deployment this server is pointed
 * at. The submission needs a live URL, and this is what proves it is wired to
 * the same contracts the demo uses.
 */
routes.get(
  "/health",
  asyncRoute(async (_req, res) => {
    const provider = getProvider();
    const block = await provider.getBlockNumber();
    return res.json({
      ok: true,
      network: config.network,
      chainId: config.chainId,
      block,
      contracts,
      attestationKey: hasSimulator() ? "configured" : "missing",
    });
  }),
);

/** Deeper check: is the attestation key actually authorised, and can it pay? */
routes.get(
  "/health/attestation",
  asyncRoute(async (_req, res) => {
    if (!hasSimulator()) {
      throw notFound("no-simulator", "CRE_SIMULATOR_PRIVATE_KEY is not configured");
    }
    const status = await simulatorStatus();
    return res.json({
      ...status,
      ready: status.authorised && BigInt(status.balance) > 0n,
    });
  }),
);

/**
 * The DNS record an advertiser must publish.
 *
 * Read live from the chain every time. An advertiser who calls `updateClaim`
 * gets a new challenge, and handing back a cached one would send them to publish
 * a record that can never verify.
 */
routes.get(
  "/advertisers/:address/challenge",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const advertiser = await getAdvertiser(address);

    if (advertiser.challenge === ZeroHash || !advertiser.domain) {
      throw notFound(
        "not-registered",
        "No advertiser claim for this address. Call register(name, domain) first.",
      );
    }

    const record = buildRecord(advertiser.domain, advertiser.challenge);
    return res.json({
      address,
      name: advertiser.name,
      domain: advertiser.domain,
      status: advertiser.statusLabel,
      challenge: advertiser.challenge,
      record,
    });
  }),
);

/**
 * Run the DNS check and, if it produced a real verdict, record it on-chain.
 *
 * `?dryRun=true` performs the lookup and returns the outcome without writing.
 * Useful while an advertiser is still waiting for propagation, since it costs no
 * gas and cannot revoke anything.
 */
routes.post(
  "/advertisers/:address/verify",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    const dryRun = req.query.dryRun === "true";

    const result = await checkDomain(address);

    if (result.outcome === "not-registered") {
      throw notFound("not-registered", "No advertiser claim for this address.");
    }

    if (!isAttestable(result)) {
      // Every resolver was unreachable. That is not a failed proof, so we
      // deliberately do not write `false` - it would revoke a legitimate claim.
      return res.status(503).json({
        address,
        outcome: result.outcome,
        verified: false,
        attested: false,
        message: "No resolver could be reached. Nothing was written on-chain.",
        lookup: result.lookup,
      });
    }

    if (dryRun) {
      return res.json({ ...result, attested: false, dryRun: true });
    }

    if (!hasSimulator()) {
      throw badRequest(
        "no-simulator",
        "CRE_SIMULATOR_PRIVATE_KEY is not configured, so the verdict cannot be recorded.",
      );
    }

    // Re-read the challenge at the last moment. If the advertiser changed their
    // claim during the lookup, the verdict belongs to a claim that no longer
    // exists and must not be submitted.
    const current = await getChallenge(address);
    if (current !== result.challenge) {
      throw badRequest(
        "challenge-changed",
        "The claim changed during verification. Publish the new record and retry.",
        { checked: result.challenge, current },
      );
    }

    const receipt = await submitDomainVerification(
      address,
      result.verified,
      result.challenge,
      result.checkedAt,
    );

    return res.json({ ...result, attested: true, transaction: receipt });
  }),
);

/** Everything one disclosure badge needs. */
routes.get(
  "/advertisers/:address/status",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    return res.json(await getBadge(address));
  }),
);

/**
 * The auditor view's single legible rule. Kept off the badge endpoint on
 * purpose: the chat UI must not editorialise on the flag.
 */
routes.get(
  "/advertisers/:address/flag",
  asyncRoute(async (req, res) => {
    const address = parseAddress(req.params.address);
    return res.json({ address, flagged: await isFlagged(address) });
  }),
);

routes.get("/deployment", (_req, res) => {
  res.json(deployment);
});
