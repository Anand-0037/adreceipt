# AdReceipt CRE placement authorization

AdReceipt uses a Chainlink Runtime Environment Confidential Workflow to decide
whether a signed recommendation quote satisfies a private campaign policy before
the application asks Privy to settle it.

The `placement-authorization` handler runs in a Nitro TEE. It reads a private
campaign policy from the Vault DON, validates every public ticket, quote and
subject binding, then emits only the decision, a salted policy commitment, and
the fields needed to bind that decision to one placement.

## PlacementTicketV2

V1 could check that a quote was internally consistent and priced within a
private ceiling. It could not check what the placement was *for*: the campaign
revision, the context the recommendation would appear in, and the policy that
authorised it all sat outside the signed structure, so any of them could change
after authorisation without invalidating anything.

`PlacementTicketV2` folds all of them into one commitment and reuses
`SubjectV1.placementId` to carry it:

```
PlacementTicketV2 -> ticketCommitment -> SubjectV1.placementId
  -> SubjectV1.subjectHash -> PlacementQuoteV1.subjectHash
  -> EIP-712 quote digest (the receiptId)
```

`placementId` was already a `bytes32`, so no contract ABI changes and nothing is
redeployed. Every V1 verifier keeps working; a holder of the ticket can now
additionally re-derive the `placementId` from it.

Two things stay private and are only ever published as commitments:

- **The sanitized context.** Committed as `SanitizedContextV2` over a closed
  vocabulary — topic, intent, locale, surface — plus a fresh salt held in the
  policy secret. The vocabulary is a fixed enumeration rather than free text so
  that a raw user query cannot be committed to, by accident or by a caller
  taking the shortest path. No raw-query hash exists anywhere in the pipeline.
- **The campaign policy.** The published `policyCommitment` is
  `keccak256(abi.encode(keccak256(policyJson), commitmentSalt))`. The salt
  matters: the allowlist is short, the bid ceiling is a round number and every
  address in the policy is already public, so an unsalted hash of that JSON
  would be reversible by anyone willing to guess it.

The ticket commits to the `policyCommitment`, so the enclave can confirm the
placement was authorised against the exact policy it holds — and decline it if
the advertiser has since revised the campaign, which `campaignRevisionHash`
pins separately.

### One encoding, two runtimes

The encoding exists twice: `frontend/lib/ticket.ts` for the application
(ethers) and `cre/placement-authorization/ticket.ts` for the handler (viem,
because the workflow cannot pull in ethers). Two implementations of one hash
drift unless something breaks when they do, so
`shared/vectors/placement-ticket-v2.json` is committed and asserted by both
suites. Regenerate it with:

```bash
npx hardhat run scripts/ticket-vectors.ts
npx hardhat run scripts/cre-placement-fixture.ts
```

The second script owns the simulation fixtures as a set — the policy JSON, its
commitment, the context commitment, and both configs — because the commitment is
a hash over the exact JSON string, which makes key order load-bearing and makes
hand-editing any one of the four a silent binding failure.

## Preflight, and why it fails closed

`frontend/lib/preflight.ts` turns an eligible decision into a reviewable
settlement packet: decoded subject and quote, publisher signature, every hash,
expiry, nonce, payer, recipient, asset, amount, chain, contract, the exact
allowance required, and the expected receipt id. It opens no RPC connection and
broadcasts nothing, and the same inputs always produce the same bytes, so two
reviewers can diff their packets.

It is also the single place where an authorisation is allowed to become a
settlement request, which is why every check there raises rather than warns. An
ineligible decision, a decision about a different ticket, quote, campaign
revision, context or policy, a subject whose `placementId` is not the ticket
commitment, a signature from anyone but the named publisher, and an expired
quote all refuse to produce a packet. There is no path from "the enclave said
no" to a prepared transaction.

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
the same private policy but raises the amount by one atomic USDC unit, so it
must return `eligible=false`. Because the amount is part of the ticket, the
second fixture necessarily carries a different ticket commitment, subject hash
and quote digest — which is the binding working as intended, not a fixture
inconsistency.

Never simulate with a real campaign policy. Chainlink's simulator executes
locally and is not a TEE.

## What is proven

- Unit tests cover one eligible path and the ineligible ones: disallowed topic,
  disallowed intent, over-bid, superseded campaign revision, wrong product,
  unbound context, a ticket bound to a different policy, self-dealing payer,
  and expiry. Structural failures — a `placementId` that is not the ticket
  commitment, a subject or quote that disagrees with its ticket — throw and emit
  no report at all, because a malformed input is not a campaign's refusal.
- Leakage tests assert that neither salt, the bid ceiling, the allowlist nor the
  topic vocabulary appears in the returned string, the logs, or the decoded
  report payload.
- The workflow recomputes the ticket commitment, `subjectHash` and the EIP-712
  `quoteId` before reading the private policy, so a caller cannot hand the
  enclave one placement and the chain another.
- A successful local WASM build proves build compatibility only.
- A successful authenticated CLI run proves `CRE_SIMULATED` only.
- `CRE_ENFORCED` requires private-beta enrollment, workflow deployment, a live
  CRE Forwarder, and contract authentication of the expected workflow identity.

Because nothing here can produce a live DON attestation, the claim is enforced
in code rather than left to discipline: `policyProofLevel` is part of the ticket,
the handler refuses any ticket claiming `CRE_ENFORCED`, and the preflight builder
refuses to prepare a settlement from one. Removing either check is the only way
to emit that claim, which keeps it visible in review. A backend signature, a
fabricated DON report, a copied simulation result or an admin override are not
substitutes for enforcement.

Until that live path exists, the settlement contract must not claim that CRE
authorization is enforced onchain.

The old `domain-verification` directory is retained as historical experimental
code. It is outside the accepted AdReceipt V1 path and must not be used in the
Chainlink integration claim.
