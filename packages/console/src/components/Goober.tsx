import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

type StyleXCreatedStyle = ReturnType<typeof stylex.create>[string];

// A little hand-drawn "goobie" tucked into a margin or hanging off a div's
// edge — pure decorative flair (aria-hidden, non-interactive). It's
// absolutely positioned; the placement (top/left/right/bottom offsets) comes
// from the caller's `style`. Wrap the target in a position:relative,
// overflow:visible container so the goobie can overhang the edge.
const styles = stylex.create({
  base: {
    position: "absolute",
    objectFit: "contain",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 2,
  },
});

export function Goober({
  name,
  size = 88,
  style,
}: {
  name: string;
  size?: number;
  style?: StyleXStyles | StyleXCreatedStyle | ReadonlyArray<StyleXStyles | StyleXCreatedStyle>;
}) {
  return (
    <img
      src={`/goobies/${name}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      {...stylex.props(styles.base, style)}
    />
  );
}
