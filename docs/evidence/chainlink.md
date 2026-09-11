# Chainlink CRE integration evidence

AdReceipt's Chainlink Runtime Environment workflow evaluates placement authorization inside a
confidential handler. Its private input contains the product allowlist and maximum bid. Its public
output contains only the eligibility decision, the bound quote information, and a salted policy
commitment.

The workflow registers its authorization handler with `handlerInTee`. Two authenticated CRE CLI
simulations used the same private policy:

| Case | Result |
| --- | --- |
| Product allowed and amount at the private ceiling | `eligible=true` |
| Same policy and amount one raw USDC unit above the ceiling | `eligible=false` |

Neither output reveals the private allowlist or bid ceiling. The compiled workflow binary hash was
`5518a24265e6410e58f8b845dcc5a88bd25a364ab17695f0544d3ba905d30802`.

Run the checked-in workflow with:

```bash
npm run cre:install
npm run cre:test
npm run cre:simulate
npm run cre:simulate:ineligible
```

The current evidence level is **`CRE_SIMULATED`**. The CRE CLI explicitly states that its simulator
is not a real TEE. AdReceipt does not claim a deployed workflow, authenticated Forwarder delivery,
or onchain CRE enforcement.

## Deployment is externally blocked

`cre whoami` for the authenticated account reports:

```
Organization ID:   org_4GyXUFcWtGOkW0W6
Organization Name: My Org
Deploy Access:     Not enabled
```

Deployment access is granted by Chainlink, not by anything in this repository. Until it is enabled
there is no deployed workflow, no workflow ID, no DON assignment and no authenticated report to
consume — so no run can be `CRE_ENFORCED`, and none is claimed.

Changing the reported level without that access would be a false security claim, which is why the
level is not a string an operator can set. See the three separate conditions under "Reaching
CRE_ENFORCED" below.

## What the simulator does and does not prove

It proves the policy logic: the allowlist, the campaign-revision pin, the topic and intent rules,
the bid ceiling, and the refusal to leak any of them.

It proves nothing about who ran that logic. The simulator is not a TEE, its output is not signed,
and the application currently learns the decision by reading the CLI's stdout. Anything able to
write to that pipe can assert an approval. That is the entire gap between `CRE_SIMULATED` and
`CRE_ENFORCED`.

## The authenticated consumption boundary

`backend/src/v2/cre-report.ts` is the only path by which a decision can become `CRE_ENFORCED`. It is
implemented and tested now so that enabling deployment is a configuration change rather than a
rewrite under time pressure.

A report is accepted only if all of the following hold, checked in this order:

1. **Envelope shape.** `rawReport`, `reportContext` and at least one signature, with `rawReport` at
   least 109 bytes — the CRE report metadata header length.
2. **Deployment identity.** The header's `workflowOwner`, `workflowName`, `workflowId` and `donId`
   all match the single recorded deployment. A correctly signed report from another workflow is
   still not ours, so identity is checked before signatures.
3. **DON quorum.** `f + 1` *distinct* signers from the configured signer set, recovered from
   `keccak256(keccak256(rawReport) ‖ reportContext)`. Duplicate signatures from one node count once;
   signatures from outside the set are dropped rather than counted.
4. **Binding.** All sixteen fields — schema version, ticket commitment, quote id, campaign id,
   campaign revision hash, subject hash, context commitment, policy commitment, payer, recipient,
   asset, amount, chain id, settlement contract, valid-until and nonce — must equal the ticket and
   quote the application holds.
5. **Freshness.** The report timestamp within the configured window, not dated in the future, and
   the quote not yet expired.
6. **Decision.** `eligible` true, at `policyProofLevel` = `CRE_ENFORCED` (2).
7. **Replay.** The `executionId` has not been consumed before.

The header offsets, the report hash and the quorum rule are taken from the CRE SDK's own report
parser (`@chainlink/cre-sdk`, `sdk/report.js`), not invented here.

### Delivery

```
POST /v2/placements/{placementId}/authorization
{ "rawReport": "0x…", "reportContext": "0x…", "signatures": ["0x…", "0x…"] }
```

Deliberately unauthenticated: the DON signatures *are* the authentication, and nothing is written
unless the report passes every check above. A caller who can produce a valid report for the deployed
workflow is delivering the decision the application was waiting for; a caller who cannot changes
nothing.

