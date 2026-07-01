// A trust-tier badge driven by a machine's VERIFIED tier — the tier
// recomputed from its actual signed attestation, never the self-asserted
// `trustLevel` (see lib/verified-standing.server.ts). Shared by the public
// model directory and the owner's fleet dashboard so both read identically.
//
// best-effort renders nothing: the point is to make VERIFIED machines stand
// out, not to label the unverified majority.

import { Badge } from "@/design-system/badge";

export type TrustTier = "best-effort" | "hardware-attested" | "attested-confidential";

const CONFIDENTIAL_TITLE =
  "Confidential tier (experimental). Aims to keep prompts unreadable to the machine's operator by running them inside the measured, signed agent — a hardened-runtime posture, not a hardware enclave, and not independently audited. A compromised OS or a substituted build could still expose the prompt, so don't send anything you'd need kept private.";

const HARDWARE_TITLE =
  "Hardware-attested (experimental). A best-effort signal, recomputed from this machine's signed Apple-rooted attestation chain, that it's genuine Apple hardware. Treat it as a useful hint, not a guarantee.";

export function TrustTierBadge({ tier }: { tier: TrustTier }): React.ReactNode {
  if (tier === "attested-confidential") {
    return (
      <Badge size="sm" variant="default" title={CONFIDENTIAL_TITLE}>
        🔒 Confidential · experimental
      </Badge>
    );
  }
  if (tier === "hardware-attested") {
    return (
      <Badge size="sm" variant="primary" title={HARDWARE_TITLE}>
        🛡️ Hardware-attested · experimental
      </Badge>
    );
  }
  return null;
}
