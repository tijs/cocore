# NanoMDM Railway deploy context

This is a _template_. The real build context lives outside the repo at
`~/cocore-mdm/nanomdm-deploy/` with the secrets filled in:

- `ca.pem` — step-ca's `roots.pem` (`curl -k https://<step-ca>/roots.pem`). The MDM
  client-identity CA NanoMDM validates device certs against. EPHEMERAL: regenerate
  if step-ca re-inits.
- `Dockerfile` — replace `REPLACE_WITH_API_KEY` with the NanoMDM API key
  (`~/cocore-mdm/nanomdm-api-key.txt`).

Deploy: `railway up --service cocore-nanomdm --detach` from that dir, then set the
domain target port to 9000 (GraphQL `serviceDomainUpdate`) and upload the push cert
(`cat apns_push.pem push.key | curl -T - -u nanomdm:<key> https://<host>/v1/pushcert`).
