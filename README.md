# AdReceipt

AdReceipt makes a paid AI recommendation independently checkable. A publisher signs the exact
recommendation context and price, a Privy-managed payer settles test USDC directly to the named
recipient, and one immutable receipt is indexed by The Graph. The API accepts a receipt as paid
only when the indexed fields match the successful Sepolia transaction and its event log.

The receipt proves that a specific payment happened for a signed recommendation context. It does
not prove that payment caused a model response, that the recommended product is good, or that an
independent customer has adopted the system.

## V2 agentic advertising flow

V2 extends the deployed receipt protocol into one complete advertising lifecycle:

```text
advertiser brief -> editable campaign -> advertiser signature -> PostgreSQL
user query -> independent answer + deterministic safety/matching decision
eligible decision -> PlacementTicketV2 -> CRE_SIMULATED policy result
publisher signature -> bounded settlement -> ReceiptCreated
The Graph + RPC -> Sponsored · Verified -> observed impression/click metrics
```

Campaigns, decisions, tickets, signatures, and measurement are persisted. No product, campaign,
creative, wallet, or performance number is compiled into the application. Unknown age, sensitive
context, an unavailable organic-answer provider, stale Graph data, a failed CRE simulation, an
unpaid ticket, or mismatched RPC evidence suppresses the verified sponsored placement.

`PlacementTicketV2` commits to the approved campaign revision, the salted sanitized context,
creative, confidential-policy commitment, amount, asset, chain, and settlement contract. Its hash
becomes `SubjectV1.placementId`, so V2 uses the already deployed V1 contract and receipt event.
Cross-runtime vectors keep the application and Chainlink encodings byte-identical.

## Current V1 flow

```mermaid
flowchart LR
    P["Publisher signs quote"] --> C["CRE placement check"]
    C -->|"CRE_SIMULATED"| W["Privy payer"]
    W -->|"test USDC"| S["PlacementSettlementV1"]
    S --> R["Publisher recipient"]
    S -->|"ReceiptCreated"| G["The Graph"]
    G --> V["Receipt API"]
    S -.->|"RPC transaction and log"| V
```

`PlacementSettlementV1` has no escrow, DNS, ENS, registry, or spend-tier gate. It checks the
publisher's EIP-712 signature, payer, token, amount, recipient, chain, contract, expiry, subject
hash, schema version, and replay nonce before transferring the exact amount.

## Live Sepolia evidence

