# AdReceipt Publisher SDK

The SDK puts the existing AdReceipt protocol in a publisher's response path. It keeps the organic
answer separate and returns sponsored creative only after the live AdReceipt API reports
`PAID_VERIFIED` and returns the matching stored evidence bundle.

```ts
import { AdReceiptClient } from "@adreceipt/sdk";

const adreceipt = new AdReceiptClient({
  apiBaseUrl: "https://adreceipt-api-production.up.railway.app",
  receiptBaseUrl: "https://adreceipt-tzus.vercel.app",
  requestTimeoutMs: 10_000,
});

const candidate = await adreceipt.evaluate({
  query: userQuery,
  organicAnswer,
  ageEligibility: "ADULT_DECLARED",
  coarseLocale: "en-IN",
});

// Eligibility is not payment proof. This is always null here.
if (candidate.state !== "ELIGIBLE_PAYMENT_REQUIRED") return candidate;

const placement = await adreceipt.authorizeAndSign({
  decisionId: candidate.decision.decisionId,
  amountAtomic: "100000",
  signTypedData: async (typedData) => publisherWallet.signTypedData(typedData),
});

// An authenticated operator may now settle this signed placement through Privy.
// Public SDK callers never receive the operator credential.

const response = await adreceipt.renderVerified({
  placementId: placement.placementId,
  decisionId: candidate.decision.decisionId,
  organicAnswer,
});
// Render response.sponsorship only when response.state === "VERIFIED".
```

Publishers can also keep organic generation and ad evaluation in one framework-independent router:

```ts
import { createPublisherRouter } from "@adreceipt/sdk";

const router = createPublisherRouter({
  client: adreceipt,
  generateOrganic: (query) => yourModel.generate(query),
});

const response = await router.answer({
  query: userQuery,
  ageEligibility: "ADULT_DECLARED",
  coarseLocale: "en-IN",
});
```

The router generates the independent organic answer first. If that step fails, it does not request
an advertising decision. If AdReceipt is unavailable after organic generation, the router returns
the organic answer with `state: "UNAVAILABLE"` and no sponsorship. Eligibility still returns no
creative; the SDK releases the stored creative only after the original decision, campaign,
placement, receipt, landing page, Graph result, and RPC evidence agree.

API requests have a bounded ten-second timeout by default. Publishers can lower it through
`requestTimeoutMs`; a timeout preserves the organic answer and suppresses sponsorship.

The SDK cannot activate advertiser campaigns or spend from the Privy organization wallet. Campaign
approval remains an advertiser EIP-712 signature, and settlement remains an authenticated operator
operation constrained independently by Privy's default-deny policy.

The package is framework-independent and accepts a custom Fetch implementation for server, edge, or
test runtimes. It does not proxy model traffic, rewrite the organic answer, store raw prompts, or
claim that CRE simulation is an enforced onchain attestation.
