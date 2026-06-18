# Multi-stage TanStack Start build (Vite + TanStack Router). We deliberately
# keep the whole monorepo in the runtime image so aube/pnpm workspace
# symlinks (e.g. packages/console/node_modules/.bin/vite) stay resolvable.

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
RUN aube install --frozen-lockfile
RUN aube run -F @cocore/console build

FROM node:22-bookworm-slim AS run
WORKDIR /repo
COPY --from=builder /usr/local/bin/aube /usr/local/bin/aube
COPY --from=builder /repo /repo
WORKDIR /repo/packages/console
ENV NODE_ENV=production
ENV CONSOLE_PUBLIC_URL=http://localhost:3000
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "exec aube run start"]
