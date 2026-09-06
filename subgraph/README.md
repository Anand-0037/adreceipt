# AdReceipt Subgraph

This Subgraph indexes payments that the settlement contract has successfully attached to a
sponsored recommendation. It does not infer sponsorship from deposits, advertiser claims, or
application-provided flags.

The initial schema intentionally stores receipts only. It does not aggregate campaign spend across
assets because totals with mixed denominations are not meaningful.

## Receipt contract

The schema and mapping use the frozen V1 `ReceiptCreated` event. `receiptId` is the EIP-712 quote
digest. A settlement contract must reject a consumed receipt ID and a reused publisher-scoped
nonce, while allowing separately authorized placements to share a `subjectHash`.

The ABI is final for the Subgraph, but `PlacementSettlementV1` is not deployed yet. The Subgraph
cannot provide live evidence until that contract emits a real receipt on Sepolia.

The zero address and `startBlock: 0` in `subgraph.yaml` are build-only sentinels. Do not deploy the
manifest until both values are replaced with the real testnet deployment.

The selected indexing network is Ethereum Sepolia (`sepolia`, chain ID `11155111`). In Subgraph
Studio, select Sepolia for the `adreceipt` Subgraph. The Studio deploy key is deployment-only and
belongs in `subgraph/.env`; it is not `GRAPH_API_KEY` and must never be committed or copied into the
backend.

## Commands

From the repository root:

```bash
npm install --prefix subgraph
npm run graph:codegen
npm run graph:build
npm run graph:test
```

After `PlacementSettlementV1` is deployed, copy `subgraph/.env.example` to the ignored
`subgraph/.env`, fill the public contract address and deployment block, and load it into the shell:

```bash
set -a
. subgraph/.env
set +a
npm --prefix subgraph run configure
npm --prefix subgraph run deploy:check
npm --prefix subgraph exec -- graph auth "$GRAPH_DEPLOY_KEY"
npm --prefix subgraph run deploy:studio
```

Use version `0.0.1` for the first Studio deployment when prompted. The `configure` command rejects
an invalid address, block zero, and any network other than Sepolia. `deploy:studio` runs the ABI and
manifest preflight before invoking the Graph CLI for the existing Studio slug `adreceipt`.

Graph dependencies are isolated in this directory. The root `npm ci`, `npm run build`, and
`npm test` commands remain contract-only; CI installs both dependency trees and runs `build:all`
plus `test:all`. The Subgraph dependency tree uses exact direct versions but does not commit its
generated npm lockfile. The package-local `.npmrc` prevents npm from recreating it.

Before deploying, verify all of the following:

- the ABI was generated from the accepted settlement contract;
- the network matches the deployment;
- the data-source address is nonzero;
- `startBlock` is the contract deployment block;
- one real `ReceiptCreated` transaction exists;
- the hosted query returns that receipt and healthy `_meta` data.

`deploy:check` intentionally fails while the build-only address and block sentinels remain. It also
requires the contract ABI to contain the exact frozen V1 `ReceiptCreated` event. Run it before
`graph deploy` so invalid coordinates or an incompatible contract handoff cannot be deployed.

The API key used to query the hosted Subgraph belongs in server-side environment configuration. It
must not be committed or exposed through browser-prefixed environment variables. After the first
Studio deployment is healthy, copy its development query URL to backend `GRAPH_QUERY_URL` and a
separate query API key to backend `GRAPH_API_KEY`. The Studio deploy key is not a query API key.
