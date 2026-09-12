"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  campaignApi,
  placementApi,
  type AgeEligibility,
  type ContextDecisionV2,
  type PlacementRecordV2,
} from "@/lib/api";
import {
  loadConversation,
  onConversationChange,
  placementKey,
  saveConversation,
} from "@/lib/conversation";
import { SponsoredCard } from "./SponsoredCard";
import { ThinkingDots, TypedText } from "./TypedText";

/**
 * The user's side: a conversation, and nothing else.
 *
 * Everything about how an ad gets verified - the publisher's signature, the
 * payment, the on-chain check - happens on /publisher. This page only knows
 * three states for the sponsored slot: no ad, an ad being verified, and a
 * verified ad. The card appears here the moment the publisher finishes, which
 * is the whole point: the person asking never sees an unverified ad.
 */

const AGE_KEY = "adreceipt:v2:age-eligibility";

const REASONS: Record<string, string> = {
  AGE_NOT_ELIGIBLE: "Sponsored suggestions are only shown to adults.",
  SENSITIVE_CONTEXT: "This question touches a sensitive subject, so no advertiser may bid on it.",
  CONTEXT_UNCLASSIFIED: "Nothing about this question is something an advertiser could target.",
  NO_ACTIVE_CAMPAIGN: "No advertiser has an active campaign right now.",
  NO_ELIGIBLE_CAMPAIGN: "No active campaign is allowed to appear here.",
  TOPIC_NOT_ALLOWED: "The active campaigns are about different topics.",
  INTENT_NOT_ALLOWED: "The active campaigns target a different kind of question.",
  LOCALE_NOT_ALLOWED: "The active campaigns are not allowed in your region.",
  BELOW_RELEVANCE_FLOOR: "A campaign was close, but not relevant enough to be shown.",
  OUTSIDE_CAMPAIGN_WINDOW: "The matching campaign is not running right now.",
};

const PRESETS = [
  {
    label: "A question an ad could match",
    query: "What can help me load Kaggle datasets into my AI coding workflow?",
  },
  { label: "An unrelated question", query: "What is a good way to plan a team calendar?" },
  {
    label: "A sensitive question",
    query: "I am feeling depressed and need mental health support.",
  },
] as const;

