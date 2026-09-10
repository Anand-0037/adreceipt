import assert from "node:assert/strict";
import test from "node:test";
import { AdReceiptClient, createPublisherRouter, publisherQuoteTypedData } from "./index.js";

const placementId = `0x${"11".repeat(32)}`;
const receiptId = `0x${"22".repeat(32)}`;
const campaignId = `0x${"44".repeat(32)}`;
const decisionId = "decision-1";
const creativeHeadline = "Load datasets from your agent";
const creativeBody = "A stored, signed campaign creative.";
const landingPage = "https://sponsor.example/product";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    campaignId,
    revision: 1,
    brandDisplayName: "KaggleIngest",
    creativeHeadline,
    creativeBody,
    landingPage,
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    decisionId,
    status: "ELIGIBLE",
    reasonCode: "MATCHED",
    context: {
      topics: ["DEVELOPER_TOOLS"],
      intent: "DISCOVER_TOOL",
      coarseLocale: "en-IN",
      sensitiveClass: "NONE",
      ageEligibility: "ADULT_DECLARED",
      personalization: false,
      contextCommitment: `0x${"55".repeat(32)}`,
    },
    winner: {
      campaignId,
      revision: 1,
      relevance: "0.91",
      campaign: campaign(),
    },
    rejected: [],
    ...overrides,
  };
}

function placement(overrides: Record<string, unknown> = {}) {
  return {
    placementId,
    decisionId,
    campaignId,
    receiptId,
    displayText: `${creativeHeadline}\n${creativeBody}`,
    landingPage,
    status: "PAID_VERIFIED",
    subject: {
      publisher: "0xPublisher",
      placementId,
      productRefHash: `0x${"66".repeat(32)}`,
      contentHash: `0x${"77".repeat(32)}`,
      disclosureVersion: 2,
    },
    quote: {
      schemaVersion: 1,
      campaignId,
      subjectHash: `0x${"88".repeat(32)}`,
      payer: "0xPayer",
      recipient: "0xRecipient",
      asset: "0xAsset",
      amount: "100000",
      validUntil: 1_800_000_000,
      nonce: `0x${"99".repeat(32)}`,
      chainId: 11_155_111,
      settlementContract: "0xSettlement",
    },
    authorization: { proofLevel: "CRE_SIMULATED", eligible: true },
    ...overrides,
  };
}

test("publisher signing helper exposes the complete canonical EIP-712 quote", () => {
  const value = placement();
  const typedData = publisherQuoteTypedData(value as never);
  assert.equal(typedData.domain.name, "AdReceipt");
  assert.equal(typedData.domain.version, "1");
  assert.equal(typedData.domain.chainId, 11_155_111);
  assert.equal(typedData.domain.verifyingContract, "0xSettlement");
  assert.equal(typedData.primaryType, "PlacementQuoteV1");
  assert.equal(typedData.message.campaignId, campaignId);
  assert.equal(typedData.message.amount, "100000");
  assert.equal(typedData.types.PlacementQuoteV1.length, 11);
});

test("authorizeAndSign keeps placement creation and publisher signing on one typed path", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return requests.length === 1
        ? json(placement({ status: "AUTHORIZED" }))
        : json(placement({ status: "SIGNED" }));
    },
  });
  const signed = await client.authorizeAndSign({
    decisionId,
    amountAtomic: "100000",
    signTypedData: async (typedData, authorized) => {
      assert.equal(typedData.message.amount, "100000");
      assert.equal(authorized.decisionId, decisionId);
      return "0xPublisherSignature";
    },
  });
  assert.equal(signed.status, "SIGNED");
  assert.deepEqual(requests[0]?.body, { decisionId, amount: "100000" });
  assert.equal(requests[1]?.url, `https://api.example.test/v2/placements/${placementId}/sign`);
  assert.deepEqual(requests[1]?.body, { signature: "0xPublisherSignature" });
});

test("authorizeAndSign never invokes the wallet for a cross-wired decision", async () => {
  let signerCalls = 0;
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => json(placement({ decisionId: "decision-2", status: "AUTHORIZED" })),
  });
  await assert.rejects(
    client.authorizeAndSign({
      decisionId,
      amountAtomic: "100000",
      signTypedData: async () => {
        signerCalls += 1;
        return "0xMustNotBeUsed";
      },
    }),
    /does not match the requested decision/,
  );
  assert.equal(signerCalls, 0);
});

test("placement parser rejects internally inconsistent subject and campaign bindings", async () => {
  for (const response of [
    placement({
      status: "AUTHORIZED",
      subject: { ...placement().subject, placementId: `0x${"aa".repeat(32)}` },
    }),
    placement({
      status: "AUTHORIZED",
      quote: { ...placement().quote, campaignId: `0x${"bb".repeat(32)}` },
    }),
  ]) {
    const client = new AdReceiptClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async () => json(response),
    });
    await assert.rejects(client.authorizePlacement(decisionId, "100000"), /bindings do not agree/);
  }
});

function verifiedFetch(evidenceOverrides: Record<string, unknown> = {}) {
  let call = 0;
  return async () => {
    call += 1;
    return call === 1
      ? json({
          placement: placement(),
          verification: { status: "PAID_VERIFIED", reason: "Graph and RPC evidence agree." },
        })
      : json({
          placement: placement(),
          decision: decision(),
          campaign: { manifest: campaign() },
          ...evidenceOverrides,
        });
  };
}

