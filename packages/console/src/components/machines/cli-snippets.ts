// One-line installer we surface on the /start guide and elsewhere.
//
// v0.6.0 collapsed the previous stub vs. inference variants into a
// single install path (see `agent-install.sh`'s doc-comment for the
// rationale). One command, one tarball, one user experience. The
// installer's auto-pair phase makes any explicit `cocore agent pair`
// step a follow-up only when the user opted out of pair via
// COCORE_SKIP_PAIR=1.

export const CLI_LINES_INSTALL = `curl -fsSL cocore.dev/agent | sh`;
export const CLI_ONE_LINER_INSTALL = "curl -fsSL cocore.dev/agent | sh";
