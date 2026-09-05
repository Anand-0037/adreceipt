# Confidential workflows

Two Chainlink CRE Confidential Workflows back the Disclosed registry. Both follow
the same shape: assemble public inputs outside the enclave, do the sensitive step
inside a confidential TEE handler, emit only a redacted result, and deliver it to
`CREAttestationReceiver.onReport` on Sepolia.

## The enclave boundary

`src/boundary.ts` states it as types, so it can be reviewed on its own:

| Handler | Held inside | Emitted |
| --- | --- | --- |
| Domain verification | raw DNS TXT answers from every resolver | `verified: bool` |
| Tier computation | on-chain spend, **private off-chain spend**, their sum | `tier: 0-3` |

`assertNoSecrets()` fails loudly if a field whose name looks sensitive ever ends
up on an outbound payload — cheap insurance against a refactor quietly widening
the boundary.

## Why the tier handler is genuinely confidential

Escrow deposits are public: anyone can call `depositedSince` and recompute a
band. An enclave that reads only the escrow would protect nothing.

So the handler sums the public on-chain figure with a **private off-chain
figure** — invoiced placements, insertion orders, fiat rails — which never
touches the chain and is exactly the commercially sensitive number an advertiser
would refuse to publish. Only the band they combine to leaves the enclave, and
the total cannot be reconstructed from chain state.

`npm run cre:simulate` demonstrates it: two cases with identical public state and
different private figures resolve to different bands.

## Structure

```
src/boundary.ts    the enclave contract, as types
src/handlers.ts    both handlers, pure functions over injected dependencies
src/adapters.ts    Node and fixture implementations of those dependencies
src/report.ts      report encoding (verified byte-identical to the contract)
src/workflow.ts    orchestration, with the handler boundary marked
src/simulate.ts    deterministic run showing what was held vs emitted
```

Handlers take their dependencies by injection because the CRE SDK supplies its
own fetch primitives inside the TEE. The same logic then runs unchanged in Node,
in the CRE simulator, and in the enclave — only `adapters.ts` changes.

## What is deliberately not written here

The CRE SDK registration itself. Registering a confidential handler, provisioning
secrets into the enclave, and the exact Forwarder metadata layout are all
specific to the current CRE release, and guessing them would produce code that
looks finished and does not run.

What has to be filled in:

1. Declare the workflow and **register the confidential TEE handler**. Track
   requirement: the workflow must register and use one.
2. Point the confidential step at `domainHandler` / `tierHandler`, substituting
   CRE's fetch primitive for `adapters.ts`.
3. Return the encoded report from `report.ts` as the workflow's output.
4. Deploy, then grant `FORWARDER_ROLE` on the receiver to the Forwarder address.

Everything either side of that is done and tested.

## Verified so far

- Local report encoding is **byte-identical** to `encodeDomainReport` /
  `encodeTierReport` on the deployed receiver, checked against Sepolia for both
  domain verdicts and all three tiers.
- Both handlers emit only their public projection; the simulation prints held
  vs emitted side by side and greps the report for the sensitive values.
- Two resolvers must agree before a positive domain verdict. One reachable
  resolver yields `false`, and the caller must not attest that — an unanswered
  lookup is not evidence the record is absent.

## Deployment

```
CREAttestationReceiver  0x5D31343761b7d2f68cFdd014dA1767D86FA26d97   (Sepolia)
report kinds            1 = domain verification, 2 = tier attestation
```

Until a Forwarder exists, the same reports go through `submitDomainVerification`
and `submitTierAttestation` under `SIMULATOR_ROLE`. Simulation output is
explicitly acceptable track evidence, so that path is not a workaround — it is
the documented fallback.

## Running

```bash
npm run cre:simulate
```
