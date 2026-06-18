// Server functions backing the /u/$identifier profile page.
//
// Two layers of resolution:
//
//   1. Identifier → DID. The path param can be a DID (passes
//      through), a Bluesky handle (resolved via the public bsky
//      appview's getProfile), or — eventually — a cocore-only
//      handle. v1 supports the first two; cocore handles can land
//      when we surface them in the directory.
//
//   2. DID → profile payload. One AppView round-trip
//      (`getProfile`) returns everything the page renders: account
//      fields, machines, activity counts, incoming-friends count.
//
// Both steps are server functions so the route's loader can
// preload the data before the page renders.

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { z } from "zod";

import {
  type AppviewIncomingFriend,
  type AppviewProfilePagePayload,
  appviewGetProfileEffect,
  appviewListIncomingFriendsEffect,
} from "@/integrations/appview/appview.server.ts";
import { appviewProfileFieldsForDid, lookupActor } from "@/lib/friends.server.ts";

const identifierSchema = z.object({
  /** A handle (alice.bsky.social) or DID. The server function
   *  normalizes both into a DID before fetching the profile. */
  identifier: z.string().min(1).max(256),
});

const didOnlySchema = z.object({
  did: z.string().min(1).max(256),
});

type ProfilePagePayload = AppviewProfilePagePayload;
export type IncomingFriend = AppviewIncomingFriend & {
  avatarUrl: string | null;
  displayName: string | null;
  displayHandle: string | null;
};

interface ResolvedIdentifier {
  /** Always a DID — handles are resolved to one. */
  did: string;
  /** What the user typed, with a leading `@` stripped. */
  rawInput: string;
  /** Best-effort handle from the bsky appview at resolution time.
   *  May be null when the input was a DID with no current handle. */
  handle: string | null;
}

interface ProfilePageBundle {
  resolved: ResolvedIdentifier;
  /** Null when the DID is real but has no cocore footprint
   *  (signed in via OAuth elsewhere but never published any record). */
  profile: ProfilePagePayload | null;
}

/** Resolve an identifier (handle or DID) into a DID. Returns null on
 *  resolution failure. */
async function resolveIdentifier(input: string): Promise<ResolvedIdentifier | null> {
  const cleaned = input.trim().replace(/^@/, "");
  if (cleaned.length === 0) return null;
  if (cleaned.startsWith("did:")) {
    // DID input — try to look up the current handle for display, but
    // don't fail the resolution if PLC is unreachable.
    const lookup = await lookupActor(cleaned);
    return {
      did: cleaned,
      rawInput: input,
      handle: lookup?.handle ?? null,
    };
  }
  // Handle input — resolve to DID via bsky public appview.
  const lookup = await lookupActor(cleaned);
  if (!lookup) return null;
  return {
    did: lookup.did,
    rawInput: input,
    handle: lookup.handle,
  };
}

const profilePageServerFn = createServerFn({ method: "GET" })
  .inputValidator(identifierSchema)
  .handler(async ({ data }): Promise<ProfilePageBundle | null> => {
    const resolved = await resolveIdentifier(data.identifier);
    if (!resolved) return null;
    const profile = await Effect.runPromise(appviewGetProfileEffect(resolved.did));
    return { resolved, profile };
  });

const incomingFriendsServerFn = createServerFn({ method: "GET" })
  .inputValidator(didOnlySchema)
  .handler(async ({ data }): Promise<IncomingFriend[]> => {
    const res = await Effect.runPromise(
      appviewListIncomingFriendsEffect({ did: data.did, limit: 100 }),
    );
    return await Promise.all(
      res.friends.map(async (f): Promise<IncomingFriend> => {
        const lookup = await lookupActor(f.frienderHandle ?? f.friender);
        const { avatarUrl, displayName, displayHandle } = appviewProfileFieldsForDid(
          lookup,
          f.friender,
          f.frienderHandle,
        );
        return { ...f, avatarUrl, displayName, displayHandle };
      }),
    );
  });

export function profilePageQueryOptions(identifier: string) {
  return queryOptions({
    queryKey: ["profile", identifier] as const,
    queryFn: () => profilePageServerFn({ data: { identifier } }),
    // Profiles change slowly; cache aggressively. Friend mutations
    // on the page invalidate this key directly.
    staleTime: 30_000,
  });
}

export function incomingFriendsQueryOptions(did: string) {
  return queryOptions({
    queryKey: ["incoming-friends", did] as const,
    queryFn: () => incomingFriendsServerFn({ data: { did } }),
    staleTime: 30_000,
  });
}
