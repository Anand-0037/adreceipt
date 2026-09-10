<p align="center">
  <img src="frontend/public/brand/adreceipt-logo.png" alt="AdReceipt" width="430" />
</p>

<p align="center"><strong>Every sponsored AI recommendation should come with a receipt.</strong></p>

<p align="center">
AdReceipt lets advertiser agents buy contextual placements while giving users independent proof of who paid, how much, for which recommendation, and under what policy.
</p>

# AdReceipt

AI assistants are becoming places where people discover products, tools, and services. That creates a new trust problem: when an AI recommends something, the user cannot tell whether the recommendation was organic, sponsored, or quietly influenced by a commercial relationship.

A normal “Sponsored” badge is only a promise from the platform collecting the money. AdReceipt gives that badge evidence.

An advertiser approves a campaign. A publisher offers a separately rendered sponsored placement. AdReceipt checks that the context is relevant and safe, privately evaluates the campaign policy, settles the exact payment, and binds the payment to the exact placement. The advertisement appears as **Sponsored · Verified** only after The Graph discovers the receipt and Ethereum RPC independently confirms every field.

> **Stripe receipts tell you a payment happened. AdReceipt tells you which AI sponsorship it paid for.**

## Why AdReceipt is not an LLM or x402 router

[Router402](https://www.router402.xyz/) is an OpenRouter-compatible gateway that uses x402 payments to charge for LLM API requests. It answers a useful infrastructure question: **how can a client pay for model usage per request?**

AdReceipt answers a different question: **can a user verify the commercial influence inside an AI experience?** Its unit is an exact sponsored placement rather than the surrounding model request. A valid AdReceipt binds the advertiser-approved campaign, sanitized context, exact creative, publisher-signed quote, direct payment, and emitted receipt. The interface shows **Sponsored · Verified** only after The Graph finds that receipt and Sepolia RPC independently agrees with every indexed field.

Routing can become a publisher integration layer for AdReceipt, but routing alone cannot produce a verified sponsorship claim. The trust protocol and its fail-closed verifier remain the product boundary.

## Live demo

The current release is deployed at **[adreceipt-web.onrender.com](https://adreceipt-web.onrender.com)**.

| Start here | What to try |
| --- | --- |
| [Advertiser](https://adreceipt-web.onrender.com/advertiser) | Turn a product brief into an editable campaign and sign the approved revision |
| [Publisher](https://adreceipt-web.onrender.com/publisher) | Ask a question, inspect the contextual decision, and follow the placement proof |
| [Receipt ledger](https://adreceipt-web.onrender.com/ledger) | Browse receipts indexed from the live Sepolia settlement contract |
| [Verified V2 receipt](https://adreceipt-web.onrender.com/receipts/0x67ebdc71e8954c534ee6d1bc12dc8728dec9f6a1f5afc301c272bec7be8aebf1) | Read the human summary and expand the Graph, RPC, signature, and transaction evidence |

The public API is available at **[adreceipt-api.onrender.com](https://adreceipt-api.onrender.com)**. Its [health endpoint](https://adreceipt-api.onrender.com/health) reports the current Sepolia, Graph, settlement, Privy, and V2 runtime status. Free instances may need a short cold start after inactivity.

## See the idea in one flow

~~~text
Advertiser:
“Promote KaggleIngest to ML developers.
Budget: 10 USDC. Never advertise in sensitive conversations.”

                         ↓

Advertiser agent prepares targeting, creative, budget, and safety rules
                         ↓
Advertiser reviews and signs the exact campaign revision
                         ↓

User:
“What can help me load Kaggle datasets into my coding agent?”

                         ↓

Organic answer is generated independently
                         ↓
Context is classified without exposing the raw query to advertisers
                         ↓
Relevance and safety pass
                         ↓
Private campaign policy approves the exact placement
                         ↓
Privy-controlled payer settles test USDC on Sepolia
                         ↓
ReceiptCreated → The Graph → independent RPC verification
                         ↓

┌─────────────────────────────────────────────────────┐
│ Sponsored · Verified ✓                              │
│                                                     │
│ KaggleIngest                                        │
│ Load Kaggle datasets directly into your workflow.   │
│                                                     │
│ Why this ad?                         View receipt ↗  │
└─────────────────────────────────────────────────────┘
~~~

If the query is irrelevant, sensitive, from an under-18 or unknown-age session, or cannot be verified, AdReceipt shows no sponsored placement. Money cannot turn an irrelevant campaign into a match.

## What the product includes

### For advertisers

The advertiser starts with a plain-language brief instead of a large ad-manager form. The campaign agent suggests targeting, intent, creative, locale, and a maximum placement cost. The advertiser can edit the draft and must sign the exact final revision before it becomes active.

### For AI publishers

The publisher keeps the organic answer separate from advertising. For an eligible query, it can request an exact placement ticket, obtain a signed quote, and receive payment through the existing settlement protocol. The framework-independent [publisher SDK](sdk/README.md) wraps this lifecycle and releases sponsored creative only after live verification returns `PAID_VERIFIED`.

### For users and auditors

The user sees sponsored creative only after payment verification. **Why this ad?** explains the contextual match, safety decision, personalization status, policy proof, and payment proof. The receipt page starts with a human explanation and keeps hashes and chain data available as technical evidence.

### For external agents

The service exposes [LLM discovery instructions](frontend/public/llms.txt), an [OpenAPI description](frontend/public/openapi.json), and a working [AdCP seller adapter over MCP](docs/adcp-mcp-adapter.md). External advertising agents can discover the available sponsored-recommendation product, prepare a media buy, receive the exact campaign payload that requires advertiser signature, and read delivery evidence. The adapter calls the same campaign store, eligibility engine, receipt verifier, and measurement ledger as the web application.

## Architecture

~~~mermaid
flowchart TB
    subgraph Advertiser["Advertiser side"]
        H["Human advertiser"]
        A["Advertiser agent"]
        M["CampaignManifestV2"]
        H -->|"brief + budget"| A
        A -->|"editable draft"| M
        H -->|"wallet approval"| M
    end

    subgraph Publisher["AI publisher surface"]
        U["User query"]
        O["Independent organic answer"]
        X["Sanitized ContextEnvelopeV2"]
        GATE{"Relevant, adult and non-sensitive?"}
        MATCH["Relevance-first campaign match"]
        T["PlacementTicketV2"]
        CARD["Sponsored · Verified"]
        U --> O
        U --> X
        X --> GATE
        GATE -->|"yes"| MATCH
        GATE -->|"no"| NOAD["Suppress advertisement"]
        M --> MATCH
        MATCH --> T
    end

    subgraph Trust["AdReceipt trust protocol"]
        CRE["Chainlink CRE confidential policy check"]
        Q["Publisher-signed EIP-712 quote"]
        PRIVY["Privy organization wallet + default-deny policy"]
        SETTLE["PlacementSettlementV1"]
        EVENT["ReceiptCreated"]
        T --> CRE
        CRE -->|"eligible"| Q
        Q --> PRIVY
        PRIVY -->|"bounded test-USDC payment"| SETTLE
        SETTLE --> EVENT
    end

    subgraph Verify["Independent verification"]
        GRAPH["The Graph receipt discovery"]
        RPC["Canonical Sepolia RPC evidence"]
        VERIFY{"Every receipt field agrees?"}
        EVENT --> GRAPH
        EVENT --> RPC
        GRAPH --> VERIFY
        RPC --> VERIFY
        VERIFY -->|"PAID_VERIFIED"| CARD
        VERIFY -->|"missing, stale or inconsistent"| NOAD
    end

    CARD --> METRICS["Application-observed impression and click"]
~~~

The blockchain integration is the trust boundary, rather than a decorative payment step:

1. **CampaignManifestV2** binds the advertiser-approved campaign revision.
2. **ContextEnvelopeV2** commits to a coarse, sanitized context. The raw query is never committed onchain or sent to the advertiser.
3. **PlacementTicketV2** binds campaign, context, creative, policy, amount, asset, chain, and settlement contract.
4. Its commitment becomes **SubjectV1.placementId**, preserving compatibility with the deployed V1 contract.
5. The publisher signs an expiring EIP-712 quote for that exact subject.
6. Privy submits only policy-allowed approval and settlement calls.
7. **PlacementSettlementV1** transfers the exact amount and emits an immutable **ReceiptCreated**.
8. The Graph discovers the receipt. Ethereum RPC remains canonical.
9. The UI changes to **Sponsored · Verified** only when both sources agree field by field.

## Why each integration is necessary

| Integration | Role in AdReceipt | Verified boundary |
| --- | --- | --- |
| **Ethereum Sepolia** | Canonical settlement and immutable receipt event | Contract and two test-USDC receipt flows are live |
| **Privy** | Organization payer with a default-deny transaction policy | One disallowed request was rejected; bounded approval and settlement were allowed |
| **The Graph** | Live receipt discovery by receipt ID and recommendation subject | Studio indexes the deployed contract; verified status still requires RPC corroboration |
| **Chainlink CRE** | Confidentially evaluates private targeting and maximum-bid policy | Authenticated CLI eligible and over-bid simulations pass; status is **CRE_SIMULATED** |
| **Groq** | Produces campaign suggestions and an organic answer | The deterministic policy and verification pipeline fails closed if the model is unavailable |
| **PostgreSQL** | Persists campaigns, signed revisions, decisions, tickets, and measurements | No in-memory production fallback |

## Live Sepolia proof

All addresses and transactions below are public testnet evidence. The payer, publisher, and recipient are team-controlled. This proves the integration, not customer adoption or mainnet production use.

### Deployment

| Item | Value |
| --- | --- |
| Network | Ethereum Sepolia, chain ID **11155111** |
| Settlement contract | [0x2fB6889Cc142C622a0479aF56b75B98beAeD3576](https://sepolia.etherscan.io/address/0x2fB6889Cc142C622a0479aF56b75B98beAeD3576) |
| Deployment transaction | [0xf2dbcfa9c1ede10519c37cedce0e69f59b1f0e8fc5b761edb69742cd5852c584](https://sepolia.etherscan.io/tx/0xf2dbcfa9c1ede10519c37cedce0e69f59b1f0e8fc5b761edb69742cd5852c584) |
| Deployment block | **11648834** |
| Settlement asset | [Circle test USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| Graph Studio endpoint | [adreceipt/0.0.1](https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1) |
| Subgraph deployment | **QmXQmu8ce7JEATADtGXK65NceaKsF79Jz8whT9S6Tx3N8E** |

The machine-readable deployment record is in [deployments/placement-settlement-sepolia.json](deployments/placement-settlement-sepolia.json).

### First V1 settlement

| Item | Value |
| --- | --- |
| Privy payer | **0x84B5711b5Ff458478A2E55bb4797F5b254517a57** |
| USDC approval | [0xdef5ba01d21df8b9c817a330f0e3e16f5dc0482e39f19531d8b32bb1fb655bd3](https://sepolia.etherscan.io/tx/0xdef5ba01d21df8b9c817a330f0e3e16f5dc0482e39f19531d8b32bb1fb655bd3) |
| Settlement | [0x29d0f2cb187f8c33d06329dd90f59dcd82b346c62c701cce53f37253cb69db28](https://sepolia.etherscan.io/tx/0x29d0f2cb187f8c33d06329dd90f59dcd82b346c62c701cce53f37253cb69db28) |
| Receipt ID | **0xa63f1ce97fc2c2d97bb31f51e2f0989560d89937900d93fe36f303122d70f9cd** |
| Block | **11652460** |
| Amount | **0.1 test USDC** |

### V2 ticket-bound settlement

This is the complete V2 proof: the paid receipt is bound to a persisted campaign, sanitized context, creative, policy commitment, exact quote, and placement ticket.

| Item | Value |
| --- | --- |
| Placement ID | **0x30387eff3f77b1e25962ba2f96de01e13360a5bfd7422447ef11c9a4c0480b0b** |
| USDC approval | [0x60acf40ea5a86a05d21777efe54d3cfef493f18a54032080ddcb4067175dadd9](https://sepolia.etherscan.io/tx/0x60acf40ea5a86a05d21777efe54d3cfef493f18a54032080ddcb4067175dadd9) |
| Settlement | [0x61b0ed24e27947835f8e7fd4e910086f456f5066603254106d5214e4dbefe163](https://sepolia.etherscan.io/tx/0x61b0ed24e27947835f8e7fd4e910086f456f5066603254106d5214e4dbefe163) |
| Receipt ID | **0x67ebdc71e8954c534ee6d1bc12dc8728dec9f6a1f5afc301c272bec7be8aebf1** |
| Block | **11669540** |
| Amount | **0.1 test USDC** |
| Final application status | **PAID_VERIFIED** after The Graph and RPC comparison |

The V2 application accepted one viewable impression and one click only after this ticket became **PAID_VERIFIED**. They are application-observed events, not onchain facts or fraud proofs.

Detailed proof boundaries are available for [Privy](docs/evidence/privy.md), [The Graph](docs/evidence/the-graph.md), and [Chainlink CRE](docs/evidence/chainlink.md).

## What a receipt proves

A valid AdReceipt proves:

- a named payer transferred the exact asset and amount to the named recipient;
- the publisher signed an exact, expiring quote;
- the payment was bound to a campaign and recommendation subject;
- the configured settlement contract emitted the receipt;
- The Graph indexed the event;
- canonical RPC evidence matches the indexed entity.

It does not prove:

- that the advertised product is good;
- that payment caused or changed the organic answer;
- that an impression, click, or conversion is fraud-free;
- that the testnet participants are independent customers;
- that CRE currently enforces settlement onchain.

These limits are deliberate. AdReceipt verifies commercial provenance while keeping product quality and advertising performance as separate questions.

## Privacy and safety

AdReceipt does not send the raw conversation to advertisers. The context engine reduces a query to a closed vocabulary such as topic, intent, locale, and surface. A salted commitment binds that sanitized context to the placement without publishing the original prompt.

Before a commercial placement can proceed, the application checks:

- the session is confirmed as adult;
- the context is not sensitive;
- the campaign is active and within budget;
- topic, intent, locale, and product are allowed;
- semantic relevance meets the floor;
- the placement amount is within the private campaign ceiling;
- the creative, recipient, payer, asset, chain, and contract match the signed ticket.

Unknown age, mental-health or other sensitive context, irrelevant campaigns, provider failure, stale indexing, and mismatched chain evidence all fail closed.

## Product screens

| Route | Purpose |
| --- | --- |
| **/advertiser** | Turn a brief into an editable campaign, then review and sign the exact revision |
| **/publisher** | Ask a normal question and see the separate sponsored placement lifecycle |
| **/ledger** | Browse indexed settlement receipts |
| **/receipts/:id** | Read the human receipt and expand the full cryptographic evidence |
| **/campaign** and **/ask** | Direct aliases for the advertiser and publisher journeys |

Receipt discovery is public and read-only. Settlement is available inside the publisher proof trace only after the publisher signs the exact quote and an authorized operator supplies a separate settlement token. The token is not stored by the browser. The backend rechecks the quote, replay state, payer balance, allowance, chain, and contract before asking Privy to send anything; Privy's default-deny policy independently restricts the asset, recipient, function, and maximum amount.

## Run locally

### Requirements

- Node.js 22
- npm
- Bun 1.3.14
- PostgreSQL 16
- Chainlink CRE CLI

### Install and verify

~~~bash
git clone https://github.com/Anand-0037/adreceipt.git
cd adreceipt

npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm install --prefix subgraph --no-audit --no-fund
npm run cre:install

npm run verify:all
~~~

The verification command compiles the contracts and CRE WASM workflow, builds the Subgraph and frontend, and runs the contract, Graph, backend, CRE, and TypeScript checks.

### Configure

Copy [.env.example](.env.example) to **.env** and fill in the required local values. All packages read the repository-root environment file so RPC, Graph, settlement, Privy, Groq, and database configuration stay consistent.

Never commit API keys, wallet keys, deployer keys, Privy authorization keys, or private policy material.

### Start PostgreSQL and the app

~~~bash
docker run --name adreceipt-postgres \
  -e POSTGRES_USER=adreceipt \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=adreceipt \
  -p 127.0.0.1:54329:5432 \
  -d postgres:16-alpine

# Set DATABASE_URL=postgresql://adreceipt:change-me@127.0.0.1:54329/adreceipt
npm --prefix backend run dev
npm --prefix frontend run dev
~~~

Open:

- <http://localhost:3000/advertiser>
- <http://localhost:3000/publisher>
- <http://localhost:3000/ledger>

Local tests and simulations do not replace the public transaction proof above. The CRE simulator is explicitly not a deployed TEE.

## Repository map

~~~text
contracts/                     Direct settlement and supporting prototype contracts
test/                          Hardhat contract and cross-runtime commitment tests
backend/src/privy/             Privy client and default-deny transaction policy
backend/src/receipts/          Graph queries, RPC evidence, and fail-closed verification
backend/src/v2/                Campaigns, context, tickets, budgets, and measurements
backend/src/mcp/               Four-tool AdCP seller adapter over MCP
backend/migrations/            PostgreSQL V2 schema
sdk/                           Fail-closed publisher client and response composer
subgraph/                      Live ReceiptCreated indexing
cre/placement-authorization/   Confidential placement-policy workflow and tests
frontend/                      Advertiser, publisher, ledger, and receipt product
deployments/                   Public testnet deployment records
docs/evidence/                 Provider-specific evidence boundaries
~~~

The repository retains DNS, ENS, spend-tier, and refundable-escrow contracts from an earlier prototype. Optional domain control can support advertiser onboarding, but none of those systems gates or alters the accepted settlement receipt path.

## API and agent discovery

The main V2 lifecycle is available through typed HTTP endpoints. The examples below use the web application's same-origin `/api` proxy. When calling `https://adreceipt-api.onrender.com` directly, omit the `/api` prefix; for example, receipt verification is `GET https://adreceipt-api.onrender.com/receipts/:receiptId`.

~~~http
POST /api/v2/campaigns/suggest
POST /api/v2/campaigns
POST /api/v2/campaigns/:id/revisions/:revision/approve
POST /api/v2/decisions
POST /api/v2/placements
POST /api/v2/placements/:id/sign
POST /api/v2/placements/:id/verify
POST /api/v2/placements/:id/measurements
GET  /api/v2/receipts/:receiptId/evidence
GET  /api/v2/campaigns/:id/metrics

GET  /api/receipts/:receiptId
GET  /api/subjects/:subjectHash
GET  /api/deployment
GET  /api/health

POST /mcp                       Streamable HTTP MCP transport
~~~

See [frontend/public/openapi.json](frontend/public/openapi.json) for schemas, [frontend/public/llms.txt](frontend/public/llms.txt) for agent guidance, [docs/adcp-mcp-adapter.md](docs/adcp-mcp-adapter.md) for agent buying, and [sdk/README.md](sdk/README.md) for publisher integration.

The MCP server exposes four narrow tools: `get_adcp_capabilities`, `get_products`, `create_media_buy`, and `get_media_buy_delivery`. Run it locally over stdio with `npm --prefix backend run mcp`, or connect over Streamable HTTP at `POST https://adreceipt-api.onrender.com/mcp`. A complete example and the conformance boundary are documented in [docs/adcp-mcp-adapter.md](docs/adcp-mcp-adapter.md).

The adapter does not claim automatic registration in ChatGPT, a public MCP directory, or an AdCP catalogue, and it does not implement A2A. Campaign activation still requires the advertiser's EIP-712 signature, and delivery spend is reported only after The Graph and Sepolia RPC agree.

## Future impact

AI advertising should not repeat the web’s model of invisible tracking, opaque auctions, and platform-controlled attribution.

AdReceipt can become a neutral trust layer underneath AI chat, search, coding agents, terminals, shopping assistants, and publisher SDKs:

- **Advertiser agents** can discover inventory and manage campaigns within human-approved budgets.
- **Publishers** can monetize useful AI experiences without blending paid content into organic answers.
- **Users** can inspect why an advertisement appeared and verify its commercial provenance.
- **Auditors and regulators** can verify payment and policy evidence without trusting the publisher’s database.
- **Ad networks and protocols** can use one receipt format instead of inventing a new disclosure system for every surface.

The next protocol direction is selective disclosure: prove that a valid policy-bound payment exists while keeping exact bids and targeting strategy private. At scale, impressions and clicks can be aggregated before settlement rather than producing one blockchain transaction per event.

The long-term invariant remains simple:

> **No valid receipt means no Verified Sponsored claim.**

## Current boundaries

- The web app, API, contract, test-USDC settlements, Subgraph, and Graph-plus-RPC verification are publicly live; the deployed routes and known verified receipt passed a cold-browser check on September 10, 2026.
- Chainlink placement authorization is **CRE_SIMULATED**, not deployed or onchain-enforced.
- In-product settlement remains operator-controlled through a separate bearer token; public visitors cannot spend from the Privy organization wallet.
- The publisher SDK is implemented locally and fails closed when receipt evidence is pending, unavailable, invalid, or inconsistent.
- AdCP seller interoperability is implemented through four MCP tools over stdio and Streamable HTTP; public catalogue registration, A2A, auctions, and the remaining AdCP media-buy operations are outside the current release.
- The project demonstrates testnet infrastructure with team-controlled participants, not production adoption.

## License and disclosure

AdReceipt is released under the [MIT License](LICENSE).

The team’s use of coding assistants is documented in [AI_ASSISTANCE.md](AI_ASSISTANCE.md).
