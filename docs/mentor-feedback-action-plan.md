# AdReceipt mentor feedback and team action plan

This note turns the latest mentor feedback into one shared execution plan. It separates what the current product already proves from what the team should polish before submission and what belongs after the hackathon.

## Product position to keep

AdReceipt is verifiable infrastructure for sponsored AI responses. It does more than add an advertisement to an answer: it binds the selected placement, exact sponsored content, publisher authorization, payment, disclosure, and later verification.

The shortest explanation is:

> AdReceipt proves that the advertiser payment, publisher authorization, and exact sponsored AI placement all match.

The existing direct-payment architecture stays intact. Advertiser funds move from the Privy-controlled payer to the publisher recipient through `PlacementSettlementV1`; AdReceipt does not hold campaign funds.

## What is already working

- An advertiser can turn a natural-language brief into an editable campaign and sign the exact campaign revision.
- The publisher flow keeps the organic answer separate from sponsored content.
- Context matching uses coarse topics, intent, locale, and age eligibility instead of sending the raw query to advertisers.
- Irrelevant, sensitive, under-18, unknown-age, and unverifiable requests suppress the sponsored placement.
- Chainlink CRE evaluates the private campaign policy in authenticated CLI simulation. The honest proof level is `CRE_SIMULATED`.
- Privy protects the organization payer with a default-deny policy and bounded USDC approval and settlement rules.
- `PlacementSettlementV1` is deployed on Ethereum Sepolia and has emitted real `ReceiptCreated` events for test-USDC payments.
- The Graph indexes settlement receipts, while the backend independently compares each indexed field with canonical Sepolia RPC evidence before returning `PAID_VERIFIED`.
- A V2 placement has a real ticket-bound, paid, indexed, and verified receipt.
- Impressions and clicks are stored as application-observed measurements only after payment verification.
- External agents can use the four-tool AdCP seller adapter through MCP.

## Submission priorities

### 1. Make the landing page choose a primary user

The hero currently speaks to advertisers, publishers, and users at once. The primary entry point should be the advertiser who wants to launch a trustworthy sponsored AI placement.

The first screen should answer three questions immediately:

1. What can I do? Launch a sponsored placement from a product brief.
2. Why is this different? The resulting ad carries independently verifiable payment and authorization evidence.
3. Where do I begin? `Create campaign` should be the main action; `See verified receipt` should be secondary.

Suggested hero:

> **Every sponsored AI recommendation should come with a receipt.**
>
> Launch contextual placements that appear only after the campaign, publisher authorization, and payment can be independently verified.

### 2. Keep the demo linear

Use one prepared campaign and one relevant publisher query. Do not jump between screens without explaining the role change.

The demo order is:

1. Open `/advertiser`.
2. Enter the product, campaign goal, budget, and maximum placement amount.
3. Let the campaign agent prepare targeting and creative.
4. Review and sign the exact campaign revision.
5. Open `/publisher` as the AI application.
6. Ask the prepared relevant question.
7. Show the independent organic answer.
8. Show the sanitized contextual match and safety decision.
9. Run the private CRE policy check.
10. Authorize and settle the exact placement through the operator-controlled Privy action.
11. Wait for The Graph and RPC verification.
12. Reveal `Sponsored · Verified` only after `PAID_VERIFIED`.
13. Record one real application-observed impression and click.
14. Open the receipt page and show the human summary before expanding hashes.
15. End on the campaign metrics and receipt ledger.

The problem statement should take roughly 15–20 seconds. The working product should occupy most of the recording.

### 3. Make the receipt visually concrete

The receipt is the product payoff. Lead with readable facts:

- advertiser or payer;
- publisher or recipient;
- exact sponsored text;
- campaign;
- sanitized match explanation;
- amount and asset;
- settlement transaction and block;
- publisher signature;
- The Graph indexed status;
- canonical RPC match;
- final `PAID_VERIFIED` result.

Keep hashes under an expandable technical-evidence section. Use the real V2 transaction already documented in the README; never replace it with seeded or fabricated data.

### 4. Show useful campaign statistics

The advertiser should see:

- spend backed by verified settlement receipts;
- receipts generated;
- verified sponsored renders;
- application-observed impressions;
- application-observed clicks;
- verification rate.

Do not imply that impression or click counts are onchain or fraud-proof. Avoid emphasizing CTR, CPC, or CPM when the sample is only one impression or one click; raw verified activity is clearer.

### 5. Show refusal as well as success

After the successful placement, use two short failure examples:

- an irrelevant query produces no campaign match;
- a sensitive or non-adult context suppresses advertising before a ticket or payment can exist.

This demonstrates that money cannot buy relevance and that the safety gate is part of the transaction path.

## Router/proxy direction

The strongest next product direction is to place AdReceipt directly in the publisher's response path:

```text
User request
  -> AI application or model
  -> AdReceipt publisher router
  -> contextual selection and policy authorization
  -> exact sponsored insertion and disclosure
  -> settlement and receipt
  -> independently verifiable final response
```

