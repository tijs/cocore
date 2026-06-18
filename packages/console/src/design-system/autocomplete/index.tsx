"use client";

import type {
  AutocompleteProps as AriaAutocompleteProps,
  ListBoxProps,
  ValidationResult,
} from "react-aria-components";

import * as stylex from "@stylexjs/stylex";
import { DismissButton, mergeProps, Overlay, useOverlayTrigger, usePopover } from "react-aria";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Autocomplete as AriaAutocomplete } from "react-aria-components";
import { useOverlayTriggerState } from "react-stately";

import type {
  InputValidationState,
  InputVariant,
  Size,
  StyleXComponentProps,
} from "../theme/types";

import { SizeContext } from "../context";
import { ListBox } from "../listbox";
import { TextField } from "../text-field";
import { usePopoverStyles } from "../theme/usePopoverStyles";

const styles = stylex.create({
  wrapper: {
    position: "relative",
  },
});

/**
 * Props for the AutocompleteInput component.
 * Combines text input with a dropdown list of suggestions.
 */
export interface AutocompleteInputProps<T extends object>
  extends
    StyleXComponentProps<Omit<AriaAutocompleteProps<T>, "children" | "isInvalid">>,
    Pick<ListBoxProps<T>, "renderEmptyState"> {
  /** Label for the text field. */
  label?: React.ReactNode;
  /** Screen-reader label for the input when no visible `label` is used. */
  ariaLabel?: string;
  /** Description text shown below the input. */
  description?: string;
  /** Error message or function returning message from validation. */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** Items to display in the suggestions list. */
  items?: Iterable<T>;
  /** Render function or content for each list item. */
  children: React.ReactNode | ((item: T) => React.ReactNode);
  /** Size of the input and list items. */
  size?: Size;
  /** Visual variant of the input. */
  variant?: InputVariant;
  /** Validation state override. */
  validationState?: InputValidationState;
  /** Placeholder text when the input is empty. */
  placeholder?: string;
  /** Content to render before the input. */
  prefix?: React.ReactNode;
  /** Content to render after the input. */
  suffix?: React.ReactNode;
  /** Callback when an item is selected. */
  onAction?: (item: string) => void;
  /** Disable the text field (suggestions stay driven by `items`). */
  isDisabled?: boolean;
  /**
   * When true: suggestions are not client-filtered (use when the server already
   * narrowed `items`), the list never shows an empty-state row, and Enter does
   * not commit the typed string or auto-pick the first row — only an explicit
   * list choice (click / typeahead highlight + Enter) fires `onAction`.
   */
  popoverSelectionOnly?: boolean;
}

