// Server fns + react-query options for the cocore-side account profile.
//
// Read path: lazy ensureMyProfile (idempotent — provisions from bsky
// on the first call for legacy users who pre-date the OAuth-callback
// hook in oauth-callback.server.ts).
// Write path: validated read-modify-putRecord at rkey=`self`.

import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  type CocoreProfile,
  ensureMyProfile,
  updateMyProfile,
  uploadMyAvatar,
} from "@/lib/account-profile.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

const updateInputSchema = z.object({
  // Each field uses .optional() to mean "leave alone"; pass null or
  // an empty string explicitly to clear.
  displayName: z.string().max(256).nullable().optional(),
  bio: z.string().max(2560).nullable().optional(),
  avatarUrl: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || v === "" || /^https?:\/\//.test(v), {
      message: "avatarUrl must be a http(s):// URL or empty",
    }),
});

const uploadAvatarInputSchema = z.object({
  imageDataUrl: z
    .string()
    .refine((v) => v.startsWith("data:image/"), "Must be a base64 image data URL"),
});

const getMyProfileServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }): Promise<CocoreProfile> => ensureMyProfile(context.oauthSession));

const updateMyProfileServerFn = createServerFn({ method: "POST" })
  .inputValidator(updateInputSchema)
  .middleware([authMiddleware])
  .handler(
    ({ context, data }): Promise<CocoreProfile> => updateMyProfile(context.oauthSession, data),
  );

const uploadMyAvatarServerFn = createServerFn({ method: "POST" })
  .inputValidator(uploadAvatarInputSchema)
  .middleware([authMiddleware])
  .handler(
    ({ context, data }): Promise<CocoreProfile> =>
      uploadMyAvatar(context.oauthSession, data.imageDataUrl),
  );

export const getMyProfileQueryOptions = queryOptions({
  queryKey: ["account-profile", "me"] as const,
  queryFn: getMyProfileServerFn,
  staleTime: 60_000,
});

export type UpdateMyProfileInput = z.infer<typeof updateInputSchema>;

export const updateMyProfileMutationOptions = mutationOptions({
  mutationFn: (variables: UpdateMyProfileInput) => updateMyProfileServerFn({ data: variables }),
});

export type UploadMyAvatarInput = z.infer<typeof uploadAvatarInputSchema>;

export const uploadMyAvatarMutationOptions = mutationOptions({
  mutationFn: (variables: UploadMyAvatarInput) => uploadMyAvatarServerFn({ data: variables }),
});
