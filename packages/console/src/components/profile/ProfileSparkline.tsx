"use client";

import * as stylex from "@stylexjs/stylex";

import { successColor, uiColor } from "@/design-system/theme/color.stylex";

const styles = stylex.create({
  root: {
    display: "block",
    width: "100%",
    maxWidth: "7.5rem",
    marginTop: "0.35rem",
    color: uiColor.text2,
  },
  success: {
    color: successColor.solid1,
  },
});

export interface ProfileSparklineProps {
  /** Y values in display order (e.g. oldest → newest week). */
  values: number[];
  /** Accessible description of what the line encodes. */
  title: string;
  /** When true, stroke uses the success palette (token / trust cues). */
  variant?: "default" | "success";
}

/**
 * Compact line chart for profile metrics. Normalizes `values` to the
 * SVG viewBox height (handles flat series and single points).
 */
export function ProfileSparkline({ values, title, variant = "default" }: ProfileSparklineProps) {
  const n = values.length;
  if (n === 0) return null;

  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const span = Math.max(maxV - minV, 1);

  const padX = 2;
  const padY = 3;
  const vbW = 120;
  const vbH = 28;
  const innerW = vbW - 2 * padX;
  const innerH = vbH - 2 * padY;

  const yAt = (v: number): number => padY + innerH - ((v - minV) / span) * innerH;

  let d: string;
  if (n === 1) {
    const y = yAt(values[0] ?? 0);
    d = `M ${padX},${y} L ${vbW - padX},${y}`;
  } else {
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = padX + (i / (n - 1)) * innerW;
      const y = yAt(values[i] ?? 0);
      parts.push(i === 0 ? `M ${x},${y}` : `L ${x},${y}`);
    }
    d = parts.join(" ");
  }

  return (
    <svg
      {...stylex.props(styles.root, variant === "success" ? styles.success : null)}
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="none"
      role="img"
    >
      <title>{title}</title>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
