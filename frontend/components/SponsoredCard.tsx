"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  placementApi,
  type ContextDecisionV2,
  type PlacementMetricsV2,
  type PlacementRecordV2,
} from "@/lib/api";

const MEASUREMENT_SESSION_KEY = "adreceipt:v2:measurement-session";

function measurementSessionId(): string {
  const current = sessionStorage.getItem(MEASUREMENT_SESSION_KEY);
  if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
  const created = crypto.randomUUID();
  sessionStorage.setItem(MEASUREMENT_SESSION_KEY, created);
  return created;
}

/**
 * The sponsored card, shown only for a PAID_VERIFIED placement.
 *
 * It lives in two places: inline in the user's conversation, where it counts,
 * and on the publisher console as a preview. `measure` separates the two. An
 * impression is recorded once the card has been at least half visible for a
 * second, and a click when the person follows the link - and only from the
 * conversation, so a publisher looking at the console never inflates the
 * numbers an advertiser is paying for.
 */
export function SponsoredCard({
  placement,
  decision,
  measure,
}: {
  placement: PlacementRecordV2;
  decision: ContextDecisionV2;
  measure: boolean;
}) {
  const campaign = decision.winner?.campaign;
  const card = useRef<HTMLElement | null>(null);
  const impressionSent = useRef(false);
  const impressionInFlight = useRef(false);
  const [metrics, setMetrics] = useState<PlacementMetricsV2 | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!measure || placement.status !== "PAID_VERIFIED" || !card.current) return;
    if (impressionSent.current) return;
    const node = card.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          timer ??= setTimeout(() => {
            if (impressionSent.current || impressionInFlight.current) return;
            impressionInFlight.current = true;
            placementApi
              .measure(
                placement.placementId,
                "IMPRESSION",
                crypto.randomUUID(),
                measurementSessionId(),
              )
              .then((next) => {
                impressionSent.current = true;
                setMetrics(next);
              })
              .catch(() => undefined)
              .finally(() => {
                impressionInFlight.current = false;
              });
          }, 1_000);
        } else if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [measure, placement.placementId, placement.status]);

  async function clickThrough() {
    setError("");
    if (measure) {
      try {
        const next = await placementApi.measure(
          placement.placementId,
          "CLICK",
          crypto.randomUUID(),
          measurementSessionId(),
        );
        setMetrics(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Click could not be recorded.");
      }
    }
    window.open(placement.landingPage, "_blank", "noopener,noreferrer");
  }

  if (!campaign || placement.status !== "PAID_VERIFIED") return null;

  const topics = decision.context.topics.map((topic) => topic.toLowerCase().replaceAll("_", " "));
  const relevance = Math.round(Number(decision.winner?.relevance ?? 0) * 100);

  return (
    <>
      <article ref={card} className="sponsored-candidate sponsored-verified">
        <div className="candidate-label">Sponsored · Verified ✓</div>
        <h2>{campaign.creativeHeadline}</h2>
        <p>{campaign.creativeBody}</p>
        <div className="candidate-meta">
          <span>{campaign.brandDisplayName}</span>
          <span>Payment and context bound</span>
          <Link href={`/receipts/${placement.receiptId}`}>View receipt</Link>
        </div>
        <div className="why-ad-summary">
          <strong>Why this ad?</strong>
          <span>
            {topics.join(" · ")} · {relevance}% match · No personalization · Payment verified
          </span>
        </div>
        <details className="why-ad-details">
          <summary>Show complete explanation</summary>
          <p className="field-help">
            Matched {topics.join(", ")} at {relevance}% relevance. Adult eligibility was declared,
            the context was non-sensitive, personalization was off, the confidential policy check
            approved the exact ticket, and The Graph plus Sepolia RPC verified its payment.
          </p>
        </details>
        <button type="button" onClick={() => void clickThrough()}>
          Visit sponsor
        </button>
      </article>
      {measure && metrics && (
        <p className="field-help">
          Verified activity: {metrics.impressions} impression · {metrics.clicks} click
          {metrics.impressions >= 10 ? ` · CTR ${metrics.ctrPercent ?? "—"}%` : ""}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
