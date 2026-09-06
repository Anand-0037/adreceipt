# AdReceipt

AdReceipt makes a paid AI recommendation independently checkable. A publisher signs the exact
recommendation context and price, a Privy-managed payer settles test USDC directly to the named
recipient, and one immutable receipt is indexed by The Graph. The API accepts a receipt as paid
only when the indexed fields match the successful Sepolia transaction and its event log.

The receipt proves that a specific payment happened for a signed recommendation context. It does
not prove that payment caused a model response, that the recommended product is good, or that an
independent customer has adopted the system.

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

| Component | Verified state |
| --- | --- |
| Settlement | [`0x2fB6889Cc142C622a0479aF56b75B98beAeD3576`](https://sepolia.etherscan.io/address/0x2fB6889Cc142C622a0479aF56b75B98beAeD3576), deployed at block `11648834` in [transaction `0xf2db…c584`](https://sepolia.etherscan.io/tx/0xf2dbcfa9c1ede10519c37cedce0e69f59b1f0e8fc5b761edb69742cd5852c584) |
| Asset | Circle test USDC, [`0x1c7D…7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| Subgraph | Studio version `0.0.1`, deployment `QmXQmu8ce7JEATADtGXK65NceaKsF79Jz8whT9S6Tx3N8E`; [query endpoint](https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1) |
| Privy | Wallet and default-deny policy configured for bounded USDC approval and settlement |
| Chainlink CRE | `CRE_SIMULATED`: eligible and over-bid paths pass locally; no confidential workflow is deployed |
| Paid receipts | `0` as of September 6, 2026; the first Privy settlement has not been broadcast |

The publisher and recipient used for the first test are team-controlled. A successful transaction
will prove the testnet integration, not third-party adoption. Exact deployment data is stored in
[`deployments/placement-settlement-sepolia.json`](deployments/placement-settlement-sepolia.json).

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
subgraph/                      ReceiptCreated indexing for the live Sepolia contract
cre/placement-authorization/   CRE placement policy workflow and simulation tests
frontend/                      Earlier product UI; the V1 receipt screens are not implemented yet
deployments/                   Public testnet deployment records
```

The DNS, ENS, tier, and refundable-escrow code is retained as an earlier prototype. It is not part
of the accepted V1 payment path.

## Local verification

Requirements: Node.js 22, npm, and Bun 1.3.14.

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

`verify:all` compiles contracts and the CRE WASM workflow, builds the subgraph and frontend, then
runs contract, Graph, backend, and CRE tests plus every TypeScript check. Tests and simulations are
local evidence; they do not substitute for a public transaction or a deployed confidential
workflow.

For local configuration, copy [`.env.example`](.env.example) and
[`backend/.env.example`](backend/.env.example). Never commit API keys, wallet keys, deploy keys, or
private policy material.

## Receipt API

```http
GET /receipts/0x<32-byte-receipt-id>
GET /receipts/0x<32-byte-receipt-id>?atBlock=<positive-block-number>
GET /health/privy
```

The verifier returns `PAID_VERIFIED` only after it finds the Graph entity and independently confirms
the successful transaction, expected settlement contract, exact `ReceiptCreated` log, Sepolia chain,
schema, and every indexed field. Missing or inconsistent provider evidence fails closed.

## Remaining release work

- Review and broadcast the bounded `approve` and `settlePlacement` transactions.
- Confirm one `ReceiptCreated` event through RPC, The Graph, and the receipt API.
- Build the accepted `/campaign`, `/ask`, and `/receipts/:id` frontend paths with failure states.
- Deploy the CRE workflow only if Confidential Workflows access becomes available.

## License

MIT — see [LICENSE](LICENSE).
