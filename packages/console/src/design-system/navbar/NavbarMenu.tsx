"use client";

import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { use, useCallback, useMemo, useState } from "react";
import { mergeProps, useHover, usePress } from "react-aria";
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";

import type { HoverCardProps } from "../hover-card";
import type { StyleXComponentProps } from "../theme/types";

import { HoverCard } from "../hover-card";
import { NavbarMenuContext, useNavbarMobileMenu } from "./navbar-context";
import { animationDuration } from "../theme/animations.stylex";
import { primaryColor, uiColor } from "../theme/color.stylex";
import { containerBreakpoints } from "../theme/media-queries.stylex";
import { radius } from "../theme/radius.stylex";
import {
  gap,
  horizontalSpace,
  size as sizeSpace,
  verticalSpace,
} from "../theme/semantic-spacing.stylex";
import { fontFamily, fontSize, fontWeight } from "../theme/typography.stylex";

const styles = stylex.create({
  menuItem: {
    paddingBottom: verticalSpace["sm"],
    paddingLeft: horizontalSpace["sm"],
    borderRadius: radius.md,
    paddingRight: horizontalSpace["sm"],
    textDecoration: "none",
    paddingTop: verticalSpace["sm"],
    alignItems: "center",
    backgroundColor: {
      ":is([data-hovered=true]):not([data-pressed=true])": uiColor.component2,
      ":is([data-pressed=true])": uiColor.component3,
    },
    columnGap: gap["xl"],
    display: "grid",
    rowGap: gap["sm"],
    transitionDuration: animationDuration.fast,
    transitionProperty: "background-color",
    transitionTimingFunction: "ease-in-out",
    userSelect: "none",

    gridTemplateAreas: {
      default: '"title"',
      ":has(:is([data-description]))": `
        "title"
        "description"
      `,
      ":has(:is([data-icon]))": `
        "icon title"
      `,
      ":has([data-icon]):has([data-description])": `
        "icon title"
        "icon description"
      `,
    },
    gridTemplateColumns: {
      ":has(:is([data-icon]))": "min-content 1fr",
      ":has([data-icon]):has([data-description])": "min-content 1fr",
    },
  },
  menuItemIcon: {
    gridColumnEnd: "icon",
    gridColumnStart: "icon",
    gridRowEnd: "icon",
    gridRowStart: "icon",
    paddingBottom: verticalSpace["sm"],
    paddingLeft: horizontalSpace["sm"],
    borderRadius: radius.md,
    paddingRight: horizontalSpace["sm"],
    alignItems: "center",
    paddingTop: verticalSpace["sm"],
    backgroundColor: {
      default: uiColor.component2,
      [stylex.when.ancestor(":is([data-hovered])")]: uiColor.component1,
    },
    color: uiColor.text1,
    display: "flex",
    justifyContent: "center",
    height: sizeSpace["3xl"],
    width: sizeSpace["3xl"],

    // eslint-disable-next-line @stylexjs/no-legacy-contextual-styles, @stylexjs/valid-styles
    ":is(*) svg": {
      height: sizeSpace["xl"],
      width: sizeSpace["xl"],
    },
  },
  menuItemLabel: {
    gridColumnEnd: "title",
    gridColumnStart: "title",
    gridRowEnd: "title",
    gridRowStart: "title",
    color: uiColor.text2,
    fontWeight: fontWeight["medium"],
  },
  menuItemDescription: {
    gridColumnEnd: "description",
    gridColumnStart: "description",
    gridRowEnd: "description",
    gridRowStart: "description",
    color: uiColor.text1,
    fontSize: fontSize["sm"],
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  link: {
    "--underline-opacity": {
      default: 0,
      ":is([aria-expanded=true])": 1,
      ":is([data-active])": 1,
      ":is([data-breadcrumb] *)": 0,
      ":is([data-hovered])": 1,
    },
    gap: gap["md"],
    textDecoration: "none",
    alignItems: "center",
    color: {
      default: primaryColor.text2,
      ":is([data-breadcrumb] *)": uiColor.text1,
      ":is([data-breadcrumb][data-current] *)": uiColor.text2,
    },
    cursor: "pointer",
    display: {
      default: "flex",
      [containerBreakpoints.lg]: "inline-flex",
    },
    fontFamily: fontFamily["sans"],
    fontWeight: fontWeight["normal"],
    position: "relative",
    width: {
      default: "100%",
      [containerBreakpoints.lg]: "auto",
    },
    height: "100%",

    // eslint-disable-next-line @stylexjs/no-legacy-contextual-styles, @stylexjs/valid-styles
    ":is(*) svg": {
      height: "1.2em",
      width: "1.2em",
    },
  },
  linkContent: {
    position: "relative",
    height: "100%",
    display: "flex",
    alignItems: "center",

    "::after": {
      backgroundColor: "currentColor",
      content: '""',
      display: "block",
      opacity: "var(--underline-opacity)",
      pointerEvents: "none",
      position: "absolute",
      bottom: `calc(${verticalSpace["xxs"]} * -1)`,
      height: "2px",
      left: 0,
      right: 0,
      width: "100%",
    },
  },
  desktopMenu: {
    display: {
      default: "none",
      [containerBreakpoints.lg]: "flex",
    },
    height: "100%",
    alignItems: "stretch",
  },
  mobileMenu: {
    display: {
      default: "block",
      [containerBreakpoints.lg]: "none",
    },
    width: "100%",
  },
  menuTriggerButton: {
    display: "contents",
    fontSize: "inherit",
  },
  menuDisclosurePanel: {
    paddingTop: gap["md"],
    width: "100%",
  },
  menuList: {
    display: "flex",
    flexDirection: "column",
    gap: {
      default: gap["5xl"],
      [containerBreakpoints.lg]: gap["xs"],
    },
    minWidth: {
      [containerBreakpoints.lg]: "10rem",
    },

    // eslint-disable-next-line @stylexjs/no-legacy-contextual-styles, @stylexjs/valid-styles
    ":is(a)": {
      width: "100%",
    },
  },
});

interface NavbarMenuProps extends HoverCardProps {}

export function NavbarMenu({ trigger, children, ...props }: NavbarMenuProps) {
  const mobileMenu = useNavbarMobileMenu();
  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  const closeMenu = useCallback(() => {
    setIsDesktopOpen(false);
    setIsMobileExpanded(false);
    mobileMenu?.closeMenu();
  }, [mobileMenu]);

  const menuContext = useMemo(() => ({ closeMenu }), [closeMenu]);

  return (
    <NavbarMenuContext value={menuContext}>
      <div {...stylex.props(styles.desktopMenu)}>
        <HoverCard
          {...props}
          hoverOnly
          placement="bottom start"
          isOpen={isDesktopOpen}
          onOpenChange={setIsDesktopOpen}
          trigger={trigger}
        >
          {children}
        </HoverCard>
      </div>
      <Disclosure
        {...stylex.props(styles.mobileMenu)}
        isExpanded={isMobileExpanded}
        onExpandedChange={setIsMobileExpanded}
      >
        <Button slot="trigger" {...stylex.props(styles.menuTriggerButton)}>
          {trigger}
        </Button>
        <DisclosurePanel>
          <div {...stylex.props(styles.menuDisclosurePanel)}>{children}</div>
        </DisclosurePanel>
      </Disclosure>
    </NavbarMenuContext>
  );
}

export interface NavbarMenuTriggerProps extends StyleXComponentProps<React.ComponentProps<"div">> {
  isActive?: boolean;
}

export function NavbarMenuTrigger({ style, isActive, children, ...props }: NavbarMenuTriggerProps) {
  return (
    <div {...props} data-active={isActive || undefined} {...stylex.props(styles.link, style)}>
      <span {...stylex.props(styles.linkContent)}>{children}</span>
    </div>
  );
}

export interface NavbarMenuListProps extends StyleXComponentProps<React.ComponentProps<"div">> {}

export function NavbarMenuList({ style, onClick, ...props }: NavbarMenuListProps) {
  const navbarMenu = use(NavbarMenuContext);

  return (
    <div
      {...props}
      {...stylex.props(styles.menuList, style)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) {
          navbarMenu?.closeMenu();
        }
        onClick?.(e);
      }}
    />
  );
}

