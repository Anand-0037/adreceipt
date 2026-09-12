"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Conversation, loadConversation, onConversationChange } from "@/lib/conversation";
import { PlacementLifecycleV2 } from "./PlacementLifecycleV2";

/**
 * The publisher's side: the verification, and nothing the user needs.
 *
 * A person asks on /ask. This page picks that question up and lets the
 * publisher run everything that has to happen before an ad may appear next to
 * it - the private policy check, the signature, the payment, the on-chain
 * proof - inside its own window. When the last step passes, the card shows up
 * in the conversation on /ask on its own.
 */

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

const REASONS: Record<string, string> = {
  MATCHED: "A campaign matches this question and may proceed to verification.",
  AGE_NOT_ELIGIBLE: "The session was not declared adult. No ad can be prepared.",
  SENSITIVE_CONTEXT: "The question is in a sensitive class. No advertiser may bid on it.",
  CONTEXT_UNCLASSIFIED: "The question could not be classified into any targetable topic or intent.",
  NO_ACTIVE_CAMPAIGN: "There are no active campaigns.",
  NO_ELIGIBLE_CAMPAIGN: "No active campaign is allowed for this context.",
  TOPIC_NOT_ALLOWED: "No active campaign targets these topics.",
  INTENT_NOT_ALLOWED: "No active campaign targets this intent.",
  LOCALE_NOT_ALLOWED: "No active campaign allows this locale.",
  BELOW_RELEVANCE_FLOOR: "The best campaign scored below the 72% relevance floor.",
  OUTSIDE_CAMPAIGN_WINDOW: "The matching campaign is outside its date window.",
};

export function PublisherConsole() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => setConversation(loadConversation());
    refresh();
    setLoaded(true);
    // A new question asked on /ask in another tab shows up here immediately.
    return onConversationChange(refresh);
  }, []);

  if (!loaded) return null;

  if (!conversation) {
    return (
      <section className="console-empty">
        <p className="eyebrow">Nothing to verify yet</p>
        <h2>No question has been asked.</h2>
        <p>
          Ask something on the <Link href="/ask">assistant page</Link>. If a campaign matches, the
          placement will appear here for verification.
        </p>
      </section>
    );
  }

  const { query, decision, answer } = conversation;
  const matched = Boolean(decision.winner);

  return (
    <div className="publisher-v2">
      <section className="console-question">
        <p className="eyebrow">Current question</p>
        <blockquote>{query}</blockquote>
        <p className="field-help">
          Asked {new Date(conversation.askedAt).toLocaleTimeString()} ·{" "}
          {answer ? "answered independently" : "the model did not answer, so no ad can be shown"} ·{" "}
          <Link href="/ask">open the conversation</Link>
        </p>
      </section>

      <div className={`policy-decision policy-${decision.status.toLowerCase()}`}>
        <p className="eyebrow">What the advertiser is told</p>
        <strong>{matched ? "A campaign matched" : "No campaign can be shown"}</strong>
        <p>{REASONS[decision.reasonCode] ?? human(decision.reasonCode)}</p>
        <dl className="decision-facts">
          <div>
            <dt>Topic</dt>
            <dd>{decision.context.topics.map(human).join(", ") || "none recognised"}</dd>
          </div>
          <div>
            <dt>Kind of question</dt>
            <dd>{human(decision.context.intent)}</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{decision.context.coarseLocale}</dd>
          </div>
          <div>
            <dt>Sensitive?</dt>
            <dd>
              {decision.context.sensitiveClass === "NONE"
                ? "No"
                : `Yes · ${human(decision.context.sensitiveClass)}`}
            </dd>
          </div>
          <div>
            <dt>Tracks the user?</dt>
            <dd>No</dd>
          </div>
        </dl>
        <p className="field-help">
          These labels are all an advertiser receives. The question itself never leaves this
          publisher.
        </p>
        {matched && decision.winner && (
          <p className="field-help">
            Matched campaign: <strong>{decision.winner.campaign.brandDisplayName}</strong> ·{" "}
            {Math.round(Number(decision.winner.relevance) * 100)}% relevant
          </p>
        )}
        {decision.rejected.length > 0 && (
          <details className="why-ad-details">
            <summary>
              {decision.rejected.length} other campaign{decision.rejected.length === 1 ? "" : "s"}{" "}
              considered
            </summary>
            <ul className="field-help">
              {decision.rejected.map((item) => (
                <li key={item.campaignId}>
                  {item.campaignId.slice(0, 10)}… · {human(item.reasonCode)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {matched && answer && (
        <PlacementLifecycleV2 key={decision.decisionId} decision={decision} autoOpen={true} />
      )}
    </div>
  );
}
