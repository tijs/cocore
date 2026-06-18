const IV_BYTES = 12;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): Uint8Array {
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (encoded.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesKey(storageKeyBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(storageKeyBase64Url);
  if (raw.byteLength !== 32) {
    throw new Error("invalid chat storage key length");
  }
  const keyBytes = new Uint8Array(raw);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptChatPayload(
  plaintext: string,
  storageKeyBase64Url: string,
): Promise<string> {
  const key = await importAesKey(storageKeyBase64Url);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return base64UrlEncode(combined);
}

export async function decryptChatPayload(
  blob: string,
  storageKeyBase64Url: string,
): Promise<string | null> {
  try {
    const combined = base64UrlDecode(blob);
    if (combined.byteLength <= IV_BYTES) return null;
    const iv = combined.slice(0, IV_BYTES);
    const data = combined.slice(IV_BYTES);
    const key = await importAesKey(storageKeyBase64Url);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