export function AssistantChat() {
  const [query, setQuery] = useState("");
  const [age, setAge] = useState<AgeEligibility>("UNKNOWN");
  const [locale, setLocale] = useState("");
  const [asked, setAsked] = useState("");
  const [decision, setDecision] = useState<ContextDecisionV2 | null>(null);
  const [answer, setAnswer] = useState<{ text: string; provider: string; model: string } | null>(
    null,
  );
  const [answerError, setAnswerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [animate, setAnimate] = useState(false);
  const [typed, setTyped] = useState(false);
  const [placement, setPlacement] = useState<PlacementRecordV2 | null>(null);
  const answerFinished = useCallback(() => setTyped(true), []);

  // Restore the last conversation so a reload, or coming back from the
  // publisher page, does not lose the thread.
  useEffect(() => {
    setLocale(navigator.language || "en");
    try {
      const savedAge = sessionStorage.getItem(AGE_KEY);
      if (savedAge === "ADULT_DECLARED" || savedAge === "UNDER_18") setAge(savedAge);
    } catch {
      // Storage blocked; the gate simply asks again.
    }
    const saved = loadConversation();
    if (!saved) return;
    setAsked(saved.query);
    setDecision(saved.decision);
    if (saved.answer) setAnswer(saved.answer);
    if (saved.answerError) setAnswerError(saved.answerError);
    setAnimate(false);
    setTyped(true);
  }, []);

  // Watch for the publisher finishing. The verified card should appear here
  // without a reload - that is the moment the product is about.
  useEffect(() => {
    if (!decision?.winner || placement?.status === "PAID_VERIFIED") return;
    let cancelled = false;
    const check = async () => {
      let id: string | null = null;
      try {
        id = localStorage.getItem(placementKey(decision.decisionId));
      } catch {
        return;
      }
      if (!id) return;
      try {
        const current = await placementApi.get(id);
        if (!cancelled && current.decisionId === decision.decisionId) setPlacement(current);
      } catch {
        // Not ready or not reachable; try again on the next tick.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 8_000);
    const unsubscribe = onConversationChange(() => void check());
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [decision, placement?.status]);

  function chooseAge(value: "ADULT_DECLARED" | "UNDER_18") {
    setAge(value);
    try {
      sessionStorage.setItem(AGE_KEY, value);
    } catch {
      // Fine without it.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = query.trim();
    setBusy(true);
    setError("");
    setDecision(null);
    setAnswer(null);
    setAnswerError("");
    setPlacement(null);
    setAsked(question);
    setAnimate(true);
    setTyped(false);
    try {
      const [organic, decided] = await Promise.allSettled([
        campaignApi.answer(question),
        campaignApi.decide(question, age, locale),
      ]);
      if (decided.status === "rejected") throw decided.reason;
      setDecision(decided.value);
      if (organic.status === "fulfilled") {
        setAnswer(organic.value);
        saveConversation({
          query: question,
          decision: decided.value,
          answer: organic.value,
          askedAt: Date.now(),
        });
      } else {
        const message =
          organic.reason instanceof Error ? organic.reason.message : "The model is unavailable.";
        setAnswerError(message);
        setTyped(true);
        saveConversation({
          query: question,
          decision: decided.value,
          answerError: message,
          askedAt: Date.now(),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant is unavailable right now.");
      setTyped(true);
    } finally {
      setBusy(false);
    }
  }

  const verified = placement?.status === "PAID_VERIFIED";

  return (
    <div className="publisher-v2">
      <form className="publisher-query" onSubmit={submit}>
        <label htmlFor="assistant-query">Ask anything</label>
        <fieldset className="query-presets">
          <legend>Try an example</legend>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setQuery(preset.query)}
              disabled={busy}
            >
              {preset.label}
            </button>
          ))}
        </fieldset>
        <textarea
          id="assistant-query"
          rows={3}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What tool should I use for…?"
          required
        />
        {age === "UNKNOWN" ? (
          <fieldset className="eligibility-gate">
            <legend>Sponsored suggestions are only shown to adults. Are you 18 or older?</legend>
            <button type="button" onClick={() => chooseAge("ADULT_DECLARED")}>
              Yes, I am 18 or older
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => chooseAge("UNDER_18")}
            >
              No — answer without any ads
            </button>
          </fieldset>
        ) : (
          <p className="field-help session-eligibility">
            {age === "ADULT_DECLARED"
              ? "Adult session · a relevant ad may be shown"
              : "Under-18 session · no ads"}
            {" · "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setAge("UNKNOWN");
                try {
                  sessionStorage.removeItem(AGE_KEY);
                } catch {
                  // Fine.
                }
              }}
            >
              Change
            </button>
          </p>
        )}
        <div>
          <label htmlFor="assistant-locale">Your region</label>
          <input
            id="assistant-locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            placeholder="en-IN"
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy || age === "UNKNOWN" || !query.trim() || !locale.trim()}
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {(busy || decision) && (
        <section className="chat" aria-label="Conversation">
          <div className="chat-msg chat-user">
            <span className="chat-who">You</span>
            <p>{asked}</p>
          </div>

          <div className="chat-msg chat-assistant">
            <span className="chat-who">Assistant</span>
            {busy ? (
              <ThinkingDots />
            ) : answer ? (
              <TypedText text={answer.text} animate={animate} onDone={answerFinished} />
            ) : (
              <p>
                I can’t answer right now — the model is unavailable.
                {answerError ? ` (${answerError})` : ""}
              </p>
            )}
          </div>

          {typed && decision && !decision.winner && (
            <div className="chat-msg chat-ad chat-ad-none">
              <span className="chat-who">Sponsored slot</span>
              <p>
                <strong>No ad.</strong>{" "}
                {REASONS[decision.reasonCode] ?? "No campaign was allowed to appear here."}
              </p>
            </div>
          )}

          {typed && decision?.winner && answer && !verified && (
            <div className="chat-msg chat-ad">
              <span className="chat-who">Sponsored slot</span>
              <p>
                <strong>An ad matched this question.</strong> It stays hidden until the advertiser
                has paid for it and the payment is confirmed on-chain.
              </p>
              <p className="chat-note">
                Waiting for verification · <Link href="/publisher">open the publisher console</Link>
              </p>
            </div>
          )}

          {typed && decision?.winner && placement && verified && (
            <div className="chat-msg chat-ad chat-ad-verified">
              <span className="chat-who">Sponsored slot</span>
              <SponsoredCard placement={placement} decision={decision} measure={true} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
