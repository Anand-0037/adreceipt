"use client";

import { useEffect, useState } from "react";
import { RecommendationCard } from "@/components/Badge";
import { api, type Badge } from "@/lib/api";

/**
 * The consumer view: ask a question, get recommendations, see who paid.
 *
 * The prose beside each recommendation is placeholder copy standing in for a
 * language model. That separation is deliberate and is the claim the project
 * makes: the model may write the description, but every factual assertion in the
 * badge - verified, tier, placements, age - is read from chain state, and the
 * ordering is computed by the backend from those facts. Swapping the copy for a
 * real model changes nothing a user is asked to trust.
 */

const BLURBS: Record<string, string> = {
  DeployCo: "Managed Node hosting with zero-config deploys and automatic scaling.",
  RenderStack: "Container platform with predictable pricing and no cold starts.",
  QuickDeploy: "One-command deploys with edge caching included.",
  HostFast: "Budget Node hosting, marketed as the fastest way to ship.",
  SmokeTest: "Placeholder entry created while testing the pipeline.",
};

const SUGGESTIONS = [
  "Where should I deploy a Node backend?",
  "Which backend hosting should I use?",
];

/** Map a question to a topic. A language model would do this; keywords suffice for now. */
function topicFor(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("host") || q.includes("deploy") || q.includes("backend")) return "backend hosting";
  return "backend hosting";
}

export default function AskPage() {
  const [question, setQuestion] = useState(SUGGESTIONS[0]);
  const [submitted, setSubmitted] = useState<string | null>(SUGGESTIONS[0]);
  const [hideSponsored, setHideSponsored] = useState(false);
  const [results, setResults] = useState<Badge[] | null>(null);
  const [everyone, setEveryone] = useState<Badge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const topic = topicFor(submitted);
    Promise.all([
      api.advertisersInCategory(topic, { verified: true, hideSponsored }),
      api.advertisers({ verified: true }),
    ])
      .then(([inTopic, all]) => {
        if (cancelled) return;
        setResults(inTopic.advertisers);
        setEveryone(all.advertisers);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [submitted, hideSponsored]);

  // Verified advertisers that have never paid. Shown separately so "unpaid"
  // reads as a neutral fact rather than as a merit badge.
  const unpaid = everyone.filter(
    (a) => a.tierLabel === "none" && !results?.some((r) => r.address === a.address),
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-[22px] font-semibold tracking-tight">
          Ask, and see who paid to be in the answer
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          Every recommendation below carries a badge read live from Ethereum Sepolia: whether the
          advertiser proved it controls its domain, and roughly how much it has spent.
        </p>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(question);
        }}
        className="space-y-3"
      >
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a product category…"
            className="flex-1 rounded-md border px-3 py-2 text-[14px] outline-none focus:border-[var(--border-strong)]"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          />
          <button
            type="submit"
            className="rounded-md px-4 py-2 text-[13px] font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Ask
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                setSubmitted(s);
              }}
              className="rounded-full border px-3 py-1 hover:underline"
              style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
            >
              {s}
            </button>
          ))}

          <label
            className="ml-auto flex cursor-pointer items-center gap-2"
            style={{ color: "var(--ink-muted)" }}
          >
            <input
              type="checkbox"
              checked={hideSponsored}
              onChange={(e) => setHideSponsored(e.target.checked)}
            />
            Hide sponsored results
          </label>
        </div>
      </form>

      {error && (
        <p className="rounded-md border p-3 text-[13px]" style={{ borderColor: "var(--tier-major)", color: "var(--tier-major)" }}>
          Could not reach the registry: {error}
        </p>
      )}

      {loading && (
        <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
          Reading contracts…
        </p>
      )}

      {results && !loading && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium" style={{ color: "var(--ink-muted)" }}>
            {results.length === 0
              ? "No sponsored results"
              : `${results.length} sponsored recommendation${results.length === 1 ? "" : "s"}`}
          </h2>

          {results.map((badge, i) => (
            <RecommendationCard
              key={badge.address}
              badge={badge}
              rank={i + 1}
              blurb={BLURBS[badge.name]}
            />
          ))}

          {hideSponsored && (
            <p className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
              Sponsored results are hidden. Note that the ranking changed — spend was part of it.
            </p>
          )}
        </section>
      )}

      {unpaid.length > 0 && !loading && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium" style={{ color: "var(--ink-muted)" }}>
            Also verified, no payment on record
          </h2>
          {unpaid.map((badge) => (
            <RecommendationCard key={badge.address} badge={badge} blurb={BLURBS[badge.name]} />
          ))}
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            These advertisers proved their domain but have never paid for a placement. That is a
            fact about the registry, not a compliment — a company may simply have chosen not to
            participate.
          </p>
        </section>
      )}
    </div>
  );
}
