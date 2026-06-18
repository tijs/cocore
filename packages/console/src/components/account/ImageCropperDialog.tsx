"use client";

// Modal cropper for square avatars. Wraps the design-system ImageCropper
// with a zoom slider and save/cancel actions. Returns a cropped Blob via
// `onSubmit` once the user confirms — the caller is responsible for
// uploading it.

import * as stylex from "@stylexjs/stylex";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useState } from "react";

import type { ImageCropperRootProps } from "@/design-system/image-cropper";

import { Button } from "@/design-system/button";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/design-system/dialog";
import { Flex } from "@/design-system/flex";
import { ImageCropper } from "@/design-system/image-cropper";
import { Slider } from "@/design-system/slider";
import {
  gap as gapSpace,
  horizontalSpace,
  verticalSpace,
} from "@/design-system/theme/semantic-spacing.stylex";

const styles = stylex.create({
  cropper: { flexGrow: 1, minHeight: 0 },
  sliderWrapper: {
    boxSizing: "border-box",
    paddingLeft: horizontalSpace["3xl"],
    paddingRight: horizontalSpace["3xl"],
    width: "100%",
  },
  slider: {
    flexGrow: 1,
  },
  body: {
    gap: gapSpace["2xl"],
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    height: "min(420px, 70vh)",
    marginTop: 0,
    minHeight: 0,
  },
  description: {
    marginBottom: verticalSpace["3xl"],
    marginTop: verticalSpace["3xl"],
  },
});

export interface ImageCropperDialogProps extends Pick<ImageCropperRootProps, "aspectRatio"> {
  /** The image blob to crop. */
  image: Blob;
  /** Callback when the user submits the cropped image. */
  onSubmit: (image: Blob) => void;
  /** Optional trigger element for the dialog. */
  trigger?: React.ReactNode;
  /** Whether the dialog is open. */
  isOpen: boolean;
  /** Callback when the dialog open state changes. */
  onOpenChange: (isOpen: boolean) => void;
}

export function ImageCropperDialog({
  image,
  aspectRatio = 1,
  onSubmit,
  trigger,
  isOpen,
  onOpenChange,
}: ImageCropperDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [croppedImage, setCroppedImage] = useState<Blob | null>(null);

  return (
    <Dialog trigger={trigger} isOpen={isOpen} onOpenChange={onOpenChange}>
      <DialogHeader>Crop image</DialogHeader>
      <DialogDescription style={styles.description}>
        Choose the area of the image you want to use.
      </DialogDescription>
      <DialogBody style={styles.body}>
        <ImageCropper.Root
          image={image}
          aspectRatio={aspectRatio}
          style={styles.cropper}
          zoom={zoom}
          onZoomChange={setZoom}
          onCropChange={setCroppedImage}
          minZoom={0.2}
          maxZoom={5}
        >
          <ImageCropper.Description />
          <ImageCropper.Image />
          <ImageCropper.CropArea />
        </ImageCropper.Root>
        <Flex align="center" gap="2xl" style={styles.sliderWrapper}>
          <ZoomOutIcon size={18} />
          <Slider<number>
            minValue={0.2}
            maxValue={5}
            step={0.01}
            value={zoom}
            onChange={setZoom}
            showValueLabel={false}
            style={styles.slider}
          />
          <ZoomInIcon size={18} />
        </Flex>
      </DialogBody>
      <DialogFooter>
        <Button slot="close" variant="secondary" size="sm">
          Cancel
        </Button>
        <Button
          slot="close"
          size="sm"
          onPress={() => {
            if (croppedImage) {
              onSubmit(croppedImage);
            }
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
