import { Effect, Either } from "effect";

import type { ProviderSession } from "./pair-store.ts";
import { PairError, sharedStore } from "./pair-store.ts";

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}

const devicePairStartResponseEffect: Effect.Effect<Response> = Effect.sync(() => {
  const r = sharedStore().start();
  return json(
    {
      deviceId: r.deviceId,
      userCode: r.userCode,
      verificationUri: r.verificationUri,
      pollIntervalSecs: r.pollIntervalSecs,
      expiresInSecs: r.expiresInSecs,
    },
    200,
  );
});

export function devicePairStartResponse(): Response {
  return Effect.runSync(devicePairStartResponseEffect);
}

const devicePairPollResponseEffect = (search: string): Effect.Effect<Response> =>
  Effect.sync(() => {
    const deviceId = new URLSearchParams(search).get("deviceId");
    if (!deviceId) {
      return json({ error: "missing deviceId" }, 400);
    }
    const r = sharedStore().poll(deviceId);
    switch (r.kind) {
      case "unknown":
        return json({ status: "unknown" }, 404);
      case "pending":
        return json({ status: "pending" }, 200);
      case "denied":
        return json({ status: "denied" }, 403);
      case "expired":
        return json({ status: "expired" }, 410);
      case "consumed":
        return json({ status: "consumed" }, 410);
      case "session":
        return json({ status: "session", session: r.session }, 200);
    }
  });

/** `search` is `url.search` (e.g. `?deviceId=...`). */
export function devicePairPollResponse(search: string): Response {
  return Effect.runSync(devicePairPollResponseEffect(search));
}

interface ConfirmBody {
  userCode: string;
  decision: "approve" | "deny";
  session?: ProviderSession;
}

function requestJsonEffect<T>(request: Request): Effect.Effect<T, unknown> {
  return Effect.async((resume) => {
    void (request.json() as Promise<T>).then(
      (v) => resume(Effect.succeed(v)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

const devicePairConfirmResponseEffect = (request: Request): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.either(requestJsonEffect<ConfirmBody>(request));
    if (Either.isLeft(parsed)) {
      return json({ error: "bad json" }, 400);
    }
    const body = parsed.right;

    const code = (body.userCode ?? "").trim().toUpperCase();
    if (!code) {
      return json({ error: "missing userCode" }, 400);
    }
    const store = sharedStore();

    if (body.decision === "deny") {
      const denied = yield* Effect.either(
        Effect.try({
          try: () => {
            store.deny(code);
          },
          catch: (e) => e,
        }),
      );
      if (Either.isLeft(denied)) {
        return json({ error: "unknown code" }, 404);
      }
      return json({ ok: true, status: "denied" }, 200);
    }

    if (body.decision !== "approve") {
      return json({ error: "decision must be approve|deny" }, 400);
    }
    if (!body.session) {
      return json({ error: "session required for approve" }, 400);
    }

    const approved = yield* Effect.either(
      Effect.try({
        try: () => store.approve(code, body.session!),
        catch: (e) => e,
      }),
    );
    if (Either.isLeft(approved)) {
      const e = approved.left;
      if (e instanceof PairError) {
        return json({ error: e.message }, 409);
      }
      return json({ error: e instanceof Error ? e.message : String(e) }, 409);
    }
    const entry = approved.right;
    return json({ ok: true, status: entry.status }, 200);
  });

export function devicePairConfirmResponse(request: Request): Promise<Response> {
  return Effect.runPromise(devicePairConfirmResponseEffect(request));
}