The router is a delivery layer over the current protocol. It must not replace the signed campaign, placement ticket, Privy policy, settlement contract, Subgraph, or Graph-plus-RPC verifier.

The product invariant remains:

```text
match -> authorize -> pay -> verify -> render sponsored content
```

An advertisement must not be rendered as verified merely because the router selected it. `Sponsored · Verified` still requires real receipt evidence.

### Thin implementation after the submission flow is stable

A future OpenAI-compatible publisher endpoint could accept a normal inference request, obtain the independent organic answer, create only a coarse `ContextEnvelopeV2`, select an eligible active campaign, authorize and settle the exact placement, verify its receipt, and return a response with a separate sponsored block and evidence URL.

It should include:

- publisher authentication and rate limits;
- idempotency per inference request and placement;
- a configured fixed publisher rate;
- request timeouts and an organic-only fallback;
- no raw-query disclosure to advertisers;
- no sponsored block when model, CRE, settlement, Graph, or RPC evidence is unavailable;
- an operator or delegated-wallet boundary for spending;
- structured logs that distinguish selection, authorization, settlement, indexing, and rendering;
- exact content and placement commitments so the returned creative cannot drift from the paid receipt.

Do not build a generic reverse proxy, modify model rankings, or inject sponsored text inside the organic answer. The sponsored block remains visually and structurally separate.

## Team ownership

### Product and demo owner

- Freeze the story and demo sequence.
- Keep the advertiser as the primary landing-page user.
- Prepare the exact campaign, publisher query, expected amount, and verified receipt used in the recording.
- Confirm all public links in a clean browser.
- Own the final transaction authorization and submission form.

### Frontend owner

- Clarify the hero and primary action.
- Preserve the current design system instead of rebuilding the UI.
- Make campaign creation, activation, sponsored rendering, metrics, and receipt inspection read as one sequence.
- Keep technical trace details expandable.
- Verify desktop and mobile layouts with loading, empty, refusal, and provider-error states.

### Backend and integration owner

- Keep one campaign store, one decision engine, one settlement service, and one receipt verifier shared by REST and MCP.
- Ensure settlement remains authenticated and idempotent.
- Keep raw queries and private salts out of advertiser, MCP, logs, and receipt responses.
- Preserve fail-closed behavior for CRE, Privy, Graph, RPC, database, and model failures.
- Do not claim `CRE_ENFORCED` without a deployed workflow and authenticated onchain receiver.

### Evidence and release owner

- Run the repository verification suite before recording.
- Perform the public flow in a new browser session.
- Capture the campaign signature, settlement transaction, receipt ID, block, Graph entity, RPC comparison, and final verified UI.
- Confirm README, `llms.txt`, OpenAPI, MCP documentation, live URLs, and submission answers describe the same current implementation.
- Record a 2–4 minute video with a human voice and no sped-up sections.

## Team rules while finishing

- Do not redesign the protocol or add another sponsor integration.
- Do not revive DNS, ENS, escrow, or spend tiers in the primary journey.
- Do not merge a PR because its local tests pass; review the user flow and proof boundary it changes.
- Keep PRs scoped by ownership so two people do not implement campaign, settlement, or verification logic twice.
- Rebase or merge current `main` before final review and run the complete checks after integration.
- Never commit credentials, private keys, bearer tokens, raw policies, or user queries.
- Use real Sepolia and Graph evidence only where the product claims verification.
- Label simulation, application-observed metrics, testnet participants, and future architecture honestly.
- Stop adding features once the cold public demo succeeds. Spend the remaining time on the recording, submission, screenshots, and judge clarity.

## Final acceptance checklist

- [ ] The hero identifies the advertiser as the primary entry point.
- [ ] A new browser can open the advertiser, publisher, ledger, and verified receipt pages.
- [ ] A campaign can be configured, reviewed, signed, and activated.
- [ ] A relevant publisher query reaches an eligible contextual decision.
- [ ] A sensitive and an irrelevant query suppress advertising.
- [ ] The exact placement can be authorized under `CRE_SIMULATED` without exposing private policy values.
- [ ] The operator-controlled Privy action can settle a fresh signed quote.
- [ ] The Graph indexes the resulting receipt.
- [ ] Sepolia RPC agrees with every indexed receipt field.
- [ ] The UI reveals the sponsored creative only after `PAID_VERIFIED`.
- [ ] The receipt page shows real transaction data in human-readable form.
- [ ] One viewable impression and click update application-observed campaign statistics.
- [ ] The MCP client can discover and call all four AdCP tools.
- [ ] The README and submission form match the deployed product and its limits.
- [ ] The final video follows the linear flow and stays under four minutes.

## One best next action

Run the entire public advertiser-to-receipt sequence once in a clean browser and record every discontinuity. Fix only issues that interrupt or confuse that sequence before recording the final video.
