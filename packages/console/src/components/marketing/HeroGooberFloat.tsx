"use client";

import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";

import { Goober } from "@/components/Goober.tsx";
import { breakpoints, mediaQueries } from "@/design-system/theme/media-queries.stylex";

const HERO_GOOBER_NAMES = ["balloon", "carrot"] as const;

const heroGooberEnter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(12px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const heroGooberBob = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-10px)" },
});

const styles = stylex.create({
  heroGoobers: {
    alignSelf: {
      [breakpoints.md]: "center",
    },
    display: { default: "none", [breakpoints.md]: "block" },
    justifySelf: "center",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  heroGooberFloat: {
    marginLeft: "auto",
    marginRight: "auto",
    maxWidth: "100%",
    width: {
      [breakpoints.md]: "240px",
      [breakpoints.lg]: "288px",
      [breakpoints.xl]: "336px",
    },
  },
  heroGooberFloatPending: {
    minHeight: {
      [breakpoints.md]: "216px",
      [breakpoints.lg]: "279px",
      [breakpoints.xl]: "319px",
    },
  },
  heroGooberFloatReady: {
    animationDuration: "0.85s",
    animationFillMode: "both",
    animationName: {
      default: heroGooberEnter,
      [mediaQueries.reducedMotion]: "none",
    },
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
  },
  heroGooberFloatBob: {
    alignItems: "center",
    animationDuration: "4.5s",
    animationIterationCount: {
      default: "infinite",
      [mediaQueries.reducedMotion]: 1,
    },
    animationName: {
      default: heroGooberBob,
      [mediaQueries.reducedMotion]: "none",
    },
    animationTimingFunction: "ease-in-out",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  heroGooberBalloon: {
    flexShrink: 0,
    height: {
      [breakpoints.md]: "124px",
      [breakpoints.lg]: "158px",
      [breakpoints.xl]: "178px",
    },
    marginBottom: {
      [breakpoints.md]: "-62px",
      [breakpoints.lg]: "-79px",
      [breakpoints.xl]: "-89px",
    },
    position: "static",
    width: {
      [breakpoints.md]: "124px",
      [breakpoints.lg]: "158px",
      [breakpoints.xl]: "178px",
    },
    zIndex: 1,
  },
  heroGooberCarrot: {
    flexShrink: 0,
    height: {
      [breakpoints.md]: "154px",
      [breakpoints.lg]: "200px",
      [breakpoints.xl]: "228px",
    },
    position: "static",
    width: {
      [breakpoints.md]: "154px",
      [breakpoints.lg]: "200px",
      [breakpoints.xl]: "228px",
    },
  },
});

function preloadGoobies(names: readonly string[]): Promise<void> {
  return Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          const done = () => resolve();
          img.onload = done;
          img.onerror = done;
          img.src = `/goobies/${name}.png`;
        }),
    ),
  ).then(() => undefined);
}

export function HeroGooberFloat() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void preloadGoobies(HERO_GOOBER_NAMES).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div {...stylex.props(styles.heroGoobers)} aria-hidden>
      <div
        {...stylex.props(
          styles.heroGooberFloat,
          !ready && styles.heroGooberFloatPending,
          ready && styles.heroGooberFloatReady,
        )}
      >
        {ready ? (
          <div {...stylex.props(styles.heroGooberFloatBob)}>
            <Goober name="balloon" size={178} style={styles.heroGooberBalloon} />
            <Goober name="carrot" size={228} style={styles.heroGooberCarrot} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
