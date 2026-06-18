import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type CreateMyApiKeyOutput,
  createMyApiKeyMutationOptions,
  listMyApiKeysQueryOptions,
} from "@/components/api-keys/api-keys.functions.ts";
import { Button } from "@/design-system/button";
import { CopyToClipboardButton } from "@/design-system/copy-to-clipboard-button";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/design-system/dialog";
import { Flex } from "@/design-system/flex";
import { TextField } from "@/design-system/text-field";
import { fontFamily } from "@/design-system/theme/typography.stylex";
import { toasts } from "@/design-system/toast";

const styles = stylex.create({
  secret: {
    fontFamily: fontFamily.mono,
    fontSize: "0.875rem",
    overflowWrap: "anywhere",
    userSelect: "all",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    background: "rgba(0,0,0,0.05)",
  },
});

function showToast(title: string) {
  toasts.add({ title }, { timeout: 2400 });
}

export interface CreateApiKeyButtonProps {
  /** Visual variant for the trigger button. Defaults to "primary". */
  variant?: "primary" | "secondary";
  /** Size of the trigger button. Defaults to "sm". */
  size?: "sm" | "md" | "lg";
  /** Label for the trigger button. Defaults to "Create API key". */
  label?: string;
}

export function CreateApiKeyButton({
  variant = "primary",
  size = "sm",
  label = "Create API key",
}: CreateApiKeyButtonProps) {
  const queryClient = useQueryClient();
  const createM = useMutation(createMyApiKeyMutationOptions);

  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [revealed, setRevealed] = useState<CreateMyApiKeyOutput | null>(null);

  const onCreate = () => {
    const name = draftName.trim();
    if (!name) {
      showToast("Name is required");
      return;
    }
    createM.mutate(
      { name },
      {
        onSuccess: (out) => {
          setRevealed(out);
          setDraftName("");
          setCreateOpen(false);
          queryClient.invalidateQueries({ queryKey: listMyApiKeysQueryOptions.queryKey });
        },
        onError: (e) => showToast(e instanceof Error ? e.message : "Could not create key"),
      },
    );
  };

  return (
    <>
      <Dialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        trigger={
          <Button variant={variant} size={size}>
            {label}
          </Button>
        }
      >
        <DialogHeader>Create API key</DialogHeader>
        <DialogBody>
          <DialogDescription>
            Give this key a name so you can recognize it later. The full secret will be shown
            exactly once and never again — copy it somewhere safe before closing the next dialog.
          </DialogDescription>
          <Flex direction="column" gap="md">
            <TextField
              label="Name"
              value={draftName}
              onChange={setDraftName}
              placeholder="laptop, ci, my-script…"
              isDisabled={createM.isPending}
            />
          </Flex>
        </DialogBody>
        <DialogFooter>
          <Flex direction="row" gap="md">
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setCreateOpen(false)}
              isDisabled={createM.isPending}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" isDisabled={createM.isPending} onPress={onCreate}>
              {createM.isPending ? "Creating…" : "Create key"}
            </Button>
          </Flex>
        </DialogFooter>
      </Dialog>

      <Dialog
        isOpen={revealed != null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
        trigger={
          <button
            type="button"
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
            tabIndex={-1}
            aria-hidden
          />
        }
      >
        <DialogHeader>Save your API key</DialogHeader>
        <DialogBody>
          <DialogDescription>
            Copy this key now — once this dialog closes, the secret is no longer retrievable.
          </DialogDescription>
          <Flex direction="column" gap="md">
            <Flex direction="row" align="center" gap="sm">
              <div {...stylex.props(styles.secret)}>{revealed?.secret ?? ""}</div>
              <CopyToClipboardButton text={revealed?.secret ?? ""} />
            </Flex>
          </Flex>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="sm" onPress={() => setRevealed(null)}>
            I've copied it
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
