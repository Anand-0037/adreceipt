import type { NextFunction, Request, Response } from "express";
import { Interface, isAddress } from "ethers";
import { ADVERTISER_REGISTRY_ABI, CRE_ATTESTATION_RECEIVER_ABI } from "../chain/abi";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, detail?: unknown) =>
  new HttpError(400, code, message, detail);

export const notFound = (code: string, message: string) => new HttpError(404, code, message);

/**
 * Validate and normalise an `:address` path parameter.
 *
 * Checksums are not enforced - wallets and copy-paste both produce lowercase -
 * but the shape is, so a typo fails here with a clear message rather than
 * further down as an opaque decode error.
 */
export function parseAddress(raw: string): string {
  if (!isAddress(raw)) {
    throw badRequest("invalid-address", `"${raw}" is not a valid Ethereum address`);
  }
  return raw;
}

/** Wraps an async handler so a rejection reaches the error middleware. */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * Turn a contract revert into something a client can act on.
 *
 * ethers surfaces custom errors by name once the ABI declares them, which is why
 * the receiver fragments in chain/abi.ts list every error the contracts can
 * raise. Without that these all collapse into "execution reverted".
 */
function describeRevert(error: unknown): { code: string; message: string } | undefined {
  const anyErr = error as {
    shortMessage?: string;
    message?: string;
    revert?: { name?: string };
    data?: string;
    info?: { error?: { data?: string } };
  };

  // ethers fills `revert` for a decoded call, but a revert raised during gas
  // estimation arrives as raw bytes with no interface attached, which is how a
  // legible custom error turns into "unknown custom error". Decode it ourselves.
  let name = anyErr?.revert?.name;
  if (!name) {
    const data = anyErr?.data ?? anyErr?.info?.error?.data;
    if (data && data !== "0x") {
      for (const iface of [
        new Interface(CRE_ATTESTATION_RECEIVER_ABI as unknown as string[]),
        new Interface(ADVERTISER_REGISTRY_ABI as unknown as string[]),
      ]) {
        try {
          name = iface.parseError(data)?.name ?? undefined;
        } catch {
          name = undefined;
        }
        if (name) break;
      }
    }
  }
  if (!name) return undefined;

  const known: Record<string, string> = {
    AccessControlUnauthorizedAccount:
      "The attestation key is not authorised on the receiver. Grant it SIMULATOR_ROLE.",
    AdvertiserNotRegistered: "That address has not registered an advertiser claim.",
    ChallengeMismatch:
      "The challenge changed between the DNS check and submission. Re-run verification.",
    CheckTimestampInFuture: "The check timestamp is ahead of the chain. Check the server clock.",
    ReportAlreadyConsumed: "That report metadata was already delivered.",
    StaleWindow: "A tier for an equal or later window is already recorded.",
    WindowInFuture: "The tier window has not closed yet.",
    NameClaimedByAnother: "Another verified advertiser already holds that brand name.",
    DomainClaimedByAnother: "Another verified advertiser already holds that domain.",
  };

  return { code: name, message: known[name] ?? `Contract reverted with ${name}.` };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.code, message: error.message, detail: error.detail });
    return;
  }

  const revert = describeRevert(error);
  if (revert) {
    res.status(409).json({ error: revert.code, message: revert.message });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error("unhandled:", message);
  res.status(500).json({ error: "internal", message });
}