The binding a report is compared against is built by `expectedBindingFor` from the stored placement,
never from the request body — a report that gets to choose what it is compared against proves
nothing. On success the stored `cre_authorization` is replaced with `CRE_ENFORCED` plus the report's
execution id, workflow id, DON id and signer count. On any refusal the stored authorization is left
exactly as it was, and the response carries the reason code and `settlementAllowed: false`.

Replay protection is the `v2_cre_reports` table, keyed on the DON execution id. The claim is passed
into the verifier as its `seen` predicate, which runs last — so an execution id is consumed only by
a report that would otherwise have been accepted, and the claim itself is one atomic
`INSERT … ON CONFLICT DO NOTHING` rather than a read-then-write two concurrent submissions could
both win.

### Four states, never collapsed

| State | Meaning |
| --- | --- |
| `CRE_SIMULATED` | CLI simulator. Correct logic, unauthenticated source. The current product. |
| `CRE_ENFORCED` | Deployed workflow, authenticated report, all bindings verified. Not reachable yet. |
| `CRE_UNAVAILABLE` | No live path configured, or the provider could not be reached. |
| `CRE_INVALID` | A report arrived and failed authentication, binding, freshness or replay. |

`CRE_UNAVAILABLE` and `CRE_INVALID` are refusals, not decisions. Collapsing "the provider is down"
into "declined" would make an outage look like a policy judgement; collapsing either into "approved"
is the failure the whole module exists to prevent. `settleSignedPlacement` rejects both with
`PLACEMENT_NOT_AUTHORIZED` before any provider or wallet is touched.

## Reaching CRE_ENFORCED

Three independent things must happen. None can occur by accident, and no two of them are enough.

1. **Chainlink enables deployment access** for the organization, and the workflow is deployed. This
   is the blocked prerequisite above.
2. **The workflow's proof-level guard is relaxed.** `cre/placement-authorization/workflow.ts`
   currently refuses any ticket whose `policyProofLevel` is not `CRE_SIMULATED`, so the deployed
   workflow cannot emit an enforced report until that guard is deliberately changed.
3. **The deployment identity is configured**, in full:

   ```
   CRE_WORKFLOW_OWNER      # deployer address
   CRE_WORKFLOW_NAME       # at most 10 bytes, as encoded in the report header
   CRE_WORKFLOW_ID         # bytes32, from the deployment
   CRE_DON_ID              # assigned DON
   CRE_DON_F               # fault tolerance; quorum is f + 1
   CRE_DON_SIGNERS         # comma-separated node signer addresses
   CRE_REPORT_MAX_AGE_SECONDS  # optional, default 300
   ```

   A partial configuration is treated as no configuration. `CRE_DON_F` in particular must be present
   and numeric: absent, it would parse as `0` and silently reduce the quorum to a single signature.

`GET /v2/status` reports `creAuthorization.liveWorkflow.configured` and `deployAccess` so the live
boundary is inspectable without reading code.

## What remains unverified

The consumer half is implemented and tested against genuine reports: headers assembled at the SDK's
byte offsets, real ABI-encoded bodies, and real ECDSA signatures from real keys, covering the
accepting path and every refusal (unknown workflow, sub-quorum, duplicate signer, outside signer,
post-signature tampering, each of the sixteen bindings individually, stale, future-dated, expired,
replayed, ineligible, wrong proof level, malformed and undecodable).

What those tests cannot prove is that a deployed DON emits exactly these bytes, because no
deployment exists to compare against. The first live report must therefore be checked against this
implementation before the level is changed — in particular the signature preimage and the
`reportContext` layout, which are the two places a scheme mismatch would surface.

## Reproduce

```bash
cre whoami --env ../.env            # from cre/; confirms deploy access
npm run cre:test                    # workflow logic
npm run cre:simulate                # eligible case
npm run cre:simulate:ineligible     # over-bid rejection
npm --prefix backend test           # includes the report boundary and settlement gate
```

No raw prompt, private targeting rule, maximum bid, or commitment salt appears in any report field,
log line, API response or file in this repository. A test asserts that every refusal reason is drawn
from a closed set of fixed strings and discloses none of the above.
