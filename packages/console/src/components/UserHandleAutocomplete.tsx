"use client";

import type { ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import {
  cocoreDirectoryTypeaheadPublicQueryOptions,
  cocoreDirectoryTypeaheadQueryOptions,
} from "@/integrations/appview/cocore-directory-typeahead.functions.ts";
import { AutocompleteInput } from "@/design-system/autocomplete";
import { Avatar } from "@/design-system/avatar";
import { ListBoxItem } from "@/design-system/listbox";
import type { Size } from "@/design-system/theme/types";
import { bskyHandleTypeaheadQueryOptions } from "@/integrations/bsky/bsky-typeahead.functions.ts";

type HandleActor = {
  id: string;
  handle: string;
  avatar: string | null;
};

/** Where the cocore directory query runs (only when `source="cocore"`). */
type CocoreDirectoryQueryScope = "public" | "session";

type UserHandleAutocompleteSource = "bsky" | "cocore";

/** Second argument to `onSelect` when the user picked a cocore directory row. */
type UserHandleAutocompleteSelectMeta = {
  /** Repo DID of the picked account — use as friend `subject`. */
  cocoreSubjectDid: string;
};

export interface UserHandleAutocompleteProps {
  value: string;
  onValueChange: (value: string) => void;
  onSelect?: (committed: string, meta?: UserHandleAutocompleteSelectMeta) => void;
  label?: ReactNode;
  /** Screen-reader label for the input when no visible `label`. */
  ariaLabel?: string;
  placeholder?: string;
  size?: Size;
  isDisabled?: boolean;
  /**
   * `bsky` (default): `app.bsky.actor.searchActorsTypeahead` (login and generic pickers).
   * `cocore`: AppView `listAccounts` + `q` (e.g. /friends add-by-directory).
   */
  source?: UserHandleAutocompleteSource;
  /**
   * When `source="cocore"`: `session` (default) passes `viewerDid`; `public` reads the directory
   * without auth (rare — e.g. unauthenticated marketing UIs).
   */
  directoryQueryScope?: CocoreDirectoryQueryScope;
}

const styles = stylex.create({
  itemHandle: {
    minWidth: 0,
  },
});

/** Bluesky global typeahead or cocore AppView directory members (`listAccounts` + `q`). */
export function UserHandleAutocomplete({
  value,
  onValueChange,
  onSelect,
  label,
  ariaLabel,
  placeholder = "your.handle.com",
  size = "lg",
  isDisabled,
  source = "bsky",
  directoryQueryScope = "session",
}: UserHandleAutocompleteProps) {
  const query = value.trim();

  const bskyQuery = useQuery({
    ...bskyHandleTypeaheadQueryOptions(query),
    enabled: source === "bsky",
  });

  const sessionOpts = cocoreDirectoryTypeaheadQueryOptions(query);
  const publicOpts = cocoreDirectoryTypeaheadPublicQueryOptions(query);

  const sessionQuery = useQuery({
    ...sessionOpts,
    enabled: source === "cocore" && directoryQueryScope === "session" && !!sessionOpts.enabled,
  });
  const publicQuery = useQuery({
    ...publicOpts,
    enabled: source === "cocore" && directoryQueryScope === "public" && !!publicOpts.enabled,
  });

  const accounts =
    source === "cocore"
      ? directoryQueryScope === "public"
        ? (publicQuery.data?.accounts ?? [])
        : (sessionQuery.data?.accounts ?? [])
      : [];

  const actors: HandleActor[] =
    source === "bsky"
      ? (bskyQuery.data?.actors ?? []).map((actor) => ({
          ...actor,
          id: actor.handle,
        }))
      : accounts.map((a) => {
          const handle = a.handle?.trim() || "";
          const labelText = handle.length > 0 ? handle : a.did;
          return {
            id: a.did,
            handle: labelText,
            avatar: a.avatarUrl,
          };
        });

  return (
    <AutocompleteInput
      size={size}
      placeholder={placeholder}
      label={label}
      ariaLabel={ariaLabel}
      inputValue={value}
      onInputChange={onValueChange}
      items={actors}
      isDisabled={isDisabled}
      popoverSelectionOnly={source === "cocore"}
      onAction={(selectedKey) => {
        const row = actors.find((a) => a.id === selectedKey);
        const committed = row?.handle ?? selectedKey;
        onValueChange(committed);
        onSelect?.(
          committed,
          source === "cocore" && row ? { cocoreSubjectDid: row.id } : undefined,
        );
      }}
    >
      {(actor) => (
        <ListBoxItem
          key={actor.id}
          textValue={actor.handle}
          id={actor.id}
          prefix={
            <Avatar
              src={actor.avatar ?? undefined}
              alt={actor.handle}
              fallback={actor.handle[0]?.toUpperCase() ?? "?"}
            />
          }
        >
          <span {...stylex.props(styles.itemHandle)}>{actor.handle}</span>
        </ListBoxItem>
      )}
    </AutocompleteInput>
  );
}
