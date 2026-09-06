# AdReceipt CRE placement authorization

AdReceipt uses a Chainlink Runtime Environment Confidential Workflow to decide
whether a signed recommendation quote satisfies a private campaign policy before
the application asks Privy to settle it.

The `placement-authorization` handler runs in a Nitro TEE. It reads a private
product allowlist and maximum bid from the Vault DON, validates every public
quote and subject binding, then emits only the decision, a salted policy
commitment, and the fields needed to bind that decision to one quote.

## Verify locally

Requirements: Bun 1.3.14 and CRE CLI 1.32.0 or newer.

```bash
npm run cre:install
npm run cre:test
npm run cre:typecheck
npm run cre:build
```

The checked-in staging configuration and
`placement-authorization/simulation.env.example` are public test fixtures. The
production config intentionally fails validation until it is generated from a
real publisher quote and deployed settlement address.

To run the CLI simulator, copy only the public fixture policy into the ignored
root `.env`, add a valid `CRE_API_KEY` or log in with `cre login`, then run:

```bash
npm run cre:simulate
npm run cre:simulate:ineligible
```

The first fixture is eligible at the private 1 USDC ceiling. The second keeps
the same subject and private policy but raises the quote by one atomic USDC unit,
so it must return `eligible=false`.

Never simulate with a real campaign policy. Chainlink's simulator executes
locally and is not a TEE.

## What is proven

- Unit tests cover eligible, wrong-target, over-bid, expired, malformed-policy,
  input-range, context-binding, and leakage paths.
- The workflow recomputes `subjectHash` and the EIP-712 `quoteId` before reading
  the private policy. The staging vectors were independently cross-checked with
  `ethers`, matching the semantics used by `PlacementSettlementV1`.
- A successful local WASM build proves build compatibility only.
- A successful authenticated CLI run proves `CRE_SIMULATED` only.
- `CRE_ENFORCED` requires private-beta enrollment, workflow deployment, a live
  CRE Forwarder, and contract authentication of the expected workflow identity.

Until that live path exists, the settlement contract must not claim that CRE
authorization is enforced onchain.

The old `domain-verification` directory is retained as historical experimental
code. It is outside the accepted AdReceipt V1 path and must not be used in the
Chainlink integration claim.
