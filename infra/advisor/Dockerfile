# Per-workspace Dockerfile for the advisor. Built from the repo root
# (Railway: RAILWAY_DOCKERFILE_PATH=infra/advisor/Dockerfile). Mirrors
# infra/Dockerfile.node but pins the workspace + start command at the
# Dockerfile level instead of relying on Railway to round-trip the
# WORKSPACE build arg.

FROM node:22-bookworm-slim AS builder
ARG AUBE_VERSION=1.9.1
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
       amd64) AUBE_TRIPLE=x86_64-unknown-linux-gnu ;; \
       arm64) AUBE_TRIPLE=aarch64-unknown-linux-gnu ;; \
       *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/endevco/aube/releases/download/v${AUBE_VERSION}/aube-v${AUBE_VERSION}-${AUBE_TRIPLE}.tar.gz" \
     | tar xz -C /usr/local/bin \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# `.npmrc` carries `enableGlobalVirtualStore=false`. Without it in the build
# context, aube's global-virtual-store auto-detection re-resolves `vite`
# (which it flags as GVS-incompatible) per-project, and that re-resolution
# makes `--frozen-lockfile` reject the recorded `overrides: vite` as
# out-of-date. Copy it so the container installs deterministically.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY infra ./infra
COPY lexicons ./lexicons
RUN aube install --frozen-lockfile -P

FROM node:22-bookworm-slim AS run
WORKDIR /repo
COPY --from=builder /usr/local/bin/aube /usr/local/bin/aube
COPY --from=builder /repo /repo
ENV NODE_ENV=production
WORKDIR /repo/infra/advisor
EXPOSE 8082
# Invoke node directly so we don't depend on aube's run-script
# resolution. The `start` script in package.json does the same thing.
CMD ["node", "--experimental-strip-types", "src/main.ts"]