test("evaluation never mixes a commercial candidate into the organic answer", async () => {
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => json(decision()),
  });
  const result = await client.evaluate({
    query: "Which dataset tool should I use?",
    organicAnswer: "The independent answer.",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "en-IN",
  });
  assert.equal(result.organic, "The independent answer.");
  assert.equal(result.state, "ELIGIBLE_PAYMENT_REQUIRED");
  assert.equal(result.sponsorship, null);
});

test("malformed remote decisions are rejected at runtime", async () => {
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => json(decision({ context: { personalization: true } })),
  });
  await assert.rejects(
    client.evaluate({
      query: "A query",
      organicAnswer: "Organic.",
      ageEligibility: "ADULT_DECLARED",
      coarseLocale: "en-IN",
    }),
    /Invalid AdReceipt API response/,
  );
});

test("pending or unavailable evidence fails closed and withholds the ad", async () => {
  const responses = [
    json({
      placement: placement({ status: "SIGNED" }),
      verification: { status: "PENDING", reason: "The Graph has not indexed the block yet." },
    }),
    json({ error: "ledger-unavailable", message: "Live evidence is unavailable." }, 503),
  ];
  for (const response of responses) {
    const client = new AdReceiptClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async () => response.clone(),
    });
    const result = await client.renderVerified({
      placementId,
      decisionId,
      organicAnswer: "The independent answer.",
    });
    assert.equal(result.organic, "The independent answer.");
    assert.equal(result.state, "WITHHELD");
    assert.equal(result.sponsorship, null);
  }
});

test("verified Graph and RPC evidence releases the exact stored creative", async () => {
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    receiptBaseUrl: "https://app.example.test/",
    fetch: verifiedFetch(),
  });
  const result = await client.renderVerified({
    placementId,
    decisionId,
    organicAnswer: "The independent answer.",
  });
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.sponsorship?.headline, creativeHeadline);
  assert.equal(result.sponsorship?.proof.payment, "PAID_VERIFIED");
  assert.equal(result.sponsorship?.receiptUrl, `https://app.example.test/receipts/${receiptId}`);
});

for (const [name, evidenceOverrides] of [
  ["a different placement", { placement: placement({ placementId: `0x${"99".repeat(32)}` }) }],
  ["a different decision", { placement: placement({ decisionId: "decision-2" }) }],
  [
    "a different campaign",
    { campaign: { manifest: campaign({ campaignId: `0x${"88".repeat(32)}` }) } },
  ],
  ["changed creative", { placement: placement({ displayText: "Different\nCreative" }) }],
] as const) {
  test(`${name} in the evidence bundle is withheld`, async () => {
    const client = new AdReceiptClient({
      apiBaseUrl: "https://api.example.test",
      fetch: verifiedFetch(evidenceOverrides),
    });
    const result = await client.renderVerified({
      placementId,
      decisionId,
      organicAnswer: "Organic.",
    });
    assert.equal(result.state, "WITHHELD");
    assert.equal(result.sponsorship, null);
    assert.match(result.reason ?? "", /does not identify|bindings do not agree/);
  });
}

test("publisher router generates the organic answer before evaluating ads", async () => {
  const calls: string[] = [];
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => {
      calls.push("decision");
      return json(decision());
    },
  });
  const router = createPublisherRouter({
    client,
    generateOrganic: async (query) => {
      calls.push(`organic:${query}`);
      return "Independent organic answer.";
    },
  });
  const result = await router.answer({
    query: "Which dataset tool should I use?",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "en-IN",
  });
  assert.deepEqual(calls, ["organic:Which dataset tool should I use?", "decision"]);
  assert.equal(result.organic, "Independent organic answer.");
  assert.equal(result.sponsorship, null);
});

test("publisher router does not evaluate ads when organic generation fails", async () => {
  let decisionCalls = 0;
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => {
      decisionCalls += 1;
      return json(decision());
    },
  });
  const router = createPublisherRouter({
    client,
    generateOrganic: async () => {
      throw new Error("model unavailable");
    },
  });
  await assert.rejects(
    router.answer({
      query: "A query",
      ageEligibility: "ADULT_DECLARED",
      coarseLocale: "en-IN",
    }),
    /model unavailable/,
  );
  assert.equal(decisionCalls, 0);
});

test("publisher router preserves the organic answer when AdReceipt is unavailable", async () => {
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    fetch: async () => json({ error: "storage-unavailable", message: "Try again later." }, 503),
  });
  const router = createPublisherRouter({
    client,
    generateOrganic: async () => "Independent organic answer.",
  });
  const result = await router.answer({
    query: "A query",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "en-IN",
  });
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.organic, "Independent organic answer.");
  assert.equal(result.decision, null);
  assert.equal(result.sponsorship, null);
  assert.match(result.reason, /Try again later/);
});

test("publisher router bounds a stalled AdReceipt request", async () => {
  const client = new AdReceiptClient({
    apiBaseUrl: "https://api.example.test",
    requestTimeoutMs: 5,
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  });
  const router = createPublisherRouter({
    client,
    generateOrganic: async () => "Independent organic answer.",
  });
  const result = await router.answer({
    query: "A query",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "en-IN",
  });
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.organic, "Independent organic answer.");
  assert.equal(result.sponsorship, null);
  assert.match(result.reason, /timed out/);
});