interface NavbarMenuItemProps extends StyleXComponentProps<
  Omit<React.ComponentProps<"div">, "children">
> {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  isDisabled?: boolean;
}

export function NavbarMenuItem({
  style,
  icon,
  label,
  description,
  isDisabled,
  ...props
}: NavbarMenuItemProps) {
  const navbarMenu = use(NavbarMenuContext);
  const { hoverProps, isHovered } = useHover({ isDisabled });
  const { pressProps, isPressed } = usePress({ isDisabled });
  const Component = "href" in props ? "a" : "button";

  return (
    <Component
      {...mergeProps(props as React.ComponentProps<typeof Component>, hoverProps, pressProps, {
        onClick() {
          navbarMenu?.closeMenu();
        },
      })}
      data-hovered={isHovered || undefined}
      data-pressed={isPressed}
      {...stylex.props(
        stylex.defaultMarker(),
        styles.menuItem,
        isDisabled && styles.menuItemDisabled,
        style,
      )}
    >
      {Boolean(icon) && (
        <div data-icon {...stylex.props(styles.menuItemIcon)}>
          {icon}
        </div>
      )}
      {label && <div {...stylex.props(styles.menuItemLabel)}>{label}</div>}
      {description && (
        <div data-description {...stylex.props(styles.menuItemDescription)}>
          {description}
        </div>
      )}
    </Component>
  );
}