export function AutocompleteInput<T extends object>({
  label,
  ariaLabel,
  description,
  errorMessage,
  children,
  items,
  style,
  size: sizeProp,
  variant,
  validationState,
  placeholder,
  prefix,
  suffix,
  onAction,
  renderEmptyState,
  popoverSelectionOnly = false,
  isDisabled,
  ...props
}: AutocompleteInputProps<T>) {
  const size = sizeProp || use(SizeContext);
  const popoverStyles = usePopoverStyles();
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [allowOpen, setAllowOpen] = useState(true);
  const [triggerWidthPx, setTriggerWidthPx] = useState<number | null>(null);

  const inputTrimmed = (props.inputValue ?? "").trim();
  const itemList = items ? [...items] : [];
  const firstItem = itemList[0];
  const isOnlyMatch =
    itemList.length === 1 &&
    firstItem &&
    "handle" in firstItem &&
    (firstItem as { handle: string }).handle === inputTrimmed;
  /** Hide while empty so stale placeholder query rows cannot keep the portaled list open. */
  const hasItems = inputTrimmed.length > 0 && itemList.length > 0 && !isOnlyMatch;

  useEffect(() => {
    if (hasItems) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Sync with suggestion availability
      setAllowOpen(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
      setAllowOpen(false);
    }
  }, [hasItems]);

  const isOverlayOpen = Boolean(hasItems && allowOpen);
  const overlayState = useOverlayTriggerState({
    isOpen: isOverlayOpen,
    onOpenChange: setAllowOpen,
  });

  const { triggerProps, overlayProps } = useOverlayTrigger(
    { type: "listbox" },
    overlayState,
    triggerRef,
  );

  const isInsideCombo = (node: Node | null | undefined) =>
    !!(
      node instanceof Element &&
      (triggerRef.current?.contains(node) || popoverRef.current?.contains(node))
    );

  const { popoverProps } = usePopover(
    {
      triggerRef,
      popoverRef,
      placement: "bottom start",
      offset: 8,
      containerPadding: 8,
      isNonModal: true,
      shouldFlip: true,
      /** Keep open when focus moves between trigger and portaled menu; dismiss when leaving both. */
      shouldCloseOnInteractOutside: (element) => element != null && !isInsideCombo(element),
    },
    overlayState,
  );

  useLayoutEffect(() => {
    if (!overlayState.isOpen || !triggerRef.current) {
      setTriggerWidthPx(null);
      return;
    }
    const el = triggerRef.current;
    const measure = () => setTriggerWidthPx(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [overlayState.isOpen]);

  const handleBlurLeavingCombo = (e: React.FocusEvent) => {
    if (!overlayState.isOpen) return;
    const rt = e.relatedTarget;
    if (rt instanceof Element && isInsideCombo(rt)) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (isInsideCombo(active)) return;
      overlayState.close();
    });
  };

  const handleFocusCapture = () => {
    if (hasItems) {
      setAllowOpen(true);
    }
  };

  const handleAction = (key: React.Key) => {
    overlayState.close();
    onAction?.(String(key));
  };

  // Enter with no highlighted row: if there are no suggestion items, commit the
  // field text (e.g. pasted handle not in the index). If there are items,
  // keep typeahead completion by selecting the first row.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;

    const input = triggerRef.current?.querySelector("input");
    if (input?.getAttribute("aria-activedescendant")) return;

    const typed = inputTrimmed;
    const itemCount = itemList.length;

    if (popoverSelectionOnly) {
      e.preventDefault();
      return;
    }

    if (itemCount === 0) {
      if (typed === "") return;
      e.preventDefault();
      overlayState.close();
      onAction?.(typed);
      return;
    }

    if (!isOverlayOpen || !firstItem) return;

    const firstKey = (firstItem as { id?: React.Key }).id;
    if (firstKey == null) return;

    e.preventDefault();
    handleAction(firstKey);
  };

  const surfaceProps = mergeProps(
    stylex.props(popoverStyles.wrapper, popoverStyles.animation),
    popoverProps,
  );

  const emptyState =
    renderEmptyState ?? (popoverSelectionOnly ? () => null : () => "No results found.");

  return (
    <SizeContext value={size}>
      <AriaAutocomplete
        {...props}
        {...(popoverSelectionOnly ? { filter: () => true } : {})}
        {...stylex.props(style)}
      >
        <div
          ref={triggerRef}
          {...mergeProps(triggerProps, stylex.props(styles.wrapper))}
          onBlur={handleBlurLeavingCombo}
          onFocusCapture={handleFocusCapture}
          onKeyDown={handleKeyDown}
        >
          <TextField
            label={label}
            aria-label={ariaLabel}
            description={description}
            errorMessage={errorMessage}
            size={size}
            variant={variant}
            validationState={validationState}
            placeholder={placeholder}
            prefix={prefix}
            suffix={suffix}
            isDisabled={isDisabled}
          />

          {overlayState.isOpen ? (
            <Overlay>
              <div
                {...surfaceProps}
                ref={popoverRef}
                style={{
                  ...surfaceProps.style,
                  ...(triggerWidthPx != null
                    ? { width: triggerWidthPx, minWidth: triggerWidthPx, maxWidth: triggerWidthPx }
                    : {}),
                }}
                onBlur={handleBlurLeavingCombo}
              >
                <div {...overlayProps}>
                  <ListBox
                    items={items}
                    selectionMode="none"
                    renderEmptyState={emptyState}
                    onAction={handleAction}
                  >
                    {children}
                  </ListBox>
                </div>
                <DismissButton onDismiss={overlayState.close} />
              </div>
            </Overlay>
          ) : null}
        </div>
      </AriaAutocomplete>
    </SizeContext>
  );
}
