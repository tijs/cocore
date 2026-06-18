import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  type ApiKeyRow,
  createKey,
  deleteKey,
  listKeysForDid,
  revokeKey,
} from "@/lib/api-keys.server.ts";
import { wipeMyData } from "@/lib/wipe-my-data.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  /** Optional ISO 8601 expiry. Null/missing = never expires. */
  expiresAt: z.string().datetime().nullable().optional(),
});

const revokeKeySchema = z.object({
  id: z.string().min(1).max(200),
});

const deleteKeySchema = z.object({
  id: z.string().min(1).max(200),
});

interface MyApiKeysPayload {
  did: string;
  keys: ApiKeyRow[];
}

const listMyApiKeysServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }): MyApiKeysPayload => {
    const did = context.did;
    return { did, keys: listKeysForDid(did) };
  });

export const listMyApiKeysQueryOptions = queryOptions({
  queryKey: ["api-keys", "list"] as const,
  queryFn: listMyApiKeysServerFn,
  staleTime: 30_000,
});

export interface CreateMyApiKeyOutput {
  key: ApiKeyRow;
  /** The full plaintext key. Shown to the user exactly once; never
   *  retrievable again. */
  secret: string;
}

const createMyApiKeyServerFn = createServerFn({ method: "POST" })
  .inputValidator(createKeySchema)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<CreateMyApiKeyOutput> => {
    return createKey({
      did: context.did,
      name: data.name,
      expiresAt: data.expiresAt ?? null,
    });
  });

const revokeMyApiKeyServerFn = createServerFn({ method: "POST" })
  .inputValidator(revokeKeySchema)
  .middleware([authMiddleware])
  .handler(({ context, data }) => revokeKey({ id: data.id, did: context.did }));

const deleteMyApiKeyServerFn = createServerFn({ method: "POST" })
  .inputValidator(deleteKeySchema)
  .middleware([authMiddleware])
  .handler(({ context, data }) => {
    return deleteKey({ id: data.id, did: context.did });
  });

const wipeMyDataServerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(({ context }) => wipeMyData(context.oauthSession));

export type CreateMyApiKeyInput = z.infer<typeof createKeySchema>;
export type RevokeMyApiKeyInput = z.infer<typeof revokeKeySchema>;
export type DeleteMyApiKeyInput = z.infer<typeof deleteKeySchema>;

export const createMyApiKeyMutationOptions = mutationOptions({
  mutationFn: (variables: CreateMyApiKeyInput) => createMyApiKeyServerFn({ data: variables }),
});

export const revokeMyApiKeyMutationOptions = mutationOptions({
  mutationFn: (variables: RevokeMyApiKeyInput) => revokeMyApiKeyServerFn({ data: variables }),
});

export const deleteMyApiKeyMutationOptions = mutationOptions({
  mutationFn: (variables: DeleteMyApiKeyInput) => deleteMyApiKeyServerFn({ data: variables }),
});

export const wipeMyDataMutationOptions = mutationOptions({
  mutationFn: () => wipeMyDataServerFn(),
});
