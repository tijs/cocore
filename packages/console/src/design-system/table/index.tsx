import type {
  CellProps as AriaCellProps,
  ColumnProps as AriaColumnProps,
  RowProps as AriaRowProps,
  TableBodyProps as AriaTableBodyProps,
  TableHeaderProps as AriaTableHeaderProps,
  TableProps as AriaTableProps,
  DropIndicatorProps,
} from "react-aria-components";
import type { ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";
import { ArrowDown, ArrowUp, ChevronRight, GripVertical } from "lucide-react";
import { use } from "react";
import { mergeProps, useHover } from "react-aria";
import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
  Collection,
  ColumnResizer,
  DropIndicator,
  TableLayout,
  Virtualizer,
  composeRenderProps,
  useTableOptions,
} from "react-aria-components";

import type { Size, StyleXComponentProps } from "../theme/types";

import { Checkbox } from "../checkbox";
import { SizeContext } from "../context";
import { Flex } from "../flex";
import { IconButton } from "../icon-button";
import { primaryColor, uiColor } from "../theme/color.stylex";
import {
  horizontalSpace,
  size as sizeSpace,
  verticalSpace,
} from "../theme/semantic-spacing.stylex";
import { LabelText } from "../typography";

const styles = stylex.create({
  table: {
    borderSpacing: 0,
  },
  tableHeader: {},
  row: {
    backgroundColor: {
      default: uiColor.bg,
      ":is([data-hovered])": uiColor.bgSubtle,
    },
    cursor: {
      ":is([data-href])": "pointer",
    },
  },
  column: {
    paddingBottom: 0,
    paddingLeft: 0,
    borderBottomColor: uiColor.border1,
    paddingRight: 0,
    borderBottomStyle: "solid",
    paddingTop: 0,
    borderBottomWidth: 1,
  },
  columnHeader: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    paddingLeft: {
      default: horizontalSpace["md"],
      ":is(:first-child > *)": horizontalSpace["sm"],
    },
  },
  columnHeaderSortable: {
    cursor: "pointer",
  },
  tableBody: {},
  cell: {
    overflow: "auto",
    borderBottomColor: uiColor.border1,
    borderBottomStyle: "solid",
    borderBottomWidth: {
      default: 1,
      ":is([role=row]:last-child *):not([role=presentation] > [role=gridcell]):not([role=presentation] > [role=rowheader])": 0,
    },
    height: {
      ":is([role=presentation] > [role=gridcell])": "100%",
    },
  },
  cellContent: {
    alignItems: "center",
    boxSizing: "border-box",
    display: "flex",
    opacity: {
      default: 1,
      ":is([aria-disabled=true] *)": 0.5,
    },
    textAlign: "left",
    minHeight: {
      default: sizeSpace["3xl"],
      ":is([data-table-size=lg] *)": sizeSpace["5xl"],
      ":is([data-table-size=md] *)": sizeSpace["4xl"],
    },
    paddingBottom: {
      default: verticalSpace["xs"],
      ":is([data-table-size=lg] *)": verticalSpace["md"],
      ":is([data-table-size=md] *)": verticalSpace["sm"],
    },
    paddingLeft: {
      default: horizontalSpace["3xl"],
      ":is([data-table-size=lg] *:not(:first-child))": horizontalSpace["2xl"],
      ":is([data-table-size=md] *:not(:first-child))": horizontalSpace["md"],
    },
    paddingRight: {
      default: horizontalSpace["3xl"],
      ":is([data-table-size=lg] *:not(:last-child))": horizontalSpace["2xl"],
      ":is([data-table-size=md] *:not(:last-child))": horizontalSpace["md"],
    },
    paddingTop: {
      default: verticalSpace["xs"],
      ":is([data-table-size=lg] *)": verticalSpace["md"],
      ":is([data-table-size=md] *)": verticalSpace["sm"],
    },
  },
  textEllipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  treeCellContent: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: horizontalSpace.sm,
    minHeight: "inherit",
  },
  resizer: {
    boxSizing: "border-box",
    cursor: {
      ":is([data-resizable-direction=both])": "ew-resize",
      ":is([data-resizable-direction=left])": "e-resize",
      ":is([data-resizable-direction=right])": "w-resize",
    },
    flexBasis: "auto",
    flexGrow: 0,
    flexShrink: 0,
    position: "relative",
    touchAction: "none",
    marginBottom: {
      default: `calc(${verticalSpace["xxs"]} * -1)`,
      ":is([data-table-size=lg] *)": `calc(${verticalSpace["md"]} * -1)`,
      ":is([data-table-size=md] *)": `calc(${verticalSpace["sm"]} * -1)`,
    },
    marginTop: {
      default: `calc(${verticalSpace["xxs"]} * -1)`,
      ":is([data-table-size=lg] *)": `calc(${verticalSpace["md"]} * -1)`,
      ":is([data-table-size=md] *)": `calc(${verticalSpace["sm"]} * -1)`,
    },
    minHeight: {
      default: sizeSpace["3xl"],
      ":is([data-table-size=lg] *)": sizeSpace["5xl"],
      ":is([data-table-size=md] *)": sizeSpace["4xl"],
    },
    width: sizeSpace["xxs"],
  },
  resizerLine: {
    backgroundColor: {
      default: uiColor.border1,
      ":is([data-hovered=true] *)": uiColor.border2,
      ":is([data-resizing=true] *)": uiColor.border3,
    },
    display: "block",
    position: "absolute",
    transform: "translateX(-50%)",
    bottom: 0,
    left: "50%",
    top: 0,
    width: sizeSpace["xxs"],
  },
  dropIndicator: {
    outlineColor: primaryColor.solid1,
    outlineStyle: "solid",
    outlineWidth: "1px",
  },
});

