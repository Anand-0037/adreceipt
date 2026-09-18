# Security

Report vulnerabilities privately. Do not open a public issue for an
exploitable finding.

## Contact

- GitHub: [@Anand-0037](https://github.com/Anand-0037)
- Prefer a private GitHub security advisory on this repository when
  GitHub's reporting form is available.

Include the affected file or commit, how to reproduce, and whether any
secret or production system was involved. We will acknowledge the
report and say what we changed.

## Scope

In scope:

- Build and deploy entry files (`postcss.config.*`, `next.config.*`,
  GitHub workflows, Docker/Railway/Render config)
- Settlement contracts and the backend that talks to them
- Secret handling in CI and hosted deployments

Out of scope:

- Third-party RPC, indexer, or wallet providers
- Issues that only exist on a discarded local worktree

## Build-config injection

Tooling configs that Vite, Next.js, or npm load at install/build time
must stay data, not programs. A config file that calls `eval`,
`child_process`, or downloads and runs remote code is a vulnerability.

CI runs `node scripts/check-build-config.mjs` on every push so those
patterns fail the build before `npm ci` / frontend install.

If you pulled a revision that contained such a payload, rotate
credentials that were in that environment and rebuild from current
`main`. Do not execute the poisoned revision.
