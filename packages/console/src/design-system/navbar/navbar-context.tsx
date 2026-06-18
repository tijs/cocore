"use client";

import * as React from "react";
import { use } from "react";

export interface MobileMenuContextValue {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  closeMenu: () => void;
}

export const MobileMenuContext = React.createContext<MobileMenuContextValue | null>(null);

export function useMobileMenu() {
  const context = use(MobileMenuContext);
  if (!context) {
    throw new Error("useMobileMenu must be used within Navbar");
  }
  return context;
}

export function useNavbarMobileMenu(): MobileMenuContextValue | null {
  return use(MobileMenuContext);
}

export interface NavbarMenuContextValue {
  closeMenu: () => void;
}

export const NavbarMenuContext = React.createContext<NavbarMenuContextValue | null>(null);

export function useNavbarMenu(): NavbarMenuContextValue | null {
  return use(NavbarMenuContext);
}
