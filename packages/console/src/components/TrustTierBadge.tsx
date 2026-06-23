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
  "Confidential tier — verified from this machine's signed, Apple-rooted attestation: genuine hardware bound to its signing key, a known-good measured build, hardened posture, and live code-attestation. Your prompt is sealed so the operator can't read it.";

const HARDWARE_TITLE =
  "Hardware-attested — verified from this machine's signed, Apple-rooted attestation chain, bound to its signing key. Proven genuine Apple hardware (not a self-asserted claim).";

export function TrustTierBadge({ tier }: { tier: TrustTier }): React.ReactNode {
  if (tier === "attested-confidential") {
    return (
      <Badge size="sm" variant="success" title={CONFIDENTIAL_TITLE}>
        🔒 Confidential
      </Badge>
    );
  }
  if (tier === "hardware-attested") {
    return (
      <Badge size="sm" variant="primary" title={HARDWARE_TITLE}>
        🛡️ Hardware-attested
      </Badge>
    );
  }
  return null;
}
