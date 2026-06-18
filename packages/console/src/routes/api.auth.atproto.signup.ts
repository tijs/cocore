import { atprotoSignupServerFn } from "@/integrations/auth/api-auth.functions.ts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/api/auth/atproto/signup")({
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const result = await atprotoSignupServerFn({
      data: {
        redirect: search.redirect,
      },
    });

    throw redirect({
      href: result.authorizationUrl,
    });
  },
});
