# AdReceipt Subgraph

This Subgraph indexes payments that the settlement contract has successfully attached to a
sponsored recommendation. It does not infer sponsorship from deposits, advertiser claims, or
application-provided flags.

## Current boundary

The schema and mapping compile against the proposed `ReceiptCreated` event. The ABI is a candidate
until the contract team accepts the event and implements `PlacementSettlementV1`.

The zero address and `startBlock: 0` in `subgraph.yaml` are build-only sentinels. Do not deploy the
manifest until both values are replaced with the real testnet deployment.

## Commands

From the repository root:

```bash
npm run graph:codegen
npm run graph:build
npm run graph:test
```

Before deploying, verify all of the following:

- the ABI was generated from the accepted settlement contract;
- the network matches the deployment;
- the data-source address is nonzero;
- `startBlock` is the contract deployment block;
- one real `ReceiptCreated` transaction exists;
- the hosted query returns that receipt and healthy `_meta` data.

The API key used to query the hosted Subgraph belongs in server-side environment configuration. It
must not be committed or exposed through browser-prefixed environment variables.
