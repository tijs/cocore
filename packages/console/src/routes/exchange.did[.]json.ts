// GET /exchange/did.json
//
// did:web DID document for the cocore exchange.
//
// The dispatch flow stamps `acceptedExchanges` and `exchange` fields
// on every job + paymentAuthorization with the exchange's DID. For
// downstream verifiers to resolve that DID, the document has to be
// reachable at the path the spec mandates: did:web:<host>:exchange
// resolves to https://<host>/exchange/did.json.
//
// We construct the document's `id` from CONSOLE_PUBLIC_URL so the
// DID literally matches whatever CONSOLE_PUBLIC_URL is set to. In
// production that's `did:web:console.cocore.dev:exchange`; in local
// dev it'd be the development host. The id MUST match the URL the
// resolver hit, per the did:web spec.
//
// When COCORE_EXCHANGE_PUBLIC_KEY_JWK is set in the environment we
// emit a `verificationMethod` block so settlement signatures are
// verifiable straight from the did doc. The matching private half
// lives only on the services container (COCORE_EXCHANGE_PRIVATE_KEY_JWK)
// — the console never sees it.

import { createFileRoute } from "@tanstack/react-router";

function exchangeDidFor(request: Request): string {
  const explicit = process.env["CONSOLE_PUBLIC_URL"];
  const url = explicit ?? request.url;
  const host = new URL(url).host;
  // host with `:port` becomes `%3Aport` per did:web spec.
  const encoded = host.replace(":", "%3A");
  return `did:web:${encoded}:exchange`;
}

interface PublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  alg?: string;
  kid?: string;
}

function readPublicJwk(): PublicJwk | null {
  const raw = process.env["COCORE_EXCHANGE_PUBLIC_KEY_JWK"];
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PublicJwk;
    if (typeof v.kty === "string" && typeof v.x === "string" && typeof v.y === "string") {
      return v;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const Route = createFileRoute("/exchange/did.json")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const did = exchangeDidFor(request);
        const baseUrl =
          process.env["CONSOLE_PUBLIC_URL"]?.replace(/\/$/, "") ?? new URL(request.url).origin;
        const publicJwk = readPublicJwk();

        const doc: Record<string, unknown> = {
          "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/jws-2020/v1",
          ],
          id: did,
          service: [
            {
              id: "#cocore_exchange",
              type: "CocoreExchange",
              serviceEndpoint: `${baseUrl}/api/xrpc/dev.cocore.exchange`,
            },
          ],
        };
        if (publicJwk) {
          doc.verificationMethod = [
            {
              id: `${did}#exchange-signing-key`,
              type: "JsonWebKey2020",
              controller: did,
              publicKeyJwk: publicJwk,
            },
          ];
          doc.assertionMethod = [`${did}#exchange-signing-key`];
        }
        return new Response(JSON.stringify(doc), {
          status: 200,
          headers: {
            "content-type": "application/did+json",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
