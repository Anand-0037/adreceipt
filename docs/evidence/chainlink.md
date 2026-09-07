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
