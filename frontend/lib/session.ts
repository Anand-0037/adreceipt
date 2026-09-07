"use client";

/**
 * Landing-page entry gate.
 *
 * AdReceipt has no server-side sessions: a wallet is the identity. This only
 * records that someone has passed through /login or /register in this browser,
 * so the landing page can be the second screen rather than the first. It is a
 * navigation convenience, never a security boundary - every action that matters
 * is still authorised by a wallet signature on-chain.
 */
const KEY = "adreceipt.entered";

export function markEntered(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Private mode or blocked storage: the gate simply never latches.
  }
}

export function hasEntered(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    // If we cannot read the flag, let the person through rather than trap them.
    return true;
  }
}
