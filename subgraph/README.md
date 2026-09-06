# AdReceipt Subgraph

This subgraph indexes the frozen V1 `ReceiptCreated` event from the live
`PlacementSettlementV1` contract on Ethereum Sepolia. It records successful settlement evidence;
it does not infer sponsorship from deposits, application flags, or advertiser claims.

## Live deployment

- Contract: `0x2fB6889Cc142C622a0479aF56b75B98beAeD3576`
- Start block: `11648834`
- Studio slug and version: `adreceipt/0.0.1`
- Deployment: `QmXQmu8ce7JEATADtGXK65NceaKsF79Jz8whT9S6Tx3N8E`
- Query URL: `https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1`

Studio is deployed and synced. No receipt entity exists until the first settlement emits
`ReceiptCreated`.

## Local checks

From the repository root:

```bash
npm install --prefix subgraph --no-audit --no-fund
npm run graph:codegen
npm run graph:build
npm run graph:test
```

The preflight rejects the zero address, block zero, the wrong network, or any ABI whose event fields
or indexed parameters differ from the frozen V1 event.

```bash
npm --prefix subgraph run deploy:check
```

## Studio deployment

Only deploy a new version after the contract ABI, address, and start block have been reviewed.
Keep the Studio deploy key in ignored `subgraph/.env`; it is not the query API key.

```bash
set -a
. subgraph/.env
set +a
npm --prefix subgraph exec -- graph auth "$GRAPH_DEPLOY_KEY"
npm --prefix subgraph run deploy:studio
```

The backend query URL and API key belong in server-side `GRAPH_QUERY_URL` and `GRAPH_API_KEY`.
Never put either secret in a browser-prefixed variable. The subgraph intentionally has no committed
generated npm lockfile; its exact direct dependency versions and package-local `.npmrc` keep that
workflow stable.
