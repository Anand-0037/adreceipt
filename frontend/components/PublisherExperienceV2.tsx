"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { campaignApi, type AgeEligibility, type ContextDecisionV2 } from "@/lib/api";
import { PlacementLifecycleV2 } from "./PlacementLifecycleV2";
import { ThinkingDots, TypedText } from "./TypedText";

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

/**
 * Why an ad was or was not allowed, in words a first-time visitor understands.
 *
 * The reason codes are the engine's vocabulary, and showing "matched" or
 * "context unclassified" to a person tells them nothing about what happened or
 * whether it was their fault. Each sentence names the cause and, where there is
 * one, the rule behind it.
 */
const REASONS: Record<string, string> = {
  MATCHED: "A campaign the advertiser set up matches this question.",
  AGE_NOT_ELIGIBLE: "Sponsored suggestions are only shown to adults.",
  SENSITIVE_CONTEXT:
    "This question touches a sensitive subject. No advertiser is allowed to bid on it.",
  CONTEXT_UNCLASSIFIED:
    "The question is not about anything an advertiser could target, so nothing matched.",
  NO_ACTIVE_CAMPAIGN: "No advertiser currently has an active campaign.",
  NO_ELIGIBLE_CAMPAIGN: "No active campaign is allowed to appear for this question.",
  TOPIC_NOT_ALLOWED: "The active campaigns target different topics than this question.",
  INTENT_NOT_ALLOWED: "The active campaigns target a different kind of question.",
  LOCALE_NOT_ALLOWED: "The active campaigns are not allowed in your region.",
  BELOW_RELEVANCE_FLOOR: "A campaign was close, but not relevant enough to be shown.",
  OUTSIDE_CAMPAIGN_WINDOW: "The matching campaign is not running right now.",
};

function explain(reasonCode: string): string {
  return REASONS[reasonCode] ?? `No ad was shown (${human(reasonCode)}).`;
}

const SESSION_KEY = "adreceipt:v2:publisher-session";
const AGE_KEY = "adreceipt:v2:age-eligibility";

