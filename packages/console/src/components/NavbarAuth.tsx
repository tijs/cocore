"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { AvatarButton } from "@/design-system/avatar";
import { Button } from "@/design-system/button";
import { Menu, MenuItem, MenuSeparator } from "@/design-system/menu";
import { NavbarAction } from "@/design-system/navbar";
import { Skeleton } from "@/design-system/skeleton";
import { clearChatStoreMemory } from "@/components/chat/chat-store.ts";
import { ThemeMenuSubmenu } from "@/components/ThemeToggle.tsx";
import {
  getSessionQueryOptions,
  signOutMutationOptions,
} from "@/integrations/auth/session.functions.ts";

const ButtonLink = createLink(Button);
const MenuItemLink = createLink(MenuItem);

function NavbarAccountMenu({
  avatar,
  profileId,
  onLogout,
}: {
  avatar: React.ReactNode;
  profileId: string;
  onLogout: () => void;
}) {
  return (
    <NavbarAction>
      <Menu size="lg" trigger={avatar} placement="bottom end">
        <MenuItemLink to="/u/$identifier" params={{ identifier: profileId }}>
          View profile
        </MenuItemLink>
        <MenuItemLink to="/account">Account settings</MenuItemLink>
        <MenuSeparator />
        <ThemeMenuSubmenu />
        <MenuSeparator />
        <MenuItem variant="destructive" id="logout" onPress={onLogout} suffix={<LogOut />}>
          Log out
        </MenuItem>
      </Menu>
    </NavbarAction>
  );
}

export function NavbarAuth() {
  const { data: session, isPending } = useQuery(getSessionQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logoutMutation = useMutation({
    ...signOutMutationOptions,
    onSuccess: async () => {
      // Flip session to null first so any session-gated `useQuery`s
      // disable themselves and protected components stop reading
      // user-scoped state, then leave the protected route, *then*
      // wipe the entire cache. Without the full clear, a re-login
      // (or any still-mounted observer) can briefly surface the
      // previous user's cached dashboard data.
      clearChatStoreMemory();
      queryClient.setQueryData(getSessionQueryOptions.queryKey, null);
      await navigate({ to: "/" });
      queryClient.clear();
      queryClient.setQueryData(getSessionQueryOptions.queryKey, null);
    },
  });

  if (isPending) {
    return (
      <NavbarAction>
        <Skeleton variant="circle" size="md" aria-label="Loading session" aria-busy />
      </NavbarAction>
    );
  }

  if (session?.user) {
    const initial = session.user.name?.charAt(0).toUpperCase() ?? "U";
    // Profile route resolves a handle or a DID; prefer the handle for a
    // clean /u/<handle> URL, fall back to the always-present DID.
    const profileId = session.user.handle ?? session.user.did;
    return (
      <NavbarAccountMenu
        profileId={profileId}
        avatar={
          <AvatarButton
            size="md"
            src={session.user.image ?? undefined}
            alt={`${session.user.name} avatar`}
            fallback={initial}
            aria-label="Account menu"
          />
        }
        onLogout={() => logoutMutation.mutate()}
      />
    );
  }

  return (
    <NavbarAction>
      <ButtonLink to="/login" variant="secondary" size="md">
        Log in
      </ButtonLink>
    </NavbarAction>
  );
}
