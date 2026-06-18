"use client";

// Editable cocore-side profile. The profile lives at
// `dev.cocore.account.profile/self` on the user's PDS — auto-
// provisioned at first sign-in from their Bluesky public profile.
// Three editable fields: displayName, bio, avatar (uploaded as a blob
// to the user's PDS; the resulting public `getBlob` URL is stored in
// the `avatarUrl` field). Handle + DID are display-only.

import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageCropperDialog } from "@/components/account/ImageCropperDialog.tsx";
import {
  getMyProfileQueryOptions,
  updateMyProfileMutationOptions,
  uploadMyAvatarMutationOptions,
} from "@/components/account/profile.functions.ts";
import { getSessionQueryOptions } from "@/integrations/auth/session.functions.ts";
import { Alert } from "@/design-system/alert";
import { AvatarButton } from "@/design-system/avatar";
import { Button } from "@/design-system/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/design-system/card";
import { FileDropDefaultTrigger, FileDropZone } from "@/design-system/file-drop-zone";
import { Flex } from "@/design-system/flex";
import { TextArea } from "@/design-system/text-area";
import { TextField } from "@/design-system/text-field";
import { uiColor } from "@/design-system/theme/color.stylex";
import { radius } from "@/design-system/theme/radius.stylex";
import { gap as gapSpace, horizontalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { toasts } from "@/design-system/toast";
import { Body, InlineCode, SmallBody } from "@/design-system/typography";

const BIO_MAX_LENGTH = 2560;

const styles = stylex.create({
  cardTitleMono: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: uiColor.text2,
    textTransform: "lowercase",
  },
  cardDescription: {
    fontSize: fontSize.xs,
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  identityRow: {
    alignItems: "center",
    display: "flex",
    gap: gapSpace["lg"],
  },
  identityText: {
    minWidth: 0,
  },
  didText: {
    color: uiColor.text1,
    overflowWrap: "anywhere",
    fontFamily: fontFamily.mono,
    fontSize: "0.8125rem",
  },
  avatarDropZone: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: {
      default: "transparent",
      ":is([data-drop-target])": uiColor.solid1,
    },
    borderRadius: radius["3xl"],
    borderStyle: "dashed",
    borderWidth: 2,
    cornerShape: "squircle",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    padding: 0,
    position: "relative",
  },
  cameraIcon: {
    color: "#fff",
    left: "50%",
    opacity: {
      default: 0,
      ":is([data-hovered] *)": 1,
    },
    pointerEvents: "none",
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%)",
    transition: "opacity 0.2s ease",
    zIndex: 1,
  },
  bioCount: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.normal,
    marginLeft: horizontalSpace.sm,
  },
});

function showToast(message: string) {
  toasts.add({ title: message }, { timeout: 2400 });
}

const EMPTY_BLOB = new Blob([]);

