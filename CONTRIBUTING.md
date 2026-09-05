# Contributing to AdReceipt

Thanks for helping build AdReceipt. Keep changes small enough that another contributor can verify
them without needing a private explanation.

## Workflow

1. Start feature work from an issue with one owner and a testable outcome.
2. Create a short branch from the latest `main`, such as `feat/settlement-receipts`,
   `fix/quote-replay`, or `docs/receipt-model`.
3. Change only the files needed for that issue.
4. Run the relevant build, tests, and type checks.
5. Open a pull request that links the issue and states what is implemented, how it was verified,
   and what remains blocked.
6. Get one teammate review and green CI before squash-merging.

Feature implementation must not be pushed directly to `main`. Repository maintainers may land a
small documentation or configuration correction directly when it is independently reviewable,
verified, and does not change application behavior or dependencies. Do not combine unrelated
cleanup, product work, and dependency changes in one pull request.

## Local checks

For contract changes:

```bash
npm ci
npm run build
npm test
npm run typecheck
```

Subgraph and application packages may add their own documented checks. Run those checks in addition
to the root contract suite when your change touches them.

## Repository hygiene

- Never commit `.env` files, credentials, private keys, deploy keys, or raw account data.
- Do not add generated build output.
- Do not introduce nested `package-lock.json` files. The existing root lockfile should change only
  when the root dependency tree changes.
- Keep test fixtures visibly separate from deployed transactions or provider evidence.
- Describe local, testnet, deployed, indexed, and production states accurately.

## Pull request checklist

- [ ] The pull request links its issue.
- [ ] The diff contains one logical change.
- [ ] Relevant tests and builds pass.
- [ ] New failure paths have tests or a written reason why they cannot be tested yet.
- [ ] No secrets or generated artifacts are included.
- [ ] Documentation does not claim deployment or provider success without evidence.
