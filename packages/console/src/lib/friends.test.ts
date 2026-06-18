// Unit tests for the pure helpers in friends.server.ts.
//
// The PDS-touching paths (listMyFriends, addFriend, removeFriend)
// flow through `session.handle()`, which is deeply integrated with
// @atcute's OAuthSession class — mocking it for a unit test would
// require more scaffolding than the test would catch. Those paths
// are exercised by the e2e flow that runs against a real PDS.
//
// What we cover here:
//   * rowToFriend — input parsing across malformed shapes
//   * parseRkeyFromUri — rkey extraction
//   * appviewProfileFieldsForDid — DID match gating for appview fields
//   * lookupActor — input normalization + bsky-appview response
//     shape parsing, with `fetch` mocked at the module level.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

import {
  appviewProfileFieldsForDid,
  lookupActor,
  parseRkeyFromUri,
  rowToFriend,
} from "./friends.server.ts";

describe("parseRkeyFromUri", () => {
  test("extracts the rkey segment from an at:// record URI", () => {
    assert.equal(
      parseRkeyFromUri("at://did:plc:foo/dev.cocore.account.friend/3lvx2h4y6c2"),
      "3lvx2h4y6c2",
    );
  });

  test("returns the bare rkey when given a leading slash + rkey", () => {
    assert.equal(parseRkeyFromUri("/3lvx2h4y6c2"), "3lvx2h4y6c2");
  });

  test("returns null for a string with no slash", () => {
    assert.equal(parseRkeyFromUri("just-a-string"), null);
  });
});

describe("rowToFriend", () => {
  test("parses a complete record", () => {
    const out = rowToFriend("at://did:plc:me/dev.cocore.account.friend/abc123", {
      subject: "did:plc:friend",
      subjectHandle: "alice.bsky.social",
      note: "met at strange loop",
      createdAt: "2026-05-13T10:00:00Z",
    });
    assert.deepEqual(out, {
      rkey: "abc123",
      subject: "did:plc:friend",
      subjectHandle: "alice.bsky.social",
      note: "met at strange loop",
      createdAt: "2026-05-13T10:00:00Z",
    });
  });

  test("missing optional fields land as null (not undefined)", () => {
    const out = rowToFriend("at://did:plc:me/dev.cocore.account.friend/abc", {
      subject: "did:plc:friend",
      createdAt: "2026-05-13T10:00:00Z",
    });
    assert.notEqual(out, null);
    assert.equal(out!.subjectHandle, null);
    assert.equal(out!.note, null);
  });

  test("missing subject (required field) rejects the row", () => {
    const out = rowToFriend("at://did:plc:me/dev.cocore.account.friend/abc", {
      subject: null,
      createdAt: "2026-05-13T10:00:00Z",
    } as unknown as Parameters<typeof rowToFriend>[1]);
    assert.equal(out, null);
  });

  test("empty subject string rejects the row", () => {
    const out = rowToFriend("at://did:plc:me/dev.cocore.account.friend/abc", {
      subject: "",
      createdAt: "2026-05-13T10:00:00Z",
    });
    assert.equal(out, null);
  });

  test("non-string fields are coerced to null rather than crashing", () => {
    const out = rowToFriend("at://did:plc:me/dev.cocore.account.friend/abc", {
      subject: "did:plc:friend",
      subjectHandle: 42 as unknown as string,
      note: { text: "wat" } as unknown as string,
      createdAt: "2026-05-13T10:00:00Z",
    });
    assert.notEqual(out, null);
    assert.equal(out!.subjectHandle, null);
    assert.equal(out!.note, null);
  });

  test("URI with no rkey rejects the row", () => {
    const out = rowToFriend("malformed-uri", {
      subject: "did:plc:friend",
      createdAt: "2026-05-13T10:00:00Z",
    });
    assert.equal(out, null);
  });
});

describe("appviewProfileFieldsForDid", () => {
  test("passes through lookup fields when DID matches", () => {
    const lookup = {
      did: "did:plc:alice",
      handle: "alice.bsky.social",
      displayName: "Alice",
      avatarUrl: "https://cdn.example/a.jpg",
    };
    assert.deepEqual(appviewProfileFieldsForDid(lookup, "did:plc:alice", "old.bsky.social"), {
      avatarUrl: "https://cdn.example/a.jpg",
      displayName: "Alice",
      displayHandle: "alice.bsky.social",
    });
  });

  test("falls back when resolved DID mismatches expected subject", () => {
    const lookup = {
      did: "did:plc:other",
      handle: "other.bsky.social",
      displayName: "Other",
      avatarUrl: "https://cdn.example/o.jpg",
    };
    assert.deepEqual(appviewProfileFieldsForDid(lookup, "did:plc:alice", "alice.bsky.social"), {
      avatarUrl: null,
      displayName: null,
      displayHandle: "alice.bsky.social",
    });
  });

  test("null lookup uses fallback handle only", () => {
    assert.deepEqual(appviewProfileFieldsForDid(null, "did:plc:alice", "alice.bsky.social"), {
      avatarUrl: null,
      displayName: null,
      displayHandle: "alice.bsky.social",
    });
  });
});

describe("lookupActor", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  test("returns null for empty / whitespace input without hitting the network", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    assert.equal(await lookupActor(""), null);
    assert.equal(await lookupActor("   "), null);
    assert.equal(await lookupActor("@"), null);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  test("strips a leading @ before resolving", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        did: "did:plc:alice",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://cdn.example/alice.jpg",
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await lookupActor("@alice.bsky.social");
    assert.deepEqual(out, {
      did: "did:plc:alice",
      handle: "alice.bsky.social",
      displayName: "Alice",
      avatarUrl: "https://cdn.example/alice.jpg",
    });
    // The URL we hit must carry the *cleaned* actor.
    const callUrl = String((fetchMock.mock.calls[0]![0] as URL).toString());
    assert.match(callUrl, /actor=alice\.bsky\.social/);
  });

  test("accepts a DID as input", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        did: "did:plc:bob",
        handle: "bob.example",
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await lookupActor("did:plc:bob");
    assert.notEqual(out, null);
    assert.equal(out!.did, "did:plc:bob");
    assert.equal(out!.displayName, null);
    assert.equal(out!.avatarUrl, null);
  });

  test("returns null on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    assert.equal(await lookupActor("alice.bsky.social"), null);
  });

  test("returns null on network failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    assert.equal(await lookupActor("alice.bsky.social"), null);
  });

  test("returns null when response is missing required fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ handle: "alice.bsky.social" }), // no did
    }) as unknown as typeof fetch;
    assert.equal(await lookupActor("alice.bsky.social"), null);
  });

  test("returns null when did is malformed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ did: "not-a-did", handle: "alice.bsky.social" }),
    }) as unknown as typeof fetch;
    assert.equal(await lookupActor("alice.bsky.social"), null);
  });
});