// Matches `dev.cocore.account.profile.avatar.maxSize` exactly. The PDS
// rejects anything strictly larger, so we land *under* the cap rather
// than at it — leaves headroom for any minor framing difference.
const MAX_AVATAR_BYTES = 2_000_000;
// Successive square targets the canvas is rescaled to. Starting at
// 1024² is plenty for retina; the smaller fallbacks only kick in when
// even quality-0.6 JPEG at the larger dim won't fit the cap (very
// busy photos / noisy textures).
const AVATAR_DIMENSION_LADDER = [1024, 768, 512, 384, 256] as const;
// Quality sweep used at each dimension. PNG is tried only at the
// largest dim because it's lossless; once we step down we go straight
// to JPEG since the visual hit from compression is invisible at
// avatar sizes and PNG would never be smaller than JPEG@0.6 there.
const JPEG_QUALITIES = [0.92, 0.8, 0.65, 0.5] as const;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.addEventListener("error", reject);
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Could not encode avatar as ${type}`));
      },
      type,
      quality,
    );
  });
}

function drawToCanvas(bitmap: ImageBitmap, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/** Decode → resize → re-encode the cropped avatar so the blob fits
 *  under the server's byte cap. Prefers PNG at the largest dimension
 *  (also normalises webp/gif sources to PNG since `canvas.toBlob(…,
 *  "image/png")` ignores the source format), falling back to JPEG at
 *  decreasing quality, then to successively smaller canvas dimensions.
 *  Always returns a blob with `size <= MAX_AVATAR_BYTES` or throws. */
async function normalizeAvatarBlob(blob: Blob): Promise<Blob> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    let best: Blob | null = null;
    for (const [i, dim] of AVATAR_DIMENSION_LADDER.entries()) {
      const canvas = drawToCanvas(bitmap, dim);
      // Only try PNG at the top of the ladder — lossless makes sense
      // when bytes allow it, but at smaller dims we already accept
      // some quality loss so JPEG dominates on size.
      if (i === 0) {
        const png = await canvasToBlob(canvas, "image/png");
        if (png.size <= MAX_AVATAR_BYTES) return png;
        best = png;
      }
      for (const quality of JPEG_QUALITIES) {
        const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
        if (jpeg.size <= MAX_AVATAR_BYTES) return jpeg;
        if (!best || jpeg.size < best.size) best = jpeg;
      }
    }
    throw new Error(
      `Could not shrink avatar below ${String(MAX_AVATAR_BYTES)} bytes` +
        (best ? ` (smallest attempt was ${String(best.size)} bytes)` : "") +
        ". Try a less detailed image.",
    );
  } finally {
    bitmap.close();
  }
}

export function ProfileCard({ did }: { did: string | null }) {
  const queryClient = useQueryClient();
  const profileQ = useQuery({ ...getMyProfileQueryOptions, enabled: Boolean(did) });
  const updateM = useMutation(updateMyProfileMutationOptions);
  const uploadAvatarM = useMutation(uploadMyAvatarMutationOptions);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [pickedImage, setPickedImage] = useState<Blob>(EMPTY_BLOB);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  // Hydrate the form once the query resolves. We don't auto-rehydrate
  // on later refetches because that would clobber in-progress edits;
  // a successful save invalidates the query and we re-hydrate with
  // the server's normalized values.
  useEffect(() => {
    if (!profileQ.data || hydrated) return;
    setDisplayName(profileQ.data.displayName ?? "");
    setBio(profileQ.data.bio ?? "");
    setHydrated(true);
  }, [profileQ.data, hydrated]);

  const onSave = () => {
    updateM.mutate(
      {
        displayName: displayName.trim() === "" ? null : displayName.trim(),
        bio: bio.trim() === "" ? null : bio.trim(),
      },
      {
        onSuccess: async (saved) => {
          showToast("Profile saved");
          queryClient.setQueryData(getMyProfileQueryOptions.queryKey, saved);
          setDisplayName(saved.displayName ?? "");
          setBio(saved.bio ?? "");
          await queryClient.invalidateQueries({ queryKey: getSessionQueryOptions.queryKey });
        },
        onError: (e) => showToast(e instanceof Error ? e.message : "Could not save profile"),
      },
    );
  };

  const onCroppedSubmit = async (croppedImage: Blob) => {
    setIsCropperOpen(false);
    let imageDataUrl: string;
    try {
      const normalized = await normalizeAvatarBlob(croppedImage);
      imageDataUrl = await blobToDataUrl(normalized);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not prepare avatar");
      return;
    }
    uploadAvatarM.mutate(
      { imageDataUrl },
      {
        onSuccess: async (saved) => {
          showToast("Avatar updated");
          queryClient.setQueryData(getMyProfileQueryOptions.queryKey, saved);
          // The session payload caches `user.image` from the same
          // profile record; invalidate so the navbar / anything else
          // reading `getSessionQueryOptions` picks up the new URL on
          // its next render.
          await queryClient.invalidateQueries({ queryKey: getSessionQueryOptions.queryKey });
        },
        onError: (e) => showToast(e instanceof Error ? e.message : "Could not upload avatar"),
      },
    );
  };

  const profile = profileQ.data ?? null;
  const handle = profile?.handle ?? null;
  const avatarUrl = profile?.avatarUrl ?? null;
  const initial = (displayName || handle || did || "U").charAt(0).toUpperCase();
  const avatarAlt = `${displayName || handle || did || "User"} avatar`;
  const bioCount = bio.length;

  return (
    <Card size="md">
      <CardHeader hasBorder>
        <CardTitle style={styles.cardTitleMono}>Profile</CardTitle>
        <CardDescription style={styles.cardDescription}>
          Your co/core-side profile. Auto-provisioned from your Bluesky profile on first sign-in;
          edits here only affect co/core — your bsky profile is untouched.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {!did ? (
          <SmallBody>Sign in to view your profile.</SmallBody>
        ) : profileQ.isLoading ? (
          <SmallBody>Loading…</SmallBody>
        ) : profileQ.isError ? (
          <Alert variant="critical" title="Could not load profile">
            <Body>
              {profileQ.error instanceof Error ? profileQ.error.message : "Unknown error"}
            </Body>
          </Alert>
        ) : (
          <Flex direction="column" gap="2xl">
            <div {...stylex.props(styles.identityRow)}>
              <FileDropZone
                acceptedFileTypes={["image/*"]}
                onAddFiles={(files) => {
                  const file = files[0];
                  if (!file) return;
                  setPickedImage(file);
                  setIsCropperOpen(true);
                }}
                isDisabled={uploadAvatarM.isPending}
                style={styles.avatarDropZone}
              >
                <AvatarButton
                  size="xl"
                  src={avatarUrl ?? undefined}
                  alt={avatarAlt}
                  fallback={initial}
                />
                <div {...stylex.props(styles.cameraIcon)}>
                  <Camera size={24} />
                </div>
                <FileDropDefaultTrigger aria-label="Upload new avatar" />
              </FileDropZone>

              <ImageCropperDialog
                aspectRatio={1}
                image={pickedImage}
                isOpen={isCropperOpen}
                onOpenChange={setIsCropperOpen}
                onSubmit={(cropped) => {
                  void onCroppedSubmit(cropped);
                }}
              />

              <Flex direction="column" gap="4xl" style={styles.identityText}>
                {handle ? <Body>@{handle}</Body> : null}
                {did ? (
                  <SmallBody style={styles.didText}>
                    <InlineCode>{did}</InlineCode>
                  </SmallBody>
                ) : null}
              </Flex>
            </div>
            <TextField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              size="lg"
              placeholder="How you want to appear in co/core"
            />
            <TextArea
              label="Bio"
              size="lg"
              value={bio}
              onChange={(value) =>
                setBio(value.length > BIO_MAX_LENGTH ? value.slice(0, BIO_MAX_LENGTH) : value)
              }
              maxLength={BIO_MAX_LENGTH}
              placeholder="A short note about you or this machine"
              description={`${String(bioCount)}/${String(BIO_MAX_LENGTH)} characters.`}
            />
            {updateM.isError ? (
              <Alert variant="critical" title="Could not save profile">
                <Body>
                  {updateM.error instanceof Error ? updateM.error.message : String(updateM.error)}
                </Body>
              </Alert>
            ) : null}
            {uploadAvatarM.isError ? (
              <Alert variant="critical" title="Could not upload avatar">
                <Body>
                  {uploadAvatarM.error instanceof Error
                    ? uploadAvatarM.error.message
                    : String(uploadAvatarM.error)}
                </Body>
              </Alert>
            ) : null}
            <Flex direction="row" gap="md">
              <Button variant="primary" size="sm" isDisabled={updateM.isPending} onPress={onSave}>
                {updateM.isPending ? "Saving…" : "Save profile"}
              </Button>
            </Flex>
          </Flex>
        )}
      </CardBody>
    </Card>
  );
}
