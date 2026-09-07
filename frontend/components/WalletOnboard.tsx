"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthAside } from "@/components/AuthAside";
import { Reveal } from "@/components/Reveal";
import { markEntered } from "@/lib/session";
import {
  type Balances,
  balances,
  connect,
  currentAccount,
  describeWalletError,
  hasWallet,
  registerAdvertiser,
} from "@/lib/wallet";
import { protocol } from "@/lib/protocol";

type Role = "publisher" | "advertiser" | "reader";

const ROLES: { id: Role; label: string; href: string; blurb: string }[] = [
  {
    id: "publisher",
    label: "Publisher",
    href: "/publisher",
    blurb: "You write recommendations and want to be paid for them.",
  },
  {
    id: "advertiser",
    label: "Advertiser",
    href: "/advertiser",
    blurb: "You pay for placements and want proof of what you bought.",
  },
  {
    id: "reader",
    label: "Reader / auditor",
    href: "/ledger",
    blurb: "You want to check receipts other people published.",
  },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * AdReceipt has no accounts or passwords — a wallet is the identity. These two
 * screens keep the familiar sign-in shape while doing what the protocol
 * actually supports: connect, pick a role, and optionally stake a domain claim
 * on-chain via the advertiser registry.
 */
export function WalletOnboard({ mode }: { mode: "register" | "login" }) {
  const registering = mode === "register";
  const router = useRouter();

  const [address, setAddress] = useState<string | null>(null);
  const [funds, setFunds] = useState<Balances | null>(null);
  const [role, setRole] = useState<Role>("publisher");
  const [brand, setBrand] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [noWallet, setNoWallet] = useState(false);

  // Reflect a wallet that is already authorised for this site.
  useEffect(() => {
    if (!hasWallet()) {
      setNoWallet(true);
      return;
    }
    currentAccount().then((a) => a && setAddress(a));
  }, []);

  useEffect(() => {
    if (!address) return;
    balances(address)
      .then(setFunds)
      .catch(() => setFunds(null));
  }, [address]);

  const onConnect = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const { address: a } = await connect();
      setAddress(a);
      markEntered();
      // Sign-in is the way in; the landing page is what you land on.
      if (!registering) router.push("/");
    } catch (e) {
      setError(describeWalletError(e));
    } finally {
      setBusy(false);
    }
  }, [registering, router]);

  /** Escape hatch: readers and auditors need the site without a wallet. */
  const onBrowse = useCallback(() => {
    markEntered();
    router.push("/");
  }, [router]);

  const onClaim = useCallback(async () => {
    setError("");
    setTxHash("");
    setBusy(true);
    try {
      const hash = await registerAdvertiser(brand.trim(), domain.trim());
      setTxHash(hash);
    } catch (e) {
      setError(describeWalletError(e));
    } finally {
      setBusy(false);
    }
  }, [brand, domain]);

  // `role` is only ever set from ROLES, but fall back rather than assert.
  const chosen = ROLES.find((r) => r.id === role) ?? ROLES[0];
  // A registry claim names a domain you can later prove with a DNS record, so
  // it has to look like a hostname. Report *which* field is wrong rather than
  // silently leaving the button disabled.
  const brandValue = brand.trim();
  const domainValue = domain.trim();
  const brandOk = brandValue.length > 1;
  const domainOk = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    domainValue,
  );
  const brandBad = brandValue.length > 0 && !brandOk;
  const domainBad = domainValue.length > 0 && !domainOk;

  const canClaim = Boolean(address) && brandOk && domainOk;

  const claimHint = !brandValue
    ? "Enter a brand name to continue."
    : !brandOk
      ? "The brand name needs at least two characters."
      : !domainValue
        ? "Enter the domain you will prove."
        : !domainOk
          ? "That is not a valid domain."
          : "Sends one transaction.";

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <AuthAside registering={registering} />
        <div className="auth-form-col">
          <div className="auth-form-inner">
            <div className="auth-head">
              <h1>{registering ? "Create your AdReceipt identity" : "Sign in with your wallet"}</h1>
              <p>
                {registering
                  ? "There is no email or password here. Your wallet is the account, and any claim you make is recorded on Sepolia where anyone can check it."
                  : "Connect the wallet you already use for AdReceipt. Nothing is stored on our side — the connection lives in your browser."}
              </p>
            </div>

            {noWallet && (
              <div className="auth-error">
                No browser wallet found. Install MetaMask, or open this page in a wallet browser.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            {txHash && (
              <div className="auth-ok">
                Claim submitted in{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                >
                  {short(txHash)} ↗
                </a>
                . It proves you control the wallet, not yet the domain.
              </div>
            )}

            {/* ── 1. Wallet ─────────────────────────────────────────────────────── */}
            <Reveal immediate>
              <section className="auth-card">
                <div className="auth-card-head">
                  <span className="auth-avatar" aria-hidden>
                    1
                  </span>
                  <h2>Wallet</h2>
                  <span className="auth-step">{address ? "Connected" : "Required"}</span>
                </div>

                {address ? (
                  /* Connected values are read-only, so a compact summary says
                     the same thing as four disabled inputs in half the height -
                     which is what keeps the connected screen inside one view. */
                  <dl className="auth-summary">
                    <div>
                      <dt>Address</dt>
                      <dd className="mono">{short(address)}</dd>
                    </div>
                    <div>
                      <dt>Network</dt>
                      <dd>
                        {protocol.network} · {protocol.chainId}
                      </dd>
                    </div>
                    <div>
                      <dt>Sepolia ETH</dt>
                      <dd className="mono">
                        {funds ? Number(funds.eth).toFixed(4) : "—"}
                        {funds && !funds.hasGas && <em> low</em>}
                      </dd>
                    </div>
                    <div>
                      <dt>Test USDC</dt>
                      <dd className="mono">{funds ? Number(funds.usdc).toFixed(2) : "—"}</dd>
                    </div>
                  </dl>
                ) : (
                  <div className="auth-row auth-row-flow">
                    <div className="auth-field">
                      <label htmlFor="wallet-address">Address</label>
                      <input id="wallet-address" placeholder="Not connected" disabled />
                    </div>
                    <div className="auth-field">
                      <label htmlFor="wallet-network">Network</label>
                      <input
                        id="wallet-network"
                        value={`${protocol.network} · ${protocol.chainId}`}
                        disabled
                      />
                    </div>
                  </div>
                )}

                {!address && (
                  <div className="auth-actions">
                    <button
                      type="button"
                      className="nb-btn"
                      onClick={onConnect}
                      disabled={busy || noWallet}
                    >
                      {busy ? "Check your wallet…" : "Connect wallet"}
                    </button>
                    <span className="auth-status">You will be asked to switch to Sepolia.</span>
                  </div>
                )}
              </section>
            </Reveal>

            {/* ── 2. Role ───────────────────────────────────────────────────────── */}
            <Reveal delay={0.06} immediate>
              <section className={`auth-card${address ? "" : " auth-locked"}`}>
                <div className="auth-card-head">
                  <span className="auth-avatar auth-avatar-2" aria-hidden>
                    2
                  </span>
                  <h2>How will you use AdReceipt?</h2>
                  <span className="auth-step">Pick one</span>
                </div>

                {/* A fieldset/legend is the native grouping for a set of
                  choices - it needs no ARIA and reads correctly unlabelled. */}
                <fieldset className="auth-field auth-fieldset">
                  <legend>Role</legend>
                  <div className="auth-chips">
                    {ROLES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="auth-chip"
                        aria-pressed={role === r.id}
                        onClick={() => setRole(r.id)}
                      >
                        {r.label}
                        {role === r.id && <i aria-hidden>✕</i>}
                      </button>
                    ))}
                  </div>
                  <p className="auth-help">{chosen.blurb}</p>
                </fieldset>
              </section>
            </Reveal>

            {/* ── 3. Domain claim, registration only ────────────────────────────── */}
            {/* The claim needs a wallet to sign it, so it only appears once one
                is connected. That also keeps the screen inside one viewport. */}
            {registering && address && (
              <Reveal delay={0.12} immediate>
                <section className={`auth-card${address ? "" : " auth-locked"}`}>
                  <div className="auth-card-head">
                    <span className="auth-avatar auth-avatar-3" aria-hidden>
                      3
                    </span>
                    <h2>Claim a brand and domain</h2>
                    <span className="auth-step">Optional</span>
                  </div>

                  <div className="auth-row">
                    <div className="auth-field">
                      <label htmlFor="brand">Brand name</label>
                      <input
                        id="brand"
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        placeholder="Northwind Coffee"
                        aria-invalid={brandBad}
                        aria-describedby={brandBad ? "brand-error" : undefined}
                      />
                      {brandBad && (
                        <p id="brand-error" className="field-error">
                          At least two characters.
                        </p>
                      )}
                    </div>
                    <div className="auth-field">
                      <label htmlFor="domain">Domain</label>
                      <input
                        id="domain"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        placeholder="northwind.example"
                        spellCheck={false}
                        aria-invalid={domainBad}
                        aria-describedby={domainBad ? "domain-error" : undefined}
                      />
                      {domainBad && (
                        <p id="domain-error" className="field-error">
                          Needs a dot, like northwind.example — not just a word.
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="auth-help">
                    This writes a claim to the advertiser registry on Sepolia and costs gas. The
                    claim on its own proves nothing — you verify the domain separately with a DNS
                    record.
                  </p>

                  <div className="auth-actions">
                    <button
                      type="button"
                      className="nb-btn"
                      onClick={onClaim}
                      disabled={!canClaim || busy}
                    >
                      {busy ? "Confirm in wallet…" : "Register claim"}
                    </button>
                    <span className="auth-status">{claimHint}</span>
                  </div>
                </section>
              </Reveal>
            )}

            {/* One action area for the whole screen. Folding the role card's
                button in here keeps the flow inside a single viewport, and
                connecting is never required just to read receipts. */}
            <div className="auth-actions auth-actions-end">
              {address && (
                <Link href={chosen.href} className="nb-btn nb-btn-lime">
                  Continue to {chosen.label.toLowerCase()} tools
                </Link>
              )}
              <button type="button" className="nb-btn" onClick={onBrowse}>
                {address ? "Go to the site" : "Browse without connecting"}
              </button>
            </div>

            <p className="auth-switch">
              {registering ? (
                <>
                  Already connected before? <Link href="/login">Sign in</Link>
                </>
              ) : (
                <>
                  First time here? <Link href="/register">Create your identity</Link>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
