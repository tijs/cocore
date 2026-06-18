import { scope as atprotoScope } from "@atcute/oauth-node-client";

/** OAuth scopes for cocore console.
 *
 * The `repo` grants here have to enumerate every NSID the console
 * publishes to the user's PDS:
 *   * `dev.cocore.compute.provider`             — pair-machine flow
 *   * `dev.cocore.compute.job`                  — inference dispatch
 *   * `dev.cocore.compute.paymentAuthorization` — inference dispatch
 *   * `dev.cocore.account.profile`              — /account auto-provision + edits
 *   * `dev.cocore.account.friend`               — /friends add / remove
 *   * `dev.cocore.account.tokenGrant`           — exchange-side onboarding grants
 *   * `dev.cocore.account.tokenPatronage`       — exchange-side monthly rebates
 *
 * Without these, ATProto returns
 *   `ScopeMissingError: Missing required scope "repo:<nsid>?action=create"`.
 * Adding a new lexicon means: extend this list AND have the user
 * re-authorize so the new grants are in their token (existing tokens
 * issued before the new scope landed don't retroactively gain it).
 *
 * The grant/patronage scopes only fire for the exchange identity
 * (the services container publishes those records under the
 * exchange DID via the console proxy). Carrying them in the
 * user-facing scope list is harmless — users who never act as an
 * exchange operator just don't use those collections — and it
 * keeps the scope list grep-able as "every NSID cocore publishes." */
export const oauthScopes = [
  atprotoScope.account({ attr: "email", action: "read" }),
  atprotoScope.blob({ accept: ["image/*", "video/*"] }),
  atprotoScope.repo({
    collection: [
      "dev.cocore.compute.provider",
      "dev.cocore.compute.job",
      "dev.cocore.compute.paymentAuthorization",
      "dev.cocore.compute.attestation",
      "dev.cocore.compute.receipt",
      "dev.cocore.compute.settlement",
      "dev.cocore.compute.exchangePolicy",
      "dev.cocore.compute.exchangeAttestation",
      "dev.cocore.compute.termsAcceptance",
      "dev.cocore.compute.dispute",
      "dev.cocore.account.profile",
      "dev.cocore.account.friend",
      "dev.cocore.account.tokenGrant",
      "dev.cocore.account.tokenPatronage",
    ],
    action: ["create", "update", "delete"],
  }),
];