| Component     | Verified state                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settlement    | [`0x2fB6889Cc142C622a0479aF56b75B98beAeD3576`](https://sepolia.etherscan.io/address/0x2fB6889Cc142C622a0479aF56b75B98beAeD3576), deployed at block `11648834` in [transaction `0xf2db…c584`](https://sepolia.etherscan.io/tx/0xf2dbcfa9c1ede10519c37cedce0e69f59b1f0e8fc5b761edb69742cd5852c584) |
| Asset         | Circle test USDC, [`0x1c7D…7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)                                                                                                                                                                               |
| Subgraph      | Studio version `0.0.1`, deployment `QmXQmu8ce7JEATADtGXK65NceaKsF79Jz8whT9S6Tx3N8E`; [query endpoint](https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1)                                                                                                                             |
| Privy         | Default-deny policy rejected a disallowed signing request and allowed the bounded approval plus settlement                                                                                                                                                                                       |
| Chainlink CRE | `CRE_SIMULATED`: eligible and over-bid paths pass locally; no confidential workflow is deployed                                                                                                                                                                                                  |
| V1 receipt    | [`0xa63f…f9cd`](https://sepolia.etherscan.io/tx/0x29d0f2cb187f8c33d06329dd90f59dcd82b346c62c701cce53f37253cb69db28), settled through the bounded Privy policy in block `11652460`                                                                                                                |
| V2 receipt    | Placement `0x3038…0b0b` bound to receipt `0x67eb…ebf1`; [0.1 test-USDC settlement](https://sepolia.etherscan.io/tx/0x61b0ed24e27947835f8e7fd4e910086f456f5066603254106d5214e4dbefe163) confirmed in block `11669540` and returned `PAID_VERIFIED` after Graph/RPC comparison |

The publisher and recipient used for these tests are team-controlled. These transactions prove
the testnet integration, not third-party adoption. The V2 application recorded one impression and
one click only after the new ticket reached `PAID_VERIFIED`; those metrics are application events,
not onchain measurement or fraud proofs. Exact deployment data is stored in
[`deployments/placement-settlement-sepolia.json`](deployments/placement-settlement-sepolia.json).

Detailed evidence and proof boundaries are documented for [Privy](docs/evidence/privy.md),
[Chainlink CRE](docs/evidence/chainlink.md), and [The Graph](docs/evidence/the-graph.md). The team’s
use of coding assistants is described in [AI_ASSISTANCE.md](AI_ASSISTANCE.md).

## Frozen receipt event

```solidity
event ReceiptCreated(
    bytes32 indexed receiptId,
    bytes32 indexed campaignId,
    bytes32 indexed subjectHash,
    address publisher,
    address payer,
    address recipient,
    address asset,
    uint256 amount,
    uint64 settledAt,
    uint16 schemaVersion
);
```

The Graph mapping, generated ABI, RPC decoder, and API verifier all use this exact schema. Changing
its fields or indexed parameters requires coordinated updates across those components.

## Repository map

```text
contracts/                     Direct settlement and supporting prototype contracts
test/                          Hardhat settlement and contract tests
backend/src/privy/             Owner-authorized Privy client and default-deny policy
backend/src/receipts/          Graph query, RPC evidence reader, and fail-closed verifier
backend/src/v2/                Campaigns, context policy, ticket authorization, budgets, and metrics
backend/migrations/            PostgreSQL V2 schema
subgraph/                      ReceiptCreated indexing for the live Sepolia contract
cre/placement-authorization/   CRE placement policy workflow and simulation tests
frontend/                      Advertiser, publisher, settlement, ledger, and receipt UI
deployments/                   Public testnet deployment records
```

The DNS, ENS, tier, and refundable-escrow contracts are retained as an earlier prototype. Domain
control is exposed as an optional advertiser-onboarding signal, but it does not gate or alter V1
payment verification. ENS, spend tiers, and refundable escrow are not part of the accepted V1 path.

## Local verification

Requirements: Node.js 22, npm, Bun 1.3.14, PostgreSQL 16, and the Chainlink CRE CLI.

```bash
git clone https://github.com/Anand-0037/adreceipt.git
cd adreceipt
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm install --prefix subgraph --no-audit --no-fund
npm run cre:install
npm run verify:all
```

Start PostgreSQL and the two application processes after configuring the root `.env`:

```bash
docker run --name adreceipt-postgres \
  -e POSTGRES_USER=adreceipt \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=adreceipt \
  -p 127.0.0.1:54329:5432 -d postgres:16-alpine

# DATABASE_URL=postgresql://adreceipt:change-me@127.0.0.1:54329/adreceipt
npm --prefix backend run dev
npm --prefix frontend run dev
```

`verify:all` compiles contracts and the CRE WASM workflow, builds the subgraph and frontend, then
runs contract, Graph, backend, and CRE tests plus every TypeScript check. Tests and simulations are
local evidence; they do not substitute for a public transaction or a deployed confidential
workflow.

For local configuration, copy [`.env.example`](.env.example) to `.env`. Every package uses that
repository-root file so Graph, RPC, settlement, and Privy coordinates cannot drift between
processes. Never commit API keys, wallet keys, deploy keys, or private policy material.

## Agent discovery

An agent that already knows the AdReceipt origin can discover the service through two public,
same-origin resources:

- [`/llms.txt`](frontend/public/llms.txt) explains when to use AdReceipt, the required lifecycle,
  and its trust and privacy boundaries.
- [`/openapi.json`](frontend/public/openapi.json) describes the callable campaign, context,
  placement, measurement, and receipt operations.

Every rendered page links to these resources with `describedby` and `service-desc` relations. This
makes the deployed application self-describing, but it does not automatically place AdReceipt in
an agent's tool registry. A production integration still needs one of these distribution paths:

1. direct installation of the OpenAPI tool by a publisher or advertiser agent;
2. an AdCP/MCP adapter registered in advertising-agent catalogs;
3. an A2A server and valid `/.well-known/agent-card.json` after an actual A2A task endpoint exists;
4. a publisher SDK that embeds context decision, placement, and verification calls.

The current release implements the first path. It does not publish an A2A Agent Card because the
application does not yet implement the A2A task protocol.

## Receipt API

```http
GET /receipts/0x<32-byte-receipt-id>
GET /receipts/0x<32-byte-receipt-id>?atBlock=<positive-block-number>
GET /subjects/0x<32-byte-subject-hash>
GET /deployment
GET /health
GET /health/privy
POST /v2/campaigns/suggest
POST /v2/campaigns
POST /v2/campaigns/:id/revisions/:revision/approve
POST /v2/decisions
POST /v2/placements
POST /v2/placements/:id/sign
POST /v2/placements/:id/verify
POST /v2/placements/:id/measurements
GET  /v2/receipts/:receiptId/evidence
GET  /v2/campaigns/:id/metrics
```

The verifier returns `PAID_VERIFIED` only after it finds the Graph entity and independently confirms
the successful transaction, expected settlement contract, exact `ReceiptCreated` log, Sepolia chain,
schema, and every indexed field. Missing or inconsistent provider evidence fails closed.

## Web flow

- `/campaign` turns an advertiser brief into editable targeting and creative, persists the final
  manifest, and requires its advertiser wallet to sign the exact revision before activation.
- `/ask` creates an independent organic answer, applies the adult/non-sensitive contextual gate,
  matches active campaigns, runs CRE simulation for the exact ticket, obtains the publisher quote,
  and exposes settlement only after a complete preflight.
- `/receipts/:id` shows the full payment binding, Graph head, RPC chain, transaction, block, and
  explorer links.

Receipt endpoints are public and read-only. V2 measurement accepts events only for a stored
`PAID_VERIFIED` ticket; clicks require a prior viewable impression and event UUIDs are idempotent.
The metrics are application-observed, not onchain facts or fraud proofs. The optional domain-control endpoint can record only a
current positive DNS result after the claimant signs a short-lived, one-time authorization bound to
the wallet, domain, Sepolia chain ID, and current registry challenge. Missing or inconsistent DNS
evidence is never written. Privy payment submission remains in operator-controlled scripts, so a
public caller cannot trigger a payer-wallet transaction.

## Remaining external work

- Deploy the web app, API, and PostgreSQL to stable public URLs, then run a cold demo and record the
  human-narrated submission video.
- Deploy the CRE workflow only if Confidential Workflows access becomes available.

## License

MIT — see [LICENSE](LICENSE).
