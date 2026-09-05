import { explorer, type Badge as BadgeData, type TierLabel } from "@/lib/api";

/**
 * The disclosure badge.
 *
 * Four states, and the wording of each is load-bearing:
 *
 *   verified + tier   the advertiser proved its domain and has paid
 *   verified, no tier proved its domain and has never paid
 *   revoked           was verified, is not now
 *   not in registry   we have no record - which is a statement about our
 *                     database, never an accusation about the company
 *
 * That last one matters most. The registry only stores payments made through
 * its own escrow, so it is structurally incapable of saying anything about a
 * company that is not its customer. "Not in registry" is the strongest claim
 * available, and it is a weak one on purpose.
 */

const TIER_COPY: Record<TierLabel, string> = {
  none: "No payment on record",
  minimal: "Minimal spend",
  moderate: "Moderate spend",
  major: "Major spend",
};

const TIER_COLOR: Record<TierLabel, string> = {
  none: "var(--tier-none)",
  minimal: "var(--tier-minimal)",
  moderate: "var(--tier-moderate)",
  major: "var(--tier-major)",
};

function age(days: number): string {
  if (days < 1) return "registered today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} old`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} old`;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function DisclosureBadge({ badge }: { badge: BadgeData }) {
  if (!badge.inRegistry) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        style={{ color: "var(--ink-faint)" }}
      >
        <Dot color="var(--ink-faint)" />
        <span>Not in registry</span>
        <span aria-hidden>·</span>
        <span>no verification record found</span>
      </div>
    );
  }

  if (badge.status === "revoked") {
    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        style={{ color: "var(--tier-major)" }}
      >
        <Dot color="var(--tier-major)" />
        <span>Verification revoked</span>
        <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
        <span style={{ color: "var(--ink-faint)" }}>claimed {badge.domain}</span>
      </div>
    );
  }

  if (badge.status === "pending") {
    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        style={{ color: "var(--ink-faint)" }}
      >
        <Dot color="var(--ink-faint)" />
        <span>Awaiting domain proof</span>
        <span aria-hidden>·</span>
        <span>{badge.domain}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      <Dot color="var(--accent)" />
      <span style={{ color: "var(--ink)" }}>Verified</span>
      <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
      <a
        href={explorer.address(badge.address)}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
        style={{ color: "var(--ink-muted)" }}
      >
        {badge.domain}
      </a>
      <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
      <span style={{ color: TIER_COLOR[badge.tierLabel] }}>{TIER_COPY[badge.tierLabel]}</span>

      {badge.placements > 0 && (
        <>
          <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
          <span style={{ color: "var(--ink-muted)" }}>
            {badge.placements} placement{badge.placements === 1 ? "" : "s"}
          </span>
        </>
      )}

      <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
      <span style={{ color: "var(--ink-muted)" }}>{age(badge.accountAgeDays)}</span>

      {badge.ensName && (
        <>
          <span aria-hidden style={{ color: "var(--ink-faint)" }}>·</span>
          <span className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {badge.ensName}
          </span>
        </>
      )}
    </div>
  );
}

/** A recommendation as an assistant would surface it, with its badge attached. */
export function RecommendationCard({
  badge,
  blurb,
  rank,
}: {
  badge: BadgeData;
  blurb?: string;
  rank?: number;
}) {
  return (
    <article
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-baseline gap-2">
        {rank !== undefined && (
          <span className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {rank}.
          </span>
        )}
        <h3 className="text-[15px] font-medium">{badge.name || "Unknown"}</h3>
      </div>

      {blurb && (
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          {blurb}
        </p>
      )}

      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <DisclosureBadge badge={badge} />
      </div>
    </article>
  );
}
