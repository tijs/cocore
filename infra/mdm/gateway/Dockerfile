# Publicly-trusted front door for step-ca (ACME + SCEP). See Caddyfile.
FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# The base image's CMD already runs:
#   caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