const QUERY_PRESETS = [
  {
    label: "A question an ad could match",
    query: "What can help me load Kaggle datasets into my AI coding workflow?",
  },
  {
    label: "An unrelated question",
    query: "What is a good way to plan a team calendar?",
  },
  {
    label: "A sensitive question",
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
  // The question as it was asked, kept separate from the textarea so editing
  // the box does not rewrite the transcript above it.
  const [askedQuery, setAskedQuery] = useState("");
  // A fresh answer is typed out; a restored one is shown at once. And nothing
  // below the answer appears until the typing has finished, so the page reads
  // top to bottom in the order things actually happened.
  const [animateAnswer, setAnimateAnswer] = useState(false);
  const [typed, setTyped] = useState(false);
  const answerFinished = useCallback(() => setTyped(true), []);

  useEffect(() => {
    setLocale(navigator.language || "en");
    try {
      const savedAge = sessionStorage.getItem(AGE_KEY);
      if (savedAge === "ADULT_DECLARED" || savedAge === "UNDER_18") setAge(savedAge);
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const value = JSON.parse(saved) as {
        query?: unknown;
        answer?: { text?: unknown; provider?: unknown; model?: unknown };
        decision?: ContextDecisionV2;
        answerError?: unknown;
      };
      if (typeof value.decision?.decisionId === "string") {
        setDecision(value.decision);
        setAskedQuery(typeof value.query === "string" ? value.query : "");
        setAnimateAnswer(false);
        setTyped(true);
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
    const asked = query.trim();
    setBusy(true);
    setError("");
    setDecision(null);
    setAnswer(null);
    setAnswerError("");
    setAskedQuery(asked);
    setAnimateAnswer(true);
    setTyped(false);
    sessionStorage.removeItem(SESSION_KEY);
    try {
      const [organicResult, decisionResult] = await Promise.allSettled([
        campaignApi.answer(asked),
        campaignApi.decide(asked, age, locale),
      ]);
      if (decisionResult.status === "rejected") throw decisionResult.reason;
      const placementDecision = decisionResult.value;
      setDecision(placementDecision);
      if (organicResult.status === "fulfilled") {
        setAnswer(organicResult.value);
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            query: asked,
            answer: organicResult.value,
            decision: placementDecision,
          }),
        );
      } else {
        const message =
          organicResult.reason instanceof Error
            ? organicResult.reason.message
            : "The independent answer provider is unavailable.";
        setAnswerError(message);
        // No answer means nothing to type, so the rest of the page can show.
        setTyped(true);
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ query: asked, decision: placementDecision, answerError: message }),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Context decision is unavailable.");
      setTyped(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publisher-v2">
      <section className="publisher-intro" aria-label="How this page works">
        <p className="eyebrow">You are the AI assistant</p>
        <h2>Ask a question and watch whether an ad is allowed to appear.</h2>
        <ol className="publisher-intro-steps">
          <li>
            <strong>The question is answered first</strong> — before any advertising logic runs, so
            an ad can never change the answer.
          </li>
          <li>
            <strong>Advertisers see only labels</strong> — the topic and kind of question, never the
            words you typed.
          </li>
          <li>
            <strong>An ad appears only after it is paid for</strong> — and the payment is checked
            on-chain by two independent sources.
          </li>
        </ol>
      </section>

      <form className="publisher-query" onSubmit={submit}>
        <label htmlFor="publisher-query">Ask the AI assistant</label>
        <fieldset className="query-presets">
          <legend>Try an example</legend>
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
              : "Under-18 session · no ads will be shown"}
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
          <label htmlFor="publisher-locale">Your region</label>
          <input
            id="publisher-locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            placeholder="en-IN"
            required
          />
          <p className="field-help">
            Filled in from your browser. Advertisers choose which regions their ads may appear in.
          </p>
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
            <p>{askedQuery}</p>
          </div>

          <div className="chat-msg chat-assistant">
            <span className="chat-who">Assistant</span>
            {busy ? (
              <ThinkingDots />
            ) : answer ? (
              <>
                <TypedText text={answer.text} animate={animateAnswer} onDone={answerFinished} />
                {typed && (
                  <span className="chat-note">
                    Written by {answer.provider} before any advertising logic ran. An ad cannot
                    change it.
                  </span>
                )}
              </>
            ) : (
              <>
                <p>I can’t answer right now — the model is unavailable.</p>
                <span className="chat-note">
                  An ad is only ever attached to a real answer, so no ad will be shown either.
                  {answerError ? ` (${answerError})` : ""}
                </span>
              </>
            )}
          </div>

          {/* The ad slot is a separate message, so the answer above it is
              visibly finished before the sponsorship story begins. */}
          {typed && decision?.winner && answer && (
            <div className="chat-msg chat-ad">
              <span className="chat-who">Sponsored slot</span>
              <p>
                <strong>An ad matched this question — it stays hidden until it’s paid for.</strong>
              </p>
              <p className="chat-note">
                {Math.round(Number(decision.winner.relevance) * 100)}% relevant · no tracking · not
                paid yet
              </p>
            </div>
          )}
          {typed && decision && !decision.winner && (
            <div className="chat-msg chat-ad chat-ad-none">
              <span className="chat-who">Sponsored slot</span>
              <p>
                <strong>No ad.</strong> {explain(decision.reasonCode)}
              </p>
              <p className="chat-note">
                Nothing was paid, nothing was recorded, and no advertiser learned anything about
                this question.
              </p>
            </div>
          )}
        </section>
      )}

      {decision && typed && (
        <section className="publisher-result" aria-live="polite">
          <div className={`policy-decision policy-${decision.status.toLowerCase()}`}>
            <p className="eyebrow">What the advertiser is told</p>
            <strong>
              {decision.status === "ELIGIBLE"
                ? "A matching campaign was found"
                : "No ad will be shown for this question"}
            </strong>
            <p>{explain(decision.reasonCode)}</p>
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
                <dt>Tracks you?</dt>
                <dd>No</dd>
              </div>
            </dl>
            <p className="field-help">
              These labels are all an advertiser ever receives. Your actual words stay here.
            </p>
          </div>
          {decision.winner && answer && (
            <PlacementLifecycleV2 key={decision.decisionId} decision={decision} autoOpen={typed} />
          )}
        </section>
      )}
    </div>
  );
}
