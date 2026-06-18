import assert from "node:assert/strict";
import { test } from "vitest";

import { decryptChatPayload, encryptChatPayload } from "@/components/chat/chat-crypto.ts";
import { deriveChatStorageKey } from "@/lib/chat-storage-key.server.ts";

test("encryptChatPayload round-trips JSON", async () => {
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "test-secret";
  const key = deriveChatStorageKey("did:plc:alice");
  const plaintext = JSON.stringify([{ id: "s1", title: "hello", messages: [] }]);
  const blob = await encryptChatPayload(plaintext, key);
  assert.notEqual(blob, plaintext);
  const restored = await decryptChatPayload(blob, key);
  assert.equal(restored, plaintext);
});

test("decryptChatPayload rejects the wrong user's key", async () => {
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "test-secret";
  const aliceKey = deriveChatStorageKey("did:plc:alice");
  const bobKey = deriveChatStorageKey("did:plc:bob");
  const blob = await encryptChatPayload('{"sessions":[]}', aliceKey);
  assert.equal(await decryptChatPayload(blob, bobKey), null);
});