const estimatedRowHeights: Record<Size, number> = {
  sm: 24,
  md: 32,
  lg: 40,
};

export interface TableProps extends StyleXComponentProps<AriaTableProps> {
  size?: Size;
  isVirtualized?: boolean;
}

export const Table = ({ style, size: sizeProp, isVirtualized = false, ...props }: TableProps) => {
  const size = sizeProp || use(SizeContext);
  let table = (
    <AriaTable {...props} {...stylex.props(styles.table, style)} data-table-size={size} />
  );

  if (isVirtualized) {
    table = (
      <Virtualizer
        layout={TableLayout}
        layoutOptions={{
          estimatedRowHeight: estimatedRowHeights[size],
          headingHeight: estimatedRowHeights[size],
        }}
      >
        {table}
      </Virtualizer>
    );
  }

  return <SizeContext value={size}>{table}</SizeContext>;
};

export interface TableColumnProps extends StyleXComponentProps<Omit<AriaColumnProps, "children">> {
  children?: React.ReactNode;
  hasResizer?: boolean;
  hasEllipsis?: boolean;
  /** Merged after header `cellContent` + `columnHeader` (e.g. align first column with card padding). */
  headerContentStyle?: stylex.StyleXStyles;
}

export function TableColumn({
  style,
  children,
  hasResizer,
  hasEllipsis,
  headerContentStyle,
  ...props
}: TableColumnProps) {
  return (
    <AriaColumn {...props} {...stylex.props(styles.column, style)}>
      {({ allowsSorting, sortDirection }) => (
        <div {...stylex.props(styles.columnHeader, allowsSorting && styles.columnHeaderSortable)}>
          <div {...stylex.props(styles.cellContent, styles.columnHeader, headerContentStyle)}>
            <Flex align="center" gap="xs">
              <LabelText tabIndex={hasResizer ? -1 : undefined} hasEllipsis={hasEllipsis}>
                {children}
              </LabelText>
              {allowsSorting && (
                <span aria-hidden="true" className="sort-indicator">
                  {sortDirection === "ascending" ? (
                    <ArrowUp size={14} />
                  ) : sortDirection === "descending" ? (
                    <ArrowDown size={14} />
                  ) : null}
                </span>
              )}
            </Flex>
            {hasResizer && (
              <ColumnResizer {...stylex.props(styles.resizer)}>
                <div {...stylex.props(styles.resizerLine)} />
              </ColumnResizer>
            )}
          </div>
        </div>
      )}
    </AriaColumn>
  );
}

