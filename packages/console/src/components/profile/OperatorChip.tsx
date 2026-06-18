"use client";

// Inline chip that surfaces a cocore operator (a DID running an
// agent) on any list that shows their machines. Clicking the chip
// navigates to the operator's public profile at /u/$identifier
// where the viewer can friend them, see their other machines, etc.
//
// Shape: avatar + (display name | handle | did-short) — falls
// through cleanly when the operator hasn't published a profile yet.

import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";

import { Avatar } from "@/design-system/avatar";
import { uiColor } from "@/design-system/theme/color.stylex";
import { gap as gapSpace } from "@/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize } from "@/design-system/theme/typography.stylex";

const styles = stylex.create({
  link: {
    color: uiColor.text2,
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: gapSpace["xs"],
    textDecoration: "none",
    fontSize: fontSize.sm,
    minWidth: 0,
    overflow: "hidden",
    ":hover": {
      textDecoration: "underline",
    },
  },
  did: {
    fontFamily: fontFamily.mono,
    color: uiColor.text1,
    fontSize: fontSize.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export interface OperatorChipProps {
  did: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/** Human-readable identifier preference: displayName > handle >
 *  short DID (last 8 chars). */
function pickLabel(p: OperatorChipProps): { label: string; isMono: boolean } {
  if (p.displayName && p.displayName.trim().length > 0) {
    return { label: p.displayName.trim(), isMono: false };
  }
  if (p.handle && p.handle.trim().length > 0) {
    return { label: `@${p.handle.trim()}`, isMono: false };
  }
  // Last 8 chars of the DID are a useful fingerprint; full DID is
  // ugly inline. The profile page shows the full thing.
  return { label: `…${p.did.slice(-8)}`, isMono: true };
}

export function OperatorChip(props: OperatorChipProps) {
  const { label, isMono } = pickLabel(props);
  // Prefer routing by handle when we have one — the URL is human-
  // readable and survives DID-handle reassociation if it ever
  // happens. Fall back to the raw DID for handle-less DIDs.
  const identifier = props.handle && props.handle.length > 0 ? props.handle : props.did;
  return (
    <Link
      to="/u/$identifier"
      params={{ identifier }}
      preload="intent"
      {...stylex.props(styles.link)}
    >
      <Avatar
        src={props.avatarUrl ?? undefined}
        alt={label}
        fallback={label.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
        size="sm"
      />
      <span {...(isMono ? stylex.props(styles.did) : {})}>{label}</span>
    </Link>
  );
}
