# Deploying AdReceipt: frontend on Vercel, API on Railway

The two halves of AdReceipt have different hosting needs, and the split below
matches them.

The **frontend** is a Next.js app with no long-lived state. Vercel builds it
once, serves it from a CDN, and never sleeps. It is free.

The **API** cannot run on a serverless platform. It shells out to the Chainlink
`cre` binary for every placement authorization (30–90 seconds), holds MCP
sessions in memory, and waits up to two minutes on a settlement transaction.
Railway runs it as a persistent container from the repository `Dockerfile`, does
not sleep by default, and is the same price as a paid Render instance.

The single most important wiring decision: **the browser must call the API
directly**. The frontend has an `/api/*` proxy route for local development, but
on Vercel that route runs as a serverless function with a 60-second cap, and
both authorization and settlement would time out inside it. Setting
`NEXT_PUBLIC_API_BASE` bypasses the proxy; the API's CORS already allows it.

## API on Railway

### Create the service

1. **railway.app → New Project → Deploy from GitHub repo** → `Anand-0037/adreceipt`.
2. Railway detects the root `Dockerfile` (via `railway.json`) and builds it. The
   first build takes 4–6 minutes: it downloads the pinned CRE CLI and bun, then
   compiles the WASM workflow. Later builds reuse those layers.
3. **Settings → Networking → Generate Domain.** Note the URL; the frontend needs it.
4. Confirm **Settings → Deploy → App Sleeping** is off. `railway.json` sets
   `sleepApplication: false`, but check the toggle - this is the entire point.

### Environment variables

Copy the values from Render (**adreceipt-api → Environment**). Nothing here is
in the repository, and nothing should be.

| Variable | Notes |
| --- | --- |
| `NETWORK` | `sepolia` |
| `SEPOLIA_RPC_URL` | Alchemy or equivalent. The free tier caps `eth_getLogs` at 10 blocks; the API already chunks around that. |
| `SEPOLIA_OPERATOR_RPC_URL` | Optional separate RPC for settlement writes |
| `PLACEMENT_SETTLEMENT_ADDRESS` | `0x2fB6889Cc142C622a0479aF56b75B98beAeD3576` |
| `GRAPH_QUERY_URL` | `https://api.studio.thegraph.com/query/1754808/adreceipt/0.0.1` |
| `GRAPH_API_KEY` | If the Studio endpoint requires one |
| `GRAPH_MAX_BLOCK_LAG` | `20` |
| `DATABASE_URL` | See below |
| `V2_PUBLISHER_ADDRESS` | The wallet that signs quotes. Must be one the team controls. |
| `V2_PAYER_ADDRESS` | The Privy organization wallet |
| `V2_RECIPIENT_ADDRESS` | Where placements pay out. Must differ from the payer. |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | From the Privy dashboard |
| `PRIVY_WALLET_ID`, `PRIVY_POLICY_ID` | The default-deny wallet and its policy |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Signs Privy requests |
| `OPERATOR_SETTLEMENT_TOKEN` | Gates in-product settlement. Never exposed to the browser. |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL` | Organic answers and campaign suggestions |
| `CRE_CREDENTIALS_BASE64` | `base64` of `~/.cre/cre.yaml` from an authenticated machine |
| `CRE_CONTEXT_BASE64` | `base64` of `~/.cre/context.yaml` from the same machine |
| `CRE_SIMULATOR_PRIVATE_KEY` | Only for wallet-authorised domain attestations. Never the deployer key. |

Two are **set by the Dockerfile** and must not be overridden:

- `CRE_CLI_PATH=/app/runtime-bin/cre` - on Render this was the relative
  `runtime-bin/cre`; the container uses an absolute path.
- `PORT=8787` - Railway injects its own `PORT`, which is fine; the API reads
  whichever is set.

The two CRE variables are the ones most often missed. Produce them on a machine
where `cre whoami` succeeds:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.cre\cre.yaml"))
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.cre\context.yaml"))
```

Paste each output into Railway directly. Do not write them to a file in the
repository or to the shared `.env.example`.

### Database

The API needs PostgreSQL 16 and creates its own schema on first use. Either:

- keep the existing database and set `DATABASE_URL` to it - Railway can reach
  any public Postgres; or
- **Railway → + New → Database → PostgreSQL** and reference it as
  `${{Postgres.DATABASE_URL}}` in the API service's variables. This is a fresh,
  empty database: campaigns and placements from the old one do not follow.

The V2 receipt path verifies against The Graph and Sepolia, not the database,
so the public ledger and every existing on-chain receipt keep working either
way. Only draft campaigns and application-observed metrics live in Postgres.

### Verify

```
https://<railway-domain>/health       → ok: true, network: sepolia, a recent block
https://<railway-domain>/v2/status    → storage: configured, placementBindings: {…},
                                         adcp.inventoryReady: true
```

If `placementBindings` reads `"unavailable"`, one of the three `V2_*` addresses
is missing or the payer equals the recipient.

## Frontend on Vercel

1. **vercel.com → Add New → Project → Import** `Anand-0037/adreceipt`.
2. **Root Directory:** `frontend`. Tick **"Include source files outside of the
   Root Directory"** - `frontend/lib/protocol.ts` imports
   `../../deployments/*.json`, and the build fails without it.
3. Framework is auto-detected as Next.js. Leave build and output settings alone.
4. **Environment Variables** - exactly one:

   ```
   NEXT_PUBLIC_API_BASE = https://<railway-domain>
   ```

   No trailing slash. This is read at build time, so it must exist before the
   first deploy; change it and redeploy if the API domain ever changes.

5. **Deploy.**

Open `/ask` on the Vercel URL, ask the relevant example question, and confirm
the assistant bubble types out an answer - that request went straight from the
browser to Railway. Then open the browser's network tab and confirm calls go to
the Railway domain, not to `/api/…` on Vercel.

## After both are live

- Update the URLs in `README.md` (Live demo table) and `frontend/public/llms.txt`.
- Delete the two Render services, or leave `adreceipt-api` as a cold spare. If
  you keep it, remove `adreceipt-web` at least - it consumes free hours on every
  visit for no benefit.
- `render.yaml` can stay in the repository as a record, or be removed once
  Render is fully retired.

## What was tested before this document was written

The image was built and run locally with the production `.env`: `/health`
reported Sepolia live, `/v2/status` reported storage, bindings and AdCP
inventory ready, and a CRE placement simulation completed inside the container
with the pinned CLI. Two things the slim base image lacked were found that way
and are now in the Dockerfile: `bun` on `PATH` (the CRE SDK compiler spawns it
by name) and `make` (the CRE CLI refuses to simulate any WASM workflow without
it, precompiled or not).
