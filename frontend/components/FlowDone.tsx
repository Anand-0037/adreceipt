import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Closing panel for the publisher and payer flows.
 *
 * Both flows used to simply stop on their last step, leaving no way onward.
 * This is deliberately a choice rather than an automatic redirect: the last
 * step hands you something you still have to act on - a quote to copy, a
 * receipt to follow - and navigating away on a timer would destroy it.
 */
export function FlowDone({
  title,
  children,
  next,
}: {
  title: string;
  children: ReactNode;
  next?: { href: string; label: string };
}) {
  return (
    <section className="flow-done">
      <h2>{title}</h2>
      <p>{children}</p>
      <div className="flow-done-actions">
        <Link href="/" className="nb-btn nb-btn-lime">
          Back to home
        </Link>
        {next && (
          <Link href={next.href} className="nb-btn">
            {next.label}
          </Link>
        )}
      </div>
    </section>
  );
}
