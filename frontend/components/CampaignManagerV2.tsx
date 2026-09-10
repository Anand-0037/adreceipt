"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import {
  campaignApi,
  api,
  placementApi,
  type CampaignInputV2,
  type CampaignRecordV2,
  type PlacementMetricsV2,
  type Health,
} from "@/lib/api";
import { protocol } from "@/lib/protocol";
import {
  connect,
  currentAccount,
  describeWalletError,
  signCampaignPause,
  signCampaignTypedData,
} from "@/lib/wallet";

const TOPICS = [
  "CLOUD_INFRASTRUCTURE",
  "DATASETS",
  "DEVELOPER_TOOLS",
  "ECOMMERCE",
  "EDUCATION",
  "FINANCE",
  "MACHINE_LEARNING",
  "PRODUCTIVITY",
];
const INTENTS = ["DISCOVER_TOOL", "COMPARE_OPTIONS", "SOLVE_PROBLEM", "PURCHASE_RESEARCH"];
const BLOCKED = [
  "HEALTH",
  "MENTAL_HEALTH",
  "SELF_HARM",
  "POLITICS",
  "MINORS",
  "SEXUAL_CONTENT",
  "GAMBLING",
  "WEAPONS",
  "DRUGS_ALCOHOL",
  "DANGEROUS_ILLEGAL",
];

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function formatAtomic(value: string | null): string {
  return value === null ? "—" : Number(formatUnits(value, 6)).toFixed(3);
}

