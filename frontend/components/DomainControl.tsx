"use client";

import { useCallback, useEffect, useState } from "react";
import { domainApi, explorer, type DomainControl as Control } from "@/lib/api";
import { describeWalletError, registerAdvertiser, signAuthorisation } from "@/lib/wallet";

/**
 * Domain control for the connected wallet.
 *
 * The wording is deliberate throughout. A TXT record proves control of DNS at a
 * moment in time - it says nothing about trademark, company employment, or any
 * right to the brand name - so this reads "domain control", never "verified
 * brand".
 *
 * Checking is free and unauthenticated because DNS is public. Recording costs
 * gas and touches an identity, so it needs the wallet's own signature. And a
 * failed check is never written: it would revoke the advertiser, and a resolver
 * having a bad minute is not evidence about anybody's domain.
 */

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <div>
        <dt>{label}</dt>
        <dd className="mono">{value}</dd>
      </div>
      <button
        type="button"
        className="example-button"
        onClick={() =>
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function DomainControl({ account }: { account: string | null }) {
  const [control, setControl] = useState<Control | null>(null);
  const [brand, setBrand] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const load = useCallback(async (who: string) => {
    try {
      setControl(await domainApi.status(who));
    } catch (cause) {
      setControl(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (account) void load(account);
  }, [account, load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!account) return <p className="field-help">Connect a wallet first.</p>;

  // ── Not registered ─────────────────────────────────────────────────────
  if (control && !control.registered) {
    return (
      <>
        <p className="result-summary">
          Claim the brand you advertise as and the domain you control. Anyone can claim anything
          here — the claim proves nothing until the DNS check passes, which is exactly why claiming
          is free.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await registerAdvertiser(brand.trim(), domain.trim());
              await load(account);
            });
          }}
        >
          <label htmlFor="dc-brand">Display name</label>
          <input id="dc-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="DeployCo" />
          <label htmlFor="dc-domain" style={{ marginTop: 14 }}>
            Domain you control
          </label>
          <div className="lookup-line">
            <input
              id="dc-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="deployco.com"
              spellCheck={false}
              className="mono"
            />
            <button type="submit" disabled={busy || !brand.trim() || !domain.trim()}>
              {busy ? "Confirm in wallet…" : "Register claim"}
            </button>
          </div>
          <p className="field-help">
            One claim per wallet, permanent, and it costs Sepolia gas. A display name is not a
            trademark claim — this records what you call yourself, not who owns the name.
          </p>
        </form>
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }

  if (!control) return <p className="field-help">Reading the registry…</p>;

  const controlled = control.state === "controlled";

  return (
    <>
      <p className="result-summary">
        <strong>{control.name}</strong> claims <span className="mono">{control.domain}</span>.
        {control.recordedOnChain && " Domain control is recorded on-chain."}
      </p>

      {!controlled && control.record && (
        <>
          <p className="field-help" style={{ marginBottom: 10 }}>
            Publish this TXT record, then check. Leave it in place afterwards — removing it makes a
            later check indistinguishable from losing the domain.
          </p>
          <dl className="record-block">
            <CopyRow label="Record name" value={control.record.name} />
            <CopyRow label="Type" value={control.record.type} />
            <CopyRow label="Value" value={control.record.value} />
          </dl>
        </>
      )}

      <div className="lookup-line" style={{ marginTop: 16 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setNote(null);
              setTxHash(null);
              const next = await domainApi.status(account);
              setControl(next);
              setNote(next.message);
            })
          }
        >
          {busy ? "Reading DNS…" : "Check now"}
        </button>

        {control.recordable && !control.recordedOnChain && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                // Sign first: recording touches this identity and spends gas,
                // so it must be authorised by the wallet it concerns.
                const auth = await domainApi.authorisation(account);
                const signature = await signAuthorisation(auth.message);
                const result = await domainApi.attest(account, auth.issuedAt, signature);
                setNote(result.message);
                setTxHash(result.transaction?.hash ?? null);
                await load(account);
              })
            }
          >
            Sign and record on-chain
          </button>
        )}
      </div>

      <p className={`verdict verdict-${controlled ? "ok" : "no"}`}>
        <strong>{controlled ? "Domain controlled" : "Not established"}</strong>
        <span>{note ?? control.message}</span>
        {control.resolversAnswered !== undefined && (
          <span className="field-help">
            {control.resolversAnswered} of 2 resolvers answered. Both must agree before a proof
            counts.
          </span>
        )}
        {control.state === "undetermined" && (
          <span className="field-help">
            Nothing was written. A resolver we could not reach says nothing about your domain, and
            recording a failure would revoke a claim that may be perfectly good.
          </span>
        )}
        {txHash && (
          <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="text-link">
            View the attestation ↗
          </a>
        )}
      </p>

      <p className="field-help">
        Domain control is not brand ownership, and it does not affect whether a payment verifies. A
        receipt is judged only on the settlement itself; publishers may treat domain control as an
        acceptance rule of their own.
      </p>

      {error && <p className="form-error">{error}</p>}
    </>
  );
}