export interface TableHeaderProps<T extends object> extends StyleXComponentProps<
  AriaTableHeaderProps<T>
> {}

export function TableHeader<T extends object>({
  children,
  style,
  ...otherProps
}: TableHeaderProps<T>) {
  const { selectionBehavior, selectionMode, allowsDragging } = useTableOptions();

  return (
    <AriaTableHeader {...otherProps} {...stylex.props(styles.tableHeader, style)}>
      {/* Add extra columns for drag and drop and selection. */}
      {allowsDragging && <TableColumn minWidth={52} width={52} />}
      {selectionBehavior === "toggle" && (
        <TableColumn minWidth={40} width={40}>
          {selectionMode === "multiple" && <Checkbox slot="selection" />}
        </TableColumn>
      )}
      <Collection items={otherProps.columns}>{children}</Collection>
    </AriaTableHeader>
  );
}

export interface TableRowProps<T extends object> extends StyleXComponentProps<AriaRowProps<T>> {
  /** Nested table rows (e.g. React Aria tree / expandable rows). Rendered after row cells. */
  tree?: ReactNode;
}

export function TableRow<T extends object>({
  id,
  columns,
  children,
  style,
  tree,
  ...props
}: TableRowProps<T>) {
  const { selectionBehavior, allowsDragging } = useTableOptions();
  const { hoverProps, isHovered } = useHover({});

  return (
    <AriaRow
      id={id}
      {...mergeProps(props, hoverProps)}
      {...stylex.props(styles.row, style)}
      data-hovered={isHovered || undefined}
    >
      {allowsDragging && (
        <TableCell>
          <IconButton slot="drag" label="Reorder" variant="tertiary">
            <GripVertical size={16} />
          </IconButton>
        </TableCell>
      )}
      {selectionBehavior === "toggle" && (
        <TableCell>
          <Checkbox slot="selection" />
        </TableCell>
      )}
      <Collection items={columns}>{children}</Collection>
      {tree}
    </AriaRow>
  );
}

export interface TableBodyProps<T extends object> extends StyleXComponentProps<
  AriaTableBodyProps<T>
> {}

export function TableBody<T extends object>({ style, ...prop }: TableBodyProps<T>) {
  return <AriaTableBody {...prop} {...stylex.props(styles.tableBody, style)} />;
}

export interface TableCellProps extends StyleXComponentProps<Omit<AriaCellProps, "children">> {
  children?: React.ReactNode;
  /** Merged into the inner cell wrapper (overrides default alignment, etc.). */
  contentStyle?: stylex.StyleXStyles;
  hasEllipsis?: boolean;
}

export function TableCell({
  style,
  children,
  hasEllipsis,
  contentStyle,
  ...props
}: TableCellProps) {
  return (
    <AriaCell {...props} {...stylex.props(styles.cell, style)}>
      {composeRenderProps(children, (cellChildren, renderProps) => {
        const treeProps = renderProps as {
          hasChildItems?: boolean;
          isTreeColumn?: boolean;
          isExpanded?: boolean;
        };
        const showTreeChevron = Boolean(treeProps.hasChildItems && treeProps.isTreeColumn);
        return (
          <div
            {...stylex.props(
              styles.cellContent,
              hasEllipsis && styles.textEllipsis,
              showTreeChevron && styles.treeCellContent,
              contentStyle,
            )}
          >
            {showTreeChevron ? (
              <IconButton
                slot="chevron"
                variant="tertiary"
                size="sm"
                aria-label={treeProps.isExpanded ? "Collapse row" : "Expand row"}
              >
                <ChevronRight
                  aria-hidden
                  size={14}
                  style={{
                    transform: treeProps.isExpanded ? "rotate(90deg)" : undefined,
                    transition: "transform 0.15s ease",
                  }}
                />
              </IconButton>
            ) : null}
            {cellChildren}
          </div>
        );
      })}
    </AriaCell>
  );
}

export function TableDropIndicator(props: DropIndicatorProps) {
  return <DropIndicator {...props} {...stylex.props(styles.dropIndicator)} />;
}
