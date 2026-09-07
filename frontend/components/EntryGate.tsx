"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasEntered, markEntered } from "@/lib/session";
import { currentAccount } from "@/lib/wallet";

/**
 * Sends first-time visitors to /login before the landing page.
 *
 * A wallet that is already authorised for this origin counts as entered, so
 * returning users never see the sign-in screen again. The check runs after
 * mount - doing it during render would desync the server and client markup.
 */
export function EntryGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;

    (async () => {
      if (hasEntered()) {
        if (live) {
          setAllowed(true);
          setChecked(true);
        }
        return;
      }

      // An already-connected wallet is proof enough; skip the sign-in screen.
      const account = await currentAccount().catch(() => null);
      if (!live) return;

      if (account) {
        markEntered();
        setAllowed(true);
        setChecked(true);
        return;
      }

      setChecked(true);
      router.replace("/login");
    })();

    return () => {
      live = false;
    };
  }, [router]);

  if (!allowed) {
    return (
      <div className="nb-gate">{checked ? "Taking you to sign in…" : "Checking your wallet…"}</div>
    );
  }

  return <>{children}</>;
}
