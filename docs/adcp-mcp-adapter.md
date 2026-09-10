# AdCP over MCP — implementation

The four-tool adapter described in [adcp-integration.md](./adcp-integration.md), as built. It is an
adapter over the existing V2 services and owns no campaign store, settlement path, verifier or
metrics ledger of its own.

| | |
| --- | --- |
| Tools | `get_adcp_capabilities`, `get_products`, `create_media_buy`, `get_media_buy_delivery` |
| Transports | stdio (`npm --prefix backend run mcp`) and Streamable HTTP (`POST /mcp`) |
| Code | [`backend/src/mcp/`](../backend/src/mcp/) |
| Tests | `backend/src/mcp/adcp.test.ts`, `backend/src/mcp/server.test.ts` |
| Example agent | [`backend/examples/adcp-agent.ts`](../backend/examples/adcp-agent.ts) |

## Run it

Over stdio, the way an MCP client launches a local server:

```bash
npm --prefix backend run mcp
```

Over HTTP, mounted on the existing API — start the backend and POST JSON-RPC to `/mcp`:

```bash
npm --prefix backend run dev
curl -s http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The HTTP endpoint is stateless: every request gets its own server and transport, so there is no
session to establish and `GET`/`DELETE /mcp` answer `405` rather than 404.

To register it with an MCP client:

```json
{
  "mcpServers": {
    "adreceipt": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/adreceipt/backend", "run", "mcp"]
    }
  }
}
```

## Minimal external agent

`backend/examples/adcp-agent.ts` connects over stdio, discovers the tools, and walks the whole
lifecycle. Run it against your own backend:

```bash
npm --prefix backend run mcp:example
```

It prints the capability boundary, the product catalogue, the campaign draft with the exact typed
data the advertiser must sign, and the delivery report. It deliberately cannot activate the campaign
or conclude that anything was paid for — see below.

## What an agent must understand

**`create_media_buy` never activates anything.** It always returns `status: "input-required"` with
the EIP-712 `CampaignManifestV2` payload and the `campaignRevisionHash` the advertiser's wallet must
sign, plus the REST endpoint that accepts the signature. A campaign that nobody signed is a `DRAFT`
and does not serve. No tool call can change that.

**A missing `spend` is not zero.** `get_media_buy_delivery` reports `spend` only when The Graph and
Sepolia RPC agree on every receipt field. When that evidence cannot be gathered the row reads
`reporting_delayed`, the `spend` and `spend_atomic` fields are absent entirely, and the response
carries `partial_data: true` with a `payment-evidence-unavailable` error. Treating the absence as
zero spend reads the report backwards.

**Impressions and clicks are application-observed.** They are counted by the publisher application
when it renders a placement and when someone follows the link. They are not payment evidence and not
fraud proofs. Every delivery row carries `ext.adreceipt.metric_provenance` saying so per metric.

**The Chainlink proof level is `CRE_SIMULATED`.** The confidential placement policy runs in the CRE
workflow under simulation. Deployment access for a live DON is not enabled, so nothing here carries
an enforced hardware attestation, and `get_adcp_capabilities` says this in the same response that
advertises the tools.

## Request mapping

AdCP does not model wallet-settled sponsored recommendations, so AdReceipt-specific fields travel
under `ext.adreceipt` rather than being forced into unrelated standard fields:

| AdCP field | AdReceipt |
| --- | --- |
| `brand.name` | `brandDisplayName` — the disclosed brand |
| `brand.url` | `landingPage` (or `ext.adreceipt.landing_page`) |
| `start_time` / `end_time` | `validFrom` / `validUntil`, converted to unix seconds |
| `total_budget.amount` + `currency` | `totalBudget`, converted to atomic units by asset decimals |
| `packages[0].products` | must reference `adreceipt-sponsored-recommendation` |
| `ext.adreceipt.advertiser_wallet` | the wallet that must sign the revision |
| `ext.adreceipt.product_ref` | what is being advertised, verbatim |
| `ext.adreceipt.creative` | headline and body, rendered verbatim and hashed into the ticket |
| `ext.adreceipt.targeting` | topics, intents, locales, blocked context classes |

Currency conversion never passes through a float: the decimal string is split and padded, so a
budget cannot be silently rounded.

The mapping funnels into `parseCampaignInput`, the same function the REST route calls. That is what
makes REST and MCP produce an identical `campaignRevisionHash` — and therefore an identical
`PlacementTicketV2` commitment — for identical canonical data. Two tests assert exactly that.

## Conformance boundary

`get_adcp_capabilities` returns this at runtime; it is repeated here so it is reviewable without
running anything.

Implemented: the four tools above, over MCP, as an AdCP **seller**.

Not implemented: auctions or real-time bidding; more than one publisher product; audience identity
signals or personalization; CPM or CPC batch settlement; A2A transport; creative generation tools;
public catalog registration; `update_media_buy`, `sync_creatives` and the remaining AdCP media-buy
tasks.

Deviations worth knowing:

- Publisher identity is a wallet address, so `publisher_properties` carries a `publisher_wallet`
  identifier rather than a verified domain.
- Delivery is lifetime-to-date. `start_date` and `end_date` are accepted and ignored, and
  `reporting_capabilities.date_range_support` is `lifetime_only`.
- `delivery_type` is `non_guaranteed`: a placement exists only when a real query produces a matching
  sanitized context, so no volume can be promised in advance.

## Fail-closed behaviour

The adapter does not implement its own eligibility rules. It calls `decideCampaign`, which suppresses
a placement entirely — no ticket, no billable event — when age eligibility is `UNKNOWN` or
`UNDER_18`, when any sensitive context class is detected, or when intent is unclassified and no topic
matches. `get_products` returns an empty catalogue with a reason when the publisher, payer and
recipient bindings are unconfigured or campaign storage is down, because nothing could be rendered or
settled in that state.

Raw user queries, user identity, memories, precise location and commitment salts never appear in any
adapter response. A test serialises every tool response and asserts a sentinel query string and the
decision's private salt are absent.

## Verification status

Verified: tool discovery and all four calls through a real MCP `Client` over an in-memory transport;
the same four tools over live Streamable HTTP against a running backend; the stdio transport through
the example agent as a separate process; REST/MCP commitment equality; every refusal path listed
above.

Also verified against live Postgres and the configured bindings: `get_products` returning the one
product with all seven required AdCP fields, `create_media_buy` persisting a `DRAFT`, the returned
typed data recovering to the advertiser wallet, the REST approval route accepting that exact
signature and revision hash to move the campaign to `ACTIVE`, and `get_media_buy_delivery`
reporting it as `pending_start`.

That last step is the strongest evidence for the cross-path claim: the REST route recomputes the
campaign's typed data independently, so a signature over what MCP returned would not verify there
unless both paths built the identical `CampaignManifestV2`.
