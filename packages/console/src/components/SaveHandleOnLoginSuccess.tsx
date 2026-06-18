"use client";

import { useEffect } from "react";

import { saveHandle } from "@/utils/saved-handles.ts";

/**
 * Mounted in the header layout. The OAuth callback appends
 * `loginSuccess=true&handle=...&avatar=...` to the redirect target
 * so the client can persist a "saved handle" cookie for one-tap
 * sign-in next time. This component runs that side effect, then
 * strips the params off the URL.
 *
 * Reads `globalThis.location.search` directly (rather than
 * `Route.useSearch`) so it doesn't have to participate in any one
 * route's search schema — the same effect catches the params no
 * matter which protected page the OAuth flow lands on.
 */
export function SaveHandleOnLoginSuccess() {
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;

    const url = new URL(globalThis.location.href);
    const loginSuccess = url.searchParams.get("loginSuccess");
    const handle = url.searchParams.get("handle");
    const avatar = url.searchParams.get("avatar");

    if (loginSuccess !== "true" || !handle) return;

    saveHandle(handle, avatar && avatar.trim() !== "" ? avatar : null);

    url.searchParams.delete("loginSuccess");
    url.searchParams.delete("handle");
    url.searchParams.delete("avatar");
    globalThis.history.replaceState({}, "", url.toString());
  }, []);

  return null;
}
