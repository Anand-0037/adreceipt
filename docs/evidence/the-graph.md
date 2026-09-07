# The Graph integration evidence

The Graph is the live receipt-discovery layer used by the recommendation flow. The Subgraph indexes
`ReceiptCreated` events from the deployed Sepolia settlement contract and stores the complete
receipt binding as an immutable entity.

- Studio Subgraph: `adreceipt/0.0.1`
- Deployment: `QmXQmu8ce7JEATADtGXK65NceaKsF79Jz8whT9S6Tx3N8E`
- Query endpoint: <https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1>
- Contract: [`0x2fB6…3576`](https://sepolia.etherscan.io/address/0x2fB6889Cc142C622a0479aF56b75B98beAeD3576)
- First indexed receipt: `0xa63f1ce97fc2c2d97bb31f51e2f0989560d89937900d93fe36f303122d70f9cd`

The `/ask` flow queries receipts by the exact recommendation `subjectHash`. The API accepts a
candidate as `PAID_VERIFIED` only after the Graph entity matches the successful canonical Sepolia
transaction and `ReceiptCreated` log field by field. It also compares Graph `_meta` progress with
the RPC head and rejects indexing errors, excessive lag, future heads, wrong-chain evidence, and
historically premature receipts.

This makes The Graph load-bearing: a matching live receipt lets the assistant show a verified paid
placement, while missing, stale, unavailable, or inconsistent evidence prevents that claim. The
Graph is used for discovery and freshness; Ethereum remains the canonical settlement source.
