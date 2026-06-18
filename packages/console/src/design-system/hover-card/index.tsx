"use client";

import type { PopoverProps as AriaPopoverProps, DialogTriggerProps } from "react-aria-components";

import * as stylex from "@stylexjs/stylex";
import { use, useCallback, useRef } from "react";
import { mergeProps, useFocusVisible, useHover, useKeyboard, usePress } from "react-aria";
import {
  Popover as AriaPopover,
  Dialog,
  DialogTrigger,
  OverlayTriggerStateContext,
  Pressable,
} from "react-aria-components";

import type { StyleXComponentProps } from "../theme/types";

import { horizontalSpace, verticalSpace } from "../theme/semantic-spacing.stylex";
import { shadow } from "../theme/shadow.stylex";
import { usePopoverStyles } from "../theme/usePopoverStyles";

const styles = stylex.create({
  wrapper: {
    shadow: shadow.md,
  },
  content: {
    outline: "none",
    position: "relative",
    paddingBottom: verticalSpace["md"],
    paddingLeft: horizontalSpace["md"],
    paddingRight: horizontalSpace["md"],
    paddingTop: verticalSpace["md"],
  },
  hoverOnlyTrigger: {
    display: "inline-flex",
    height: "100%",
    alignItems: "center",
  },
});

/** Matches `animationDuration.default` on popover enter transitions. */
const POPOVER_ENTER_MS = 150;
const OPEN_GUARD_BUFFER_MS = 50;

interface HoverCardInnerProps extends StyleXComponentProps<Omit<AriaPopoverProps, "trigger">> {
  trigger: React.ComponentProps<typeof Pressable>["children"];
  triggerName?: AriaPopoverProps["trigger"];
  children: React.ReactNode;
  showDelay?: number;
  hideDelay?: number;
  /** Open and close via hover only — pointer presses do not toggle the card. */
  hoverOnly?: boolean;
  guardCloseUntilRef: React.MutableRefObject<number>;
}

function HoverCardInner({
  trigger,
  triggerName,
  children,
  style,
  showDelay = 250,
  hideDelay = 250,
  hoverOnly = false,
  offset = 8,
  guardCloseUntilRef,
  ...popoverProps
}: HoverCardInnerProps) {
  const { isFocusVisible } = useFocusVisible();
  const overlayTriggerState = use(OverlayTriggerStateContext);
  const popoverStyles = usePopoverStyles();
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const clearShowTimeout = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  };

  const isCloseGuarded = () => Date.now() < guardCloseUntilRef.current;

  const extendOpenGuard = useCallback(
    (extraMs = 0) => {
      const untilOpenMs = showTimeoutRef.current ? showDelay : 0;
      guardCloseUntilRef.current =
        Date.now() + untilOpenMs + POPOVER_ENTER_MS + OPEN_GUARD_BUFFER_MS + extraMs;
    },
    [guardCloseUntilRef, showDelay],
  );

  const markOpened = useCallback(() => {
    guardCloseUntilRef.current = Date.now() + POPOVER_ENTER_MS + OPEN_GUARD_BUFFER_MS;
  }, [guardCloseUntilRef]);

  const openCard = useCallback(() => {
    overlayTriggerState?.open();
    markOpened();
  }, [markOpened, overlayTriggerState]);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    const run = () => {
      hideTimeoutRef.current = null;
      if (Date.now() < guardCloseUntilRef.current) {
        hideTimeoutRef.current = setTimeout(run, guardCloseUntilRef.current - Date.now());
        return;
      }
      overlayTriggerState?.close();
    };
    hideTimeoutRef.current = setTimeout(run, hideDelay);
  }, [clearHideTimeout, guardCloseUntilRef, hideDelay, overlayTriggerState]);

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (!isFocusVisible) return;
      if (e.key !== "Enter") return;
      openCard();
    },
  });

  const { hoverProps } = useHover({
    onHoverStart: () => {
      if (showTimeoutRef.current) return;
      clearHideTimeout();
      showTimeoutRef.current = setTimeout(() => {
        openCard();
        showTimeoutRef.current = null;
      }, showDelay);
    },
    onHoverEnd: () => {
      if (isCloseGuarded()) {
        return;
      }

      if (showTimeoutRef.current) {
        clearShowTimeout();
      }
      scheduleHide();
    },
  });

  const { pressProps } = usePress({
    onPressStart: hoverOnly
      ? () => {
          extendOpenGuard();
          clearHideTimeout();
        }
      : undefined,
    onPress: hoverOnly ? () => {} : undefined,
  });

  const triggerProps = mergeProps(
    hoverProps,
    keyboardProps,
    hoverOnly ? pressProps : undefined,
    hoverOnly
      ? {
          onPointerDown: () => {
            extendOpenGuard();
            clearHideTimeout();
          },
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            extendOpenGuard();
            clearHideTimeout();
          },
        }
      : undefined,
  );

  return (
    <>
      <Pressable
        {...triggerProps}
        {...(hoverOnly ? stylex.props(styles.hoverOnlyTrigger) : undefined)}
      >
        {trigger}
      </Pressable>
      <AriaPopover
        {...stylex.props(styles.wrapper, popoverStyles.wrapper, popoverStyles.animation)}
        offset={offset}
        containerPadding={8}
        isNonModal={isFocusVisible ? false : true}
        trigger={triggerName}
        {...mergeProps(hoverProps, popoverProps)}
      >
        <Dialog {...stylex.props(styles.content, style)}>{children}</Dialog>
      </AriaPopover>
    </>
  );
}

export interface HoverCardProps
  extends DialogTriggerProps, Omit<HoverCardInnerProps, "guardCloseUntilRef"> {}

export const HoverCard = ({ defaultOpen, isOpen, onOpenChange, ...props }: HoverCardProps) => {
  const guardCloseUntilRef = useRef(0);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && Date.now() < guardCloseUntilRef.current) {
        return;
      }
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  return (
    <DialogTrigger
      {...({ isOpen, onOpenChange: handleOpenChange, defaultOpen } as DialogTriggerProps)}
    >
      <HoverCardInner {...props} guardCloseUntilRef={guardCloseUntilRef} />
    </DialogTrigger>
  );
};
