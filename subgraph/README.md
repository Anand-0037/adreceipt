# AdReceipt Subgraph

This Subgraph indexes payments that the settlement contract has successfully attached to a
sponsored recommendation. It does not infer sponsorship from deposits, advertiser claims, or
application-provided flags.

The initial schema intentionally stores receipts only. It does not aggregate campaign spend across
assets because totals with mixed denominations are not meaningful.

## Current boundary

The schema and mapping compile against the proposed `ReceiptCreated` event. The ABI is a candidate
until the contract team accepts the event and implements `PlacementSettlementV1`.

The zero address and `startBlock: 0` in `subgraph.yaml` are build-only sentinels. Do not deploy the
manifest until both values are replaced with the real testnet deployment.

## Commands

From the repository root:

```bash
npm install --prefix subgraph
npm run graph:codegen
npm run graph:build
npm run graph:test
```

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

The API key used to query the hosted Subgraph belongs in server-side environment configuration. It
must not be committed or exposed through browser-prefixed environment variables.
