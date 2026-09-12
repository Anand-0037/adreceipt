# AdReceipt API for Railway (or any container host).
#
# The build context is the repository root, not backend/, because the API
# resolves two things relative to it at runtime: deployments/*.json for the
# contract coordinates, and cre/ for the confidential-policy simulation it
# shells out to. Building from backend/ alone would start cleanly and then fail
# on the first placement authorization.
#
# This reproduces the Render build in render.yaml step for step - the CRE CLI
# and bun are pinned to the same versions, and the WASM workflow is compiled at
# build time so the compiler is never on the request path.

FROM node:22-bookworm-slim

# `make` is not used by anything here, but the CRE CLI refuses to simulate a
# WASM workflow - even a precompiled one - unless it can find it on PATH.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl make unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Runtime binaries ─────────────────────────────────────────────────────
# Pinned: a CRE CLI upgrade can change simulator output, which the API parses.
ARG CRE_CLI_VERSION=v1.33.0
ARG BUN_VERSION=1.3.14
RUN mkdir -p /app/runtime-bin /tmp/bun \
 && curl -fsSL "https://github.com/smartcontractkit/cre-cli/releases/download/${CRE_CLI_VERSION}/cre_linux_amd64_ldd2-35.tar.gz" \
    | tar -xz -C /app/runtime-bin \
 && mv "/app/runtime-bin/cre_${CRE_CLI_VERSION}_linux_amd64" /app/runtime-bin/cre \
 && curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip \
 && unzip -q /tmp/bun.zip -d /tmp/bun \
 && mv /tmp/bun/bun-linux-x64/bun /app/runtime-bin/bun \
 && chmod +x /app/runtime-bin/cre /app/runtime-bin/bun \
 && rm -rf /tmp/bun /tmp/bun.zip

# The CRE SDK's compiler spawns `bun` by name, so it has to be resolvable.
ENV PATH="/app/runtime-bin:${PATH}"

# ── Backend dependencies (cached until the lockfile changes) ─────────────
# The postinstall hook copies CRE binaries out of Render's .render/bin when it
# exists and does nothing otherwise, so it needs to be present but is inert here.
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/scripts ./backend/scripts
RUN npm --prefix backend ci --no-audit --no-fund

# ── CRE workflow: dependencies and the precompiled WASM ──────────────────
COPY cre ./cre
RUN cd cre/placement-authorization \
 && /app/runtime-bin/bun install --no-save \
 && mkdir -p wasm \
 && /app/runtime-bin/bun node_modules/@chainlink/cre-sdk/bin/cre-compile.ts main.ts wasm/workflow.wasm

# ── Application ──────────────────────────────────────────────────────────
COPY backend ./backend
COPY deployments ./deployments
COPY shared ./shared

ENV NODE_ENV=production \
    PORT=8787 \
    CRE_CLI_PATH=/app/runtime-bin/cre

EXPOSE 8787

# Same check Render uses. Railway reads this for its own health monitoring.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["npm", "--prefix", "backend", "start"]
