"use client";
import { FormEvent, useMemo, useState } from "react";
import { TypedDataEncoder, id, isAddress } from "ethers";

const SUBJECT_TYPES = {
  SubjectV1: [
    { name: "publisher", type: "address" },
    { name: "placementId", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "disclosureVersion", type: "uint16" },
  ],
};

interface Draft {
  campaignId: string;
  subject: {
    publisher: string;
    placementId: string;
    productRefHash: string;
    contentHash: string;
    disclosureVersion: number;
  };
  subjectHash: string;
}

export function CampaignBuilder() {
  const [publisher, setPublisher] = useState("");
  const [campaign, setCampaign] = useState("");
  const [placement, setPlacement] = useState("");
  const [product, setProduct] = useState("");
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const complete = useMemo(
    () =>
      [publisher, campaign, placement, product, content].every((value) =>
        value.trim(),
      ),
    [publisher, campaign, placement, product, content],
  );

  function prepare(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDraft(null);
    if (!isAddress(publisher)) {
      setError("Enter a valid publisher address.");
      return;
    }
    if (!complete) {
      setError("Complete every field before preparing the commitment.");
      return;
    }
    const subject = {
      publisher,
      placementId: id(placement.trim()),
      productRefHash: id(product.trim()),
      contentHash: id(content.trim()),
      disclosureVersion: 1,
    };
    setDraft({
      campaignId: id(campaign.trim()),
      subject,
      subjectHash: TypedDataEncoder.hashStruct(
        "SubjectV1",
        SUBJECT_TYPES,
        subject,
      ),
    });
  }

  return (
    <div className="builder-grid">
      <form className="campaign-form" onSubmit={prepare} noValidate>
        <div>
          <label htmlFor="publisher">Publisher address</label>
          <input
            id="publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="campaign">Campaign reference</label>
            <input
              id="campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="launch-september"
            />
          </div>
          <div>
            <label htmlFor="placement">Placement reference</label>
            <input
              id="placement"
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              placeholder="assistant-answer-42"
            />
          </div>
        </div>
        <div>
          <label htmlFor="product">Product reference</label>
          <input
            id="product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="https://example.com/product"
          />
        </div>
        <div>
          <label htmlFor="content">Exact recommendation copy</label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="The exact text this payment authorizes…"
          />
        </div>
        <button type="submit">Prepare commitment</button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <section className="draft-output" aria-live="polite">
        <p className="eyebrow">Local result</p>
        {draft ? (
          <>
            <h2>Subject committed</h2>
            <dl>
              <div>
                <dt>Campaign ID</dt>
                <dd className="mono">{draft.campaignId}</dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd className="mono">{draft.subject.contentHash}</dd>
              </div>
              <div>
                <dt>Subject hash</dt>
                <dd className="mono">{draft.subjectHash}</dd>
              </div>
            </dl>
            <p className="field-help">
              These values match the contract&apos;s SubjectV1 hashing.
              Publisher signing, CRE evaluation, and Privy settlement remain
              separate authorized steps.
            </p>
          </>
        ) : (
          <>
            <h2>No commitment yet</h2>
            <p>
              Complete the campaign details to create deterministic V1 hashes in
              this browser. Nothing is signed, uploaded, or broadcast.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
