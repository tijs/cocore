# NanoMDM on Railway. The upstream image is distroless (no shell), so we bake the
# step-ca root cert as the MDM client-identity CA and pass a fixed config in the
# ENTRYPOINT exec form. Build context must contain `ca.pem` (step-ca's roots.pem)
# and the `-api` key is injected at build time (see infra/mdm/README.md). MUST
# listen on [::] (Railway proxies over IPv6) and the domain target port MUST be
# set to 9000 explicitly (the CLI --port flag does not set it).
FROM ghcr.io/micromdm/nanomdm:latest
COPY ca.pem /app/ca.pem
ENTRYPOINT ["/app/nanomdm", "-ca", "/app/ca.pem", "-api", "REPLACE_WITH_API_KEY", "-listen", "[::]:9000", "-debug"]
