# AdCP integration boundary

AdReceipt should integrate with Ad Context Protocol as a trust and settlement extension for
agent-bought advertising. It should not fork AdCP's media-buy vocabulary or claim conformance before
an actual MCP transport passes the AdCP storyboards.

## Existing AdReceipt capabilities

| AdReceipt capability | Current operation | AdCP relationship |
| --- | --- | --- |
| Describe the available AI-answer placement | `GET /openapi.json` and `GET /llms.txt` | Future `get_adcp_capabilities` and `get_products` |
| Turn a human brief into targeting and creative | `POST /api/v2/campaigns/suggest` | Input preparation before `create_media_buy` |
| Persist and approve campaign terms | `POST /api/v2/campaigns`, then wallet approval | Future signed context for `create_media_buy` |
| Match sanitized context at serve time | `POST /api/v2/decisions` | Trusted Match context-match adapter |
| Authorize an exact placement | `POST /api/v2/placements` | AdReceipt extension after media-buy eligibility |
| Prove settlement | `POST /api/v2/placements/:id/verify` | AdReceipt receipt extension on delivery evidence |
| Report impressions, clicks, CTR, eCPC, and eCPM | measurement and metrics endpoints | Future `get_media_buy_delivery` mapping |

## Smallest useful adapter

The first AdCP implementation should expose only four MCP tools:

1. `get_adcp_capabilities`
2. `get_products`
3. `create_media_buy`
4. `get_media_buy_delivery`

`get_products` should return one truthful product: a separately rendered sponsored recommendation
slot on the AdReceipt publisher surface. Its supported pricing and format must match what the
application can actually settle and render.

`create_media_buy` should translate the AdCP request into a CampaignManifestV2 draft. It must return
an input-required/human-approval state until the advertiser wallet signs the exact campaign
revision. It must not activate a campaign merely because an agent called the tool.

At serve time, the Trusted Match adapter should translate only coarse, sanitized fields into the
existing ContextEnvelopeV2. Raw conversations, user identity, precise location, memories, and
advertiser-provided personal profiles must never enter the campaign or ticket.

`get_media_buy_delivery` should read the existing measurement ledger and distinguish application
observations from onchain settlement evidence. Impressions and clicks are not fraud proofs.

## AdReceipt extension data

An AdCP response can link to an `adreceipt` extension object after the base protocol mapping is
validated:

```json
{
  "placement_id": "0x...",
  "ticket_commitment": "0x...",
  "receipt_id": "0x...",
  "verification_status": "PAID_VERIFIED",
  "verification_url": "/receipts/0x...",
  "policy_proof_level": "CRE_SIMULATED"
}
```

The adapter must never return `PAID_VERIFIED` from a campaign, bid, ticket, signature, transaction
submission, or Graph entity alone. The existing Graph-plus-RPC verifier remains the only source of
that status.

## Acceptance tests

The integration is complete only when all of these pass:

- An AdCP client discovers the four supported tools through the MCP endpoint.
- `get_products` returns only inventory the publisher can render.
- `create_media_buy` produces a reviewable CampaignManifestV2 and pauses for advertiser signature.
- Unknown age, sensitive context, and irrelevant context return no eligible placement.
- A valid context creates the same PlacementTicketV2 commitment through REST and MCP adapters.
- An unpaid ticket never produces a verified sponsored placement.
- A paid ticket is returned only after The Graph and Sepolia RPC agree on every receipt field.
- Delivery reporting labels impressions and clicks as application-observed metrics.
- Official AdCP media-buy seller storyboards pass against the local MCP server.

## Deferred work

- Additional inventory products and publisher surfaces
- Auctions or multi-seller routing
- CPM/CPC batch settlement
- Audience or identity signals
- Creative upload/build tools
- A2A transport
- Public catalog registration

These additions come after the four-tool adapter passes conformance and one fresh V2 receipt is
verified end to end.
