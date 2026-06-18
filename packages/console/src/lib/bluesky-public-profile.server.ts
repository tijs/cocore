import { Effect, Either } from "effect";

/**
 * Profile fields from public.api.bsky.app (stable JSON for login flows).
 */
export type BlueskyPublicProfileFields = {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

function blueskyFetchEffect(url: string): Effect.Effect<Response, unknown> {
  return Effect.async((resume) => {
    void fetch(url, {
      headers: { Accept: "application/json" },
    }).then(
      (r) => resume(Effect.succeed(r)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

function jsonFromResponseEffect(response: Response): Effect.Effect<unknown, unknown> {
  return Effect.async((resume) => {
    void response.json().then(
      (j) => resume(Effect.succeed(j)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

/** Effectful variant: never fails; failures map to `null`. */
export const fetchBlueskyPublicProfileFieldsEffect = (
  did: string,
): Effect.Effect<BlueskyPublicProfileFields | null> =>
  Effect.gen(function* () {
    const url = new URL("xrpc/app.bsky.actor.getProfile", "https://public.api.bsky.app");
    url.searchParams.set("actor", did);

    const fetched = yield* Effect.either(blueskyFetchEffect(url.toString()));
    if (Either.isLeft(fetched)) return null;

    const response = fetched.right;
    if (!response.ok) return null;

    const jsonResult = yield* Effect.either(jsonFromResponseEffect(response));
    if (Either.isLeft(jsonResult)) return null;

    const profileData = jsonResult.right as {
      handle?: string | null;
      displayName?: string | null;
      avatar?: string | null;
    };

    const handle = profileData.handle?.trim();
    const displayName = profileData.displayName?.trim();
    const rawAvatar = profileData.avatar;
    const avatarUrl =
      typeof rawAvatar === "string" && rawAvatar.trim() !== "" ? rawAvatar.trim() : null;
    return {
      handle: handle && handle.length > 0 ? handle : null,
      displayName: displayName && displayName.length > 0 ? displayName : null,
      avatarUrl,
    };
  });
