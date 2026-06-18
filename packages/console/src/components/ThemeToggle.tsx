"use client";

import { Moon, Sun, SunMoon, Check } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/design-system/icon-button";
import { MenuItem, SubMenu } from "@/design-system/menu";

import { useThemeMode, type ThemeMode } from "./theme-mode.ts";

const THEME_OPTIONS: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "auto", label: "System", Icon: SunMoon },
];

function ThemeMenuItems() {
  const { mode, setMode } = useThemeMode();

  return (
    <>
      {THEME_OPTIONS.map(({ id, label, Icon }) => (
        <MenuItem
          key={id}
          id={`theme-${id}`}
          onPress={() => setMode(id)}
          prefix={<Icon size={16} aria-hidden />}
          suffix={mode === id ? <Check size={16} aria-hidden /> : undefined}
        >
          {label}
        </MenuItem>
      ))}
    </>
  );
}

export function ThemeMenuSubmenu() {
  return (
    <SubMenu trigger={<MenuItem id="theme">Color scheme</MenuItem>}>
      <ThemeMenuItems />
    </SubMenu>
  );
}

export function ThemeToggle() {
  const { mode, cycleMode } = useThemeMode();
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 64rem)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const label =
    mode === "auto"
      ? "Theme mode: auto (system). Click to switch to light mode."
      : `Theme mode: ${mode}. Click to switch mode.`;

  const Icon = mode === "auto" ? SunMoon : mode === "dark" ? Moon : Sun;

  return (
    <IconButton
      type="button"
      variant={isDesktop ? "secondary" : "tertiary"}
      size={isDesktop ? "md" : "lg"}
      onPress={cycleMode}
      aria-label={label}
    >
      <Icon />
    </IconButton>
  );
}
