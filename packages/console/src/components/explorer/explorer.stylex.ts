import * as stylex from "@stylexjs/stylex";

import { uiColor } from "@/design-system/theme/color.stylex";
import { breakpoints } from "@/design-system/theme/media-queries.stylex";
import {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
} from "@/design-system/theme/typography.stylex";

/** Shared layout tokens for the network graph + detail panel. */
export const explorerLayout = stylex.defineVars({
  graphHeight: "560px",
  indexedTableMaxHeight: "420px",
});

/** Section titles under the explore page (raw appview index, providers, …). */
export const explorerSectionStyles = stylex.create({
  heading: {
    color: uiColor.text2,
    fontFamily: fontFamily.mono,
    fontSize: {
      default: fontSize.xl,
      [breakpoints.md]: fontSize["2xl"],
    },
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.sm,
    marginBottom: 0,
    marginTop: 0,
    textTransform: "lowercase",
  },
});