export function CampaignManagerV2() {
  const [wallet, setWallet] = useState("");
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [landingPage, setLandingPage] = useState("");
  const [budget, setBudget] = useState("");
  const [maxPlacement, setMaxPlacement] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [brief, setBrief] = useState("");
  const [locales, setLocales] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [intents, setIntents] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecordV2[]>([]);
  const [draft, setDraft] = useState<CampaignRecordV2 | null>(null);
  const [metrics, setMetrics] = useState<PlacementMetricsV2 | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCampaigns = useCallback(async () => {
    try {
      setCampaigns((await campaignApi.list()).campaigns);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign storage is unavailable.");
    }
  }, []);

  useEffect(() => {
    void currentAccount().then((account) => account && setWallet(account));
    setLocales(navigator.language || "en");
    void loadCampaigns();
    void api
      .health()
      .then(setHealth)
      .catch(() => undefined);
  }, [loadCampaigns]);

  useEffect(() => {
    setMetrics(null);
    if (draft?.manifest.status !== "ACTIVE") return;
    void placementApi
      .metrics(draft.manifest.campaignId)
      .then(setMetrics)
      .catch(() => undefined);
  }, [draft]);

  async function useWallet() {
    setError("");
    try {
      setWallet((await connect()).address);
    } catch (cause) {
      setError(describeWalletError(cause));
    }
  }

  async function suggest() {
    setError("");
    setBusy(true);
    try {
      const suggestion = await campaignApi.suggest({
        brief,
        brandDisplayName: brand,
        productRef: product,
      });
      setTopics(suggestion.targetTopics);
      setIntents(suggestion.targetIntents);
      setHeadline(suggestion.creativeHeadline);
      setBody(suggestion.creativeBody);
      if (!landingPage.trim() && /^https:\/\//i.test(product.trim()))
        setLandingPage(product.trim());
      if (!maxPlacement.trim()) setMaxPlacement("0.10");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign agent is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1_000);
      const input: CampaignInputV2 = {
        advertiserWallet: wallet,
        brandDisplayName: brand,
        productRef: product,
        landingPage,
        objective: "WEBSITE_VISIT",
        settlementAsset: protocol.asset,
        totalBudget: parseUnits(budget, 6).toString(),
        maxPlacementAmount: parseUnits(maxPlacement, 6).toString(),
        targetTopics: topics,
        targetIntents: intents,
        allowedLocales: [
          ...new Set(
            locales
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
        blockedContextClasses: BLOCKED,
        creativeHeadline: headline,
        creativeBody: body,
        validFrom: String(now - 60),
        validUntil: String(now + 7 * 24 * 60 * 60),
      };
      const created = await campaignApi.create(input);
      setDraft(created);
      await loadCampaigns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const connected = await connect();
      if (connected.address.toLowerCase() !== draft.manifest.advertiserWallet.toLowerCase()) {
        throw new Error("Connect the advertiser wallet that created this campaign.");
      }
      const signature = await signCampaignTypedData(draft.typedData);
      const approved = await campaignApi.approve(draft, signature);
      setDraft(approved);
      await loadCampaigns();
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const connected = await connect();
      if (connected.address.toLowerCase() !== draft.manifest.advertiserWallet.toLowerCase()) {
        throw new Error("Connect the advertiser wallet that owns this campaign.");
      }
      const validUntil = Math.floor(Date.now() / 1_000) + 5 * 60;
      const signature = await signCampaignPause({
        domain: draft.typedData.domain,
        campaignId: draft.manifest.campaignId,
        campaignRevisionHash: draft.manifest.campaignRevisionHash,
        validUntil,
      });
      const paused = await campaignApi.pause(draft.manifest.campaignId, signature, validUntil);
      setDraft(paused);
      await loadCampaigns();
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-workspace">
      <form className="campaign-form v2-campaign-form" onSubmit={create} noValidate>
        <div className="form-heading">
          <p className="eyebrow">CampaignManifestV2</p>
          <h2>Create an advertiser-authorized campaign</h2>
          <p>
            Campaign data is written to PostgreSQL. Launch requires this wallet&apos;s EIP-712
            signature.
          </p>
        </div>
        <div>
          <label htmlFor="v2-wallet">Advertiser wallet</label>
          <div className="lookup-line">
            <input
              id="v2-wallet"
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
              placeholder="0x…"
            />
            <button type="button" onClick={useWallet}>
              Use wallet
            </button>
          </div>
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="v2-brand">Brand</label>
            <input
              id="v2-brand"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              placeholder="Your brand"
            />
          </div>
          <div>
            <label htmlFor="v2-product">Product reference</label>
            <input
              id="v2-product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="Product ID or URL"
            />
          </div>
        </div>
        <div>
          <label htmlFor="v2-brief">What should the advertiser agent accomplish?</label>
          <textarea
            id="v2-brief"
            rows={4}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Promote my dataset tool to ML developers comparing ways to load Kaggle data."
            maxLength={2000}
          />
          <button
            type="button"
            className="example-button"
            disabled={busy || !brief.trim() || !brand.trim() || !product.trim()}
            onClick={() => void suggest()}
          >
            {busy ? "Compiling brief…" : "Draft targeting and creative"}
          </button>
          <p className="field-help">
            The agent proposes editable fields. Your wallet signature is still required to launch.
          </p>
        </div>
        <div>
          <label htmlFor="v2-budget">Total budget · test USDC</label>
          <input
            id="v2-budget"
            inputMode="decimal"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            placeholder="10"
          />
        </div>
        <details className="advanced-targeting">
          <summary>Advanced targeting and creative</summary>
          <div className="advanced-targeting-body">
            <div>
              <label htmlFor="v2-url">HTTPS landing page</label>
              <input
                id="v2-url"
                type="url"
                value={landingPage}
                onChange={(event) => setLandingPage(event.target.value)}
                placeholder="https://…"
              />
            </div>
            <div>
              <label htmlFor="v2-locales">Allowed locales</label>
              <input
                id="v2-locales"
                value={locales}
                onChange={(event) => setLocales(event.target.value)}
                placeholder="en, en-IN"
              />
            </div>
            <div className="field-pair">
              <div>
                <label htmlFor="v2-placement">Max placement · test USDC</label>
                <input
                  id="v2-placement"
                  inputMode="decimal"
                  value={maxPlacement}
                  onChange={(event) => setMaxPlacement(event.target.value)}
                  placeholder="0.10"
                />
              </div>
            </div>
            <fieldset>
              <legend>Eligible topics</legend>
              <div className="choice-grid">
                {TOPICS.map((topic) => (
                  <label key={topic}>
                    <input
                      type="checkbox"
                      checked={topics.includes(topic)}
                      onChange={() => setTopics(toggle(topics, topic))}
                    />{" "}
                    {human(topic)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Eligible intents</legend>
              <div className="choice-grid">
                {INTENTS.map((intent) => (
                  <label key={intent}>
                    <input
                      type="checkbox"
                      checked={intents.includes(intent)}
                      onChange={() => setIntents(toggle(intents, intent))}
                    />{" "}
                    {human(intent)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="v2-headline">Sponsored headline</label>
              <input
                id="v2-headline"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="v2-body">Sponsored copy</label>
              <textarea
                id="v2-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                maxLength={300}
              />
            </div>
          </div>
        </details>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Create reviewable draft"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <section className="campaign-state" aria-live="polite">
        <p className="eyebrow">Advertiser approval</p>
        <p className="field-help">
          {health?.privy.configured
            ? "Privy payer and bounded policy are configured. Provider approval is checked again at settlement."
            : "Privy payer configuration is unavailable; browser-wallet settlement remains reviewable."}
        </p>
        {draft ? (
          <>
            <h2>{draft.manifest.brandDisplayName}</h2>
            <span className={`state-chip state-${draft.manifest.status.toLowerCase()}`}>
              {draft.manifest.status}
            </span>
            <p>{draft.manifest.creativeHeadline}</p>
            <dl className="compact-evidence">
              <div>
                <dt>Campaign</dt>
                <dd className="mono">{draft.manifest.campaignId}</dd>
              </div>
              <div>
                <dt>Revision commitment</dt>
                <dd className="mono">{draft.manifest.campaignRevisionHash}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{Number(draft.manifest.totalBudget) / 1e6} test USDC</dd>
              </div>
            </dl>
            {draft.manifest.status === "DRAFT" && (
              <button type="button" disabled={busy} onClick={approve}>
                Sign and activate
              </button>
            )}
            {draft.manifest.status === "ACTIVE" && (
              <>
                <p className="live-match">Active after advertiser EIP-712 authorization.</p>
                {metrics && (
                  <dl className="campaign-metrics">
                    <div>
                      <dt>Spend</dt>
                      <dd>{formatAtomic(metrics.spendAtomic)} USDC</dd>
                    </div>
                    <div>
                      <dt>Impressions</dt>
                      <dd>{metrics.impressions}</dd>
                    </div>
                    <div>
                      <dt>Clicks</dt>
                      <dd>{metrics.clicks}</dd>
                    </div>
                    {metrics.impressions >= 10 && (
                      <>
                        <div>
                          <dt>CTR</dt>
                          <dd>{metrics.ctrPercent ?? "—"}%</dd>
                        </div>
                        <div>
                          <dt>Effective CPC</dt>
                          <dd>{formatAtomic(metrics.effectiveCpcAtomic)} USDC</dd>
                        </div>
                      </>
                    )}
                    {metrics.impressions >= 10 && (
                      <div>
                        <dt>Effective CPM</dt>
                        <dd>{formatAtomic(metrics.effectiveCpmAtomic)} USDC</dd>
                      </div>
                    )}
                  </dl>
                )}
                <button type="button" disabled={busy} onClick={() => void pause()}>
                  Pause campaign
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <h2>No draft selected</h2>
            <p>Create a campaign with your own product, rules, budget, and creative.</p>
          </>
        )}
        <div className="saved-campaigns">
          <h3>Persisted campaigns</h3>
          {campaigns.length === 0 && <p className="field-help">No campaigns have been stored.</p>}
          {campaigns.map((campaign) => (
            <button
              key={campaign.manifest.campaignId}
              type="button"
              className="saved-campaign"
              onClick={() => setDraft(campaign)}
            >
              <strong>{campaign.manifest.brandDisplayName}</strong>
              <span>{campaign.manifest.status}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
