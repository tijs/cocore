// OAuth scopes for cocore console. The list itself is the shared
// `@cocore/sdk/oauth-scope` constant (kept in one place so the console's
// minting client and the AppView's restoring client never drift); this
// module just re-exports it under the name the console's auth wiring imports.
export { oauthScopes } from "@cocore/sdk/oauth-scope";
