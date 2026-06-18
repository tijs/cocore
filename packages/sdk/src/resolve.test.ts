import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { ResolveError, parseAtUri, resolvePdsEndpoint, resolveRecordOverPds } from "./resolve.ts";

interface MockResponse {
  status: number;
  body: object | string;
  ok?: boolean;
}

function fakeFetch(handlers: Record<string, () => MockResponse>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request): Promise<Response> => {
    const url = input.toString();
    calls.push(url);
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    const r = handler();
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("parseAtUri", () => {
  it("parses a well-formed at-uri", () => {
    const r = parseAtUri("at://did:plc:abc/dev.cocore.compute.receipt/3kfgl");
    assert.deepEqual(r, {
      did: "did:plc:abc",
      collection: "dev.cocore.compute.receipt",
      rkey: "3kfgl",
    });
  });

  it("rejects non-at:// schemes", () => {
    assert.throws(() => parseAtUri("https://x.example/y/z"), ResolveError);
  });

  it("rejects missing collection or rkey", () => {
    assert.throws(() => parseAtUri("at://did:plc:abc"), ResolveError);
    assert.throws(() => parseAtUri("at://did:plc:abc/dev.cocore.compute.receipt"), ResolveError);
  });

  it("rejects an empty DID segment", () => {
    assert.throws(() => parseAtUri("at:///col/rkey"), ResolveError);
  });

  it("rejects a non-DID repo segment", () => {
    assert.throws(
      () => parseAtUri("at://username.bsky.social/dev.cocore.compute.receipt/abc"),
      ResolveError,
    );
  });
});

describe("resolvePdsEndpoint (did:plc)", () => {
  it("returns the AtprotoPersonalDataServer endpoint", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabc": () => ({
        status: 200,
        body: {
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://shiitake.us-east.host.bsky.network",
            },
          ],
        },
      }),
    });
    const r = await resolvePdsEndpoint("did:plc:abc", fetch);
    assert.equal(r, "https://shiitake.us-east.host.bsky.network");
  });

  it("returns null when the doc has no AtprotoPDS service entry", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Anope": () => ({
        status: 200,
        body: { service: [] },
      }),
    });
    const r = await resolvePdsEndpoint("did:plc:nope", fetch);
    assert.equal(r, null);
  });

  it("returns null on 404 (DID not found)", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabsent": () => ({
        status: 404,
        body: { error: "NotFound" },
      }),
    });
    const r = await resolvePdsEndpoint("did:plc:absent", fetch);
    assert.equal(r, null);
  });

  it("throws ResolveError on non-404 plc.directory failure", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aoops": () => ({
        status: 500,
        body: { error: "Internal" },
      }),
    });
    await assert.rejects(() => resolvePdsEndpoint("did:plc:oops", fetch), ResolveError);
  });
});

describe("resolvePdsEndpoint (did:web)", () => {
  it("hits /.well-known/did.json on a host-only did:web", async () => {
    const { fetch, calls } = fakeFetch({
      "https://example.com/.well-known/did.json": () => ({
        status: 200,
        body: {
          service: [
            {
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example.com",
            },
          ],
        },
      }),
    });
    const r = await resolvePdsEndpoint("did:web:example.com", fetch);
    assert.equal(r, "https://pds.example.com");
    assert.equal(calls.length, 1);
  });

  it("hits /<path>/did.json for path-form did:webs", async () => {
    const { fetch } = fakeFetch({
      "https://console.cocore.dev/exchange/did.json": () => ({
        status: 200,
        body: {
          service: [
            {
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://exchange-pds.cocore.dev",
            },
          ],
        },
      }),
    });
    const r = await resolvePdsEndpoint("did:web:console.cocore.dev:exchange", fetch);
    assert.equal(r, "https://exchange-pds.cocore.dev");
  });

  it("throws ResolveError on unsupported DID method", async () => {
    const { fetch } = fakeFetch({});
    await assert.rejects(() => resolvePdsEndpoint("did:key:zSomething", fetch), ResolveError);
  });
});

describe("resolveRecordOverPds", () => {
  const RECEIPT_URI = "at://did:plc:abc/dev.cocore.compute.receipt/3kfgl";

  it("hits PLC + getRecord and packs into IndexedRecord", async () => {
    const { fetch, calls } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabc": () => ({
        status: 200,
        body: {
          service: [
            {
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example.com",
            },
          ],
        },
      }),
      "https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=dev.cocore.compute.receipt&rkey=3kfgl":
        () => ({
          status: 200,
          body: {
            uri: RECEIPT_URI,
            cid: "bafyreigh2",
            value: { model: "m", price: { amount: 50, currency: "USD" } },
          },
        }),
    });
    const r = await resolveRecordOverPds(RECEIPT_URI, { fetchImpl: fetch });
    assert.ok(r);
    assert.equal(r?.uri, RECEIPT_URI);
    assert.equal(r?.cid, "bafyreigh2");
    assert.equal(r?.collection, "dev.cocore.compute.receipt");
    assert.equal(r?.repo, "did:plc:abc");
    assert.equal(r?.rkey, "3kfgl");
    assert.deepEqual(r?.body, { model: "m", price: { amount: 50, currency: "USD" } });
    assert.equal(calls.length, 2);
  });

  it("returns null when the DID has no PDS service entry", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabc": () => ({
        status: 200,
        body: { service: [] },
      }),
    });
    const r = await resolveRecordOverPds(RECEIPT_URI, { fetchImpl: fetch });
    assert.equal(r, null);
  });

  it("returns null when getRecord returns 404", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabc": () => ({
        status: 200,
        body: {
          service: [
            {
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example.com",
            },
          ],
        },
      }),
      "https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=dev.cocore.compute.receipt&rkey=3kfgl":
        () => ({ status: 404, body: { error: "RecordNotFound" } }),
    });
    const r = await resolveRecordOverPds(RECEIPT_URI, { fetchImpl: fetch });
    assert.equal(r, null);
  });

  it("uses an explicit pdsEndpoint override and skips DID resolution", async () => {
    const { fetch, calls } = fakeFetch({
      "https://my-pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=dev.cocore.compute.receipt&rkey=3kfgl":
        () => ({
          status: 200,
          body: { uri: RECEIPT_URI, cid: "c", value: { ok: true } },
        }),
    });
    const r = await resolveRecordOverPds(RECEIPT_URI, {
      fetchImpl: fetch,
      pdsEndpoint: "https://my-pds.example.com/",
    });
    assert.ok(r);
    assert.equal(calls.length, 1, "no PLC round-trip when pdsEndpoint is supplied");
  });

  it("throws ResolveError when getRecord returns a non-404 error", async () => {
    const { fetch } = fakeFetch({
      "https://plc.directory/did%3Aplc%3Aabc": () => ({
        status: 200,
        body: {
          service: [
            {
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example.com",
            },
          ],
        },
      }),
      "https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=dev.cocore.compute.receipt&rkey=3kfgl":
        () => ({ status: 500, body: { error: "Internal" } }),
    });
    await assert.rejects(
      () => resolveRecordOverPds(RECEIPT_URI, { fetchImpl: fetch }),
      ResolveError,
    );
  });
});
