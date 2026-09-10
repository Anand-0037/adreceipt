"use client";

import { type FormEvent, useEffect, useState } from "react";
import { campaignApi, type AgeEligibility, type ContextDecisionV2 } from "@/lib/api";
import { PlacementLifecycleV2 } from "./PlacementLifecycleV2";

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

const SESSION_KEY = "adreceipt:v2:publisher-session";
const AGE_KEY = "adreceipt:v2:age-eligibility";

const QUERY_PRESETS = [
  {
    label: "Relevant tool query",
    query: "What can help me load Kaggle datasets into my AI coding workflow?",
  },
  {
    label: "Irrelevant query",
    query: "What is a good way to plan a team calendar?",
  },
  {
    label: "Sensitive context",
    query: "I am feeling depressed and need mental health support.",
  },
] as const;

export function PublisherExperienceV2() {
  const [query, setQuery] = useState("");
  const [age, setAge] = useState<AgeEligibility>("UNKNOWN");
  const [locale, setLocale] = useState("");
  const [decision, setDecision] = useState<ContextDecisionV2 | null>(null);
  const [answer, setAnswer] = useState<{ text: string; provider: string; model: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answerError, setAnswerError] = useState("");

  useEffect(() => {
    setLocale(navigator.language || "en");
    try {
      const savedAge = sessionStorage.getItem(AGE_KEY);
      if (savedAge === "ADULT_DECLARED" || savedAge === "UNDER_18") setAge(savedAge);
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const value = JSON.parse(saved) as {
        answer?: { text?: unknown; provider?: unknown; model?: unknown };
        decision?: ContextDecisionV2;
        answerError?: unknown;
      };
      if (typeof value.decision?.decisionId === "string") {
        setDecision(value.decision);
      }
      if (
        typeof value.answer?.text === "string" &&
        typeof value.answer.provider === "string" &&
        typeof value.answer.model === "string"
      ) {
        setAnswer({
          text: value.answer.text,
          provider: value.answer.provider,
          model: value.answer.model,
        });
      } else if (typeof value.answerError === "string") {
        setAnswerError(value.answerError);
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  function chooseAge(value: "ADULT_DECLARED" | "UNDER_18") {
    setAge(value);
    sessionStorage.setItem(AGE_KEY, value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDecision(null);
    setAnswer(null);
    setAnswerError("");
    sessionStorage.removeItem(SESSION_KEY);
    try {
      const [organicResult, decisionResult] = await Promise.allSettled([
        campaignApi.answer(query),
        campaignApi.decide(query, age, locale),
      ]);
      if (decisionResult.status === "rejected") throw decisionResult.reason;
      const placementDecision = decisionResult.value;
      setDecision(placementDecision);
      if (organicResult.status === "fulfilled") {
        setAnswer(organicResult.value);
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ answer: organicResult.value, decision: placementDecision }),
        );
      } else {
        const message =
          organicResult.reason instanceof Error
            ? organicResult.reason.message
            : "The independent answer provider is unavailable.";
        setAnswerError(message);
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ decision: placementDecision, answerError: message }),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Context decision is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publisher-v2">
      <form className="publisher-query" onSubmit={submit}>
        <label htmlFor="publisher-query">Ask the publisher</label>
        <fieldset className="query-presets">
          <legend>Try a scenario</legend>
          {QUERY_PRESETS.map((preset) => (
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
          id="publisher-query"
          rows={3}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What tool should I use for…?"
          required
        />
        {age === "UNKNOWN" ? (
          <fieldset className="eligibility-gate">
            <legend>Sponsored recommendations are available only in adult demo sessions.</legend>
            <button type="button" onClick={() => chooseAge("ADULT_DECLARED")}>
              I am 18 or older
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => chooseAge("UNDER_18")}
            >
              Continue without sponsored content
            </button>
          </fieldset>
        ) : (
          <p className="field-help session-eligibility">
            {age === "ADULT_DECLARED"
              ? "Adult demo session · contextual sponsorship eligible"
              : "Sponsored content disabled for this session"}
            {" · "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setAge("UNKNOWN");
                sessionStorage.removeItem(AGE_KEY);
              }}
            >
              Change
            </button>
          </p>
        )}
        <div>
          <label htmlFor="publisher-locale">Context locale</label>
          <input
            id="publisher-locale"
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
          {busy ? "Evaluating context…" : "Get independent answer"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {decision && (
        <section className="publisher-result" aria-live="polite">
          {answer ? (
            <div className="organic-answer">
              <p className="eyebrow">Organic answer</p>
              <p>{answer.text}</p>
              <span className="field-help">
                Generated independently by {answer.provider} · {answer.model}
              </span>
            </div>
          ) : (
            <div className="organic-answer policy-suppressed">
              <p className="eyebrow">Organic answer unavailable</p>
              <strong>No sponsored placement can be shown.</strong>
              <p>{answerError}</p>
            </div>
          )}
          <div className={`policy-decision policy-${decision.status.toLowerCase()}`}>
            <p className="eyebrow">Context and policy</p>
            <strong>
              {decision.status === "ELIGIBLE"
                ? "Eligible campaign found"
                : "Advertisement suppressed"}
            </strong>
            <p>{human(decision.reasonCode)}</p>
            <dl className="decision-facts">
              <div>
                <dt>Topics</dt>
                <dd>{decision.context.topics.map(human).join(", ") || "unclassified"}</dd>
              </div>
              <div>
                <dt>Intent</dt>
                <dd>{human(decision.context.intent)}</dd>
              </div>
              <div>
                <dt>Safety</dt>
                <dd>{human(decision.context.sensitiveClass)}</dd>
              </div>
              <div>
                <dt>Personalization</dt>
                <dd>Off</dd>
              </div>
            </dl>
          </div>
          {decision.winner && answer ? (
            <>
              <article className="sponsored-candidate candidate-withheld">
                <div className="candidate-label">Commercial match found</div>
                <h2>Advertisement withheld</h2>
                <p>
                  The creative remains hidden until its exact payment is indexed and independently
                  verified.
                </p>
                <div className="candidate-meta">
                  <span>Relevance {Math.round(Number(decision.winner.relevance) * 100)}%</span>
                  <span>No personalization</span>
                  <span>Payment proof pending</span>
                </div>
              </article>
              <PlacementLifecycleV2 decision={decision} />
            </>
          ) : decision.winner ? (
            <div className="no-sponsored-slot">
              <strong>Sponsored placement suppressed</strong>
              <p>An independently generated organic answer is required before an ad can appear.</p>
            </div>
          ) : (
            <div className="no-sponsored-slot">
              <strong>No sponsored placement shown</strong>
              <p>Policy or matching did not authorize an ad for this context.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
