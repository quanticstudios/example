import useDataTableE2eHelpers from "./hooks/useDataTableE2eHelpers";

import fpSet from "lodash/fp/set";
import get from "lodash/get";
import isEqual from "lodash/isEqual";
import keyBy from "lodash/keyBy";
import omit from "lodash/omit";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import styled, { useTheme } from "styled-components";

import DataEditor, {
  CellClickedEventArgs,
  CompactSelection,
  GridCell,
  GridCellKind,
  GridColumn,
  GridKeyEventArgs,
  GridMouseEventArgs,
  GridSelection,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";

import ConfirmationModal from "@src/components/ConfirmationModal";
import WaveLoader from "@src/components/WaveLoader";
import WaveTableMenu from "@src/components/WaveTable/WaveTableMenu";
import { ChevronUp, ChevronDown } from "@src/components/WaveTable/Icons";
import { VisualsSelectionBehavior } from "@src/components/visuals/SelectionBehaviorSwitch";
import { selectedConfirmationModalProps, selectedTableSize } from "@src/recoil";
import { useTableTheme } from "@src/styleguide/table";
import { DataTableColumn, EditItem, EditListItems } from "@src/types/table";

import Manage from "./Manage";
import DatePickerCell from "./cells/DatePickerCell";
import DropdownCell from "./cells/DropdownCell";
import NameCell from "./cells/NameCell";
import OutflowCell from "./cells/OutflowCell";
import StatusCell from "./cells/StatusCell";
import TagsCell from "./cells/TagsCell";
import useEnhancedData from "./hooks/useEnhancedData";
import useRowSelection from "./hooks/useRowSelection";
import useSortByColumn from "./hooks/useSortByColumn";
import { getCellData, getEditedCellData, getFormattedGridCell } from "./utils/cells";
import { exportTableAsCsv } from "./utils/export";
import { WaveTableTypes } from "@src/components/WaveTable/types";

const headerIcons = {
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
};

const StyledHeader = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.color("grey700")};
  line-height: 120%;
  padding: 16px 0px 16px 16px;
`;

const StyledTitle = styled.div`
  color: ${({ theme }) => theme.color("white", "grey800")};
  font-size: 16px;
  font-weight: 500;
  line-height: 120%;
  margin: 0;
`;

const StyledWrapper = styled.div`
  position: relative;
  flex-wrap: wrap;
  height: 80%;
  width: 100%;

  .data-editor {
    &::-webkit-scrollbar-thumb {
      border-radius: 6px;
      border: 1px solid #707070;
    }

    &::-webkit-scrollbar-thumb:hover {
      border: 1px solid #909090;
      background-color: #404040;
      cursor: pointer;
    }
  }
`;

const StyledSpinnerContainer = styled.div`
  left: 50%;
  position: absolute;
  top: 50%;
`;

type Props<T> = {
  columnConfigKey: string;
  columns: DataTableColumn<T>[] | WaveTableTypes[];
  customColumnSorters?: ((columnId: string, data: T[]) => T[])[];
  data: T[];
  defaultColumns: DataTableColumn<T>[];
  editable?: boolean;
  editingOutside?: boolean;
  externalSearch?: string;
  /**
   * HACK: there are situations where we do not have the data prop fully updated with the pre-edited values of the table.
   * by always updating the localData state with the latest value of data, we are able to temporarily bypass this issue for now.
   *
   * the long-term solution is to figure out how to properly communicate changes between DataTable and the consumer as edits
   * are being made, and as changes are coming in from the outside.
   */
  hackyAllowDataOverrideDuringEditing?: boolean;
  isFilterVisible?: boolean;
  isLockerVisible?: boolean;
  isManageVisible?: boolean;
  isSearchVisible?: boolean;
  isToggleVisible?: boolean;
  loading?: boolean;
  onChangeEditing?: (editing: boolean) => void;
  onColumnResize?: () => void;
  onDataEdited?: (newValue: string | number, columnId: string, record: T, location: [number, number]) => void;
  onExportTable?: () => void;
  onSelectionBehaviorChange?: (behavior: VisualsSelectionBehavior) => void;
  onSelectionChange?: (selectedItems: T[], shouldToggleRow: boolean, clickedRecord?: T) => void;
  position?: "relative" | "absolute";
  right?: number;
  rowMarkers?: "checkbox" | "number" | "clickable-number" | "both" | "none";
  rowSelectionMode?: "auto" | "multi";
  searchText?: string;
  selectedDataIds?: number[];
  selectionBehavior?: VisualsSelectionBehavior;
  setEditingOutside?: React.Dispatch<React.SetStateAction<boolean>>;
  title?: string;
};

const DataTable = <T extends { name: string; id: number }>({
  columnConfigKey,
  columns,
  data,
  defaultColumns,
  editable = false,
  editingOutside,
  externalSearch,
  hackyAllowDataOverrideDuringEditing,
  isFilterVisible = true,
  isLockerVisible = true,
  isManageVisible = true,
  isSearchVisible = true,
  isToggleVisible = true,
  loading,
  onChangeEditing,
  onDataEdited,
  onExportTable,
  onSelectionBehaviorChange,
  onSelectionChange,
  position,
  right,
  rowMarkers,
  rowSelectionMode = "auto",
  searchText: searchTextOutside,
  selectedDataIds = [],
  selectionBehavior,
  setEditingOutside,
  title,
}: Props<T>) => {
  const tableTheme = useTableTheme();
  const theme = useTheme();

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const tableSize = useRecoilValue(selectedTableSize);
  const { type: modalType } = useRecoilValue(selectedConfirmationModalProps);

  const [localColumns, setLocalColumns] = useState(columns);
  const [localData, setLocalData] = useState(data);
  const [searchTextInternal, setSearchText] = useState("");
  const [filterMenu, setFilterMenu] = useState<{ bounds: Rectangle; col: number }>();
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [internalEditing, setInternalEditing] = useState(false);
  const [hoverRow, setHoverRow] = useState<number>();

  const searchText = searchTextOutside ?? searchTextInternal;

  const editing = editingOutside ?? internalEditing;

  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  const { clearSorting, sortByColumn, sortingEnhancedColumns, sortingEnhancedData } = useSortByColumn({
    columns: localColumns,
    data: localData,
    editing: editing,
  });

  const enhancedData = useEnhancedData({
    columns: sortingEnhancedColumns,
    data: sortingEnhancedData,
    filters,
    searchText: searchText,
  });

  // this logic here means that existing rows are not updated when in editing mode.
  // TODO – update this to support updating existing rows in an intelligent manner when in editing mode.
  useEffect(() => {
    if (!editing || hackyAllowDataOverrideDuringEditing) {
      setLocalData(data);
      return;
    }

    setLocalData((prev) => {
      const prevById = keyBy(prev, "id");

      return data.map((record) => {
        const previousRecord = prevById[record.id];
        if (previousRecord) return previousRecord;

        return record;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hackyAllowDataOverrideDuringEditing]);

  useEffect(() => {
    setLocalColumns(
      (prev) =>
        columns?.map((column) => {
          const localColumn = prev?.find((localColumn) => column.id === localColumn.id) ?? column;
          return { ...localColumn, inactive: column.inactive };
        }),
    );
  }, [columns]);

  useEffect(() => {
    if (externalSearch) {
      setSearchText(externalSearch);
    }
  }, [externalSearch]);

  useEffect(() => {
    setGridSelection((prev) => {
      const enhancedDataMapToIndex = enhancedData.reduce(
        (map, dataItem, index) => {
          map[dataItem.id] = index;

          return map;
        },
        {} as Record<number, number>,
      );

      const newRowIndexes = selectedDataIds
        .map((id) => enhancedDataMapToIndex[id])
        .filter((index) => index !== undefined);

      const existingSelection = prev.rows.toArray();

      if (isEqual(new Set(newRowIndexes), new Set(existingSelection))) return prev;

      const newRowSelection = newRowIndexes.reduce(
        (selection, rowIndex) => selection.add(rowIndex),
        CompactSelection.empty(),
      );

      return { ...prev, rows: newRowSelection };
    });
  }, [enhancedData, selectedDataIds]);

  useEffect(() => {
    if (typeof editingOutside === "boolean") {
      handleChangeEditing(editingOutside);
    }
  }, [editingOutside]);

  const getCellContent = useCallback(
    ([col, row]: readonly [number, number]): GridCell => {
      if (!enhancedData[row] || !sortingEnhancedColumns[col]) {
        return {
          allowOverlay: false,
          data: "",
          displayData: "",
          kind: GridCellKind.Text as const,
        };
      }

      const gridCell = getFormattedGridCell<T>({
        column: sortingEnhancedColumns[col],
        isEditing: editing,
        rowData: enhancedData[row],
        tableSize,
        theme,
      });

      return gridCell;
    },
    [editing, enhancedData, sortingEnhancedColumns, tableSize, theme],
  );

  const { selectCellRow, updateIfSelectAllRows } = useRowSelection({
    data: enhancedData,
    gridSelection,
    setGridSelection,
  });

  const handleCellClicked = (cell: Item, event: CellClickedEventArgs) => {
    const isCheckbox = cell[0] === -1;

    if (editing && !isCheckbox) {
      onSelectionChange?.([], isCheckbox);
      return;
    }

    const selectedData = selectCellRow(cell, event.shiftKey);
    const shouldToggleRow = isCheckbox && !event.shiftKey;

    if (selectedData) onSelectionChange?.(selectedData, shouldToggleRow, enhancedData[cell[1]]);
  };

  const handleGridSelectionChange = (newSelection: GridSelection | undefined) => {
    if (!newSelection) return;

    if (editing && newSelection.rows.length === 0 && newSelection.current !== undefined) {
      setGridSelection(newSelection);
      return;
    }

    const selectedData = updateIfSelectAllRows(newSelection);
    if (selectedData) onSelectionChange?.(selectedData, false);
  };

  const handleHeaderMenuClick = (col: number, bounds: Rectangle) => {
    setFilterMenu({ col, bounds });
  };

  const handleItemHovered = useCallback(({ kind, location }: GridMouseEventArgs) => {
    setHoverRow(kind === "cell" ? location[1] : undefined);
  }, []);

  const handleKeyDown = (event: GridKeyEventArgs) => {
    if (!editing || (event.key !== "Delete" && event.key !== "Backspace") || !gridSelection.current) return;

    const { range } = gridSelection.current;
    const { height, width, x, y } = range;

    const edits: EditItem[] = [];

    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        const gridCell = getCellContent([x + j, y + i]);

        if (!gridCell.allowOverlay || gridCell.kind !== GridCellKind.Custom) return;

        edits.push({
          location: [x + j, y + i],
          // @ts-ignore
          value: {
            allowOverlay: true,
            copyData: "",
            data: gridCell.kind === GridCellKind.Custom ? { value: "" } : "",
            kind: gridCell.kind,
          },
        });
      }
    }

    handleCellsEdited(edits);
  };

  const getRowThemeOverride = useCallback(
    (row: number) => (row !== hoverRow ? undefined : { bgCell: theme.color("blueHover", "blue100") }),
    [hoverRow, theme],
  );

  const handleSetFilters = (filter: { [key: string]: string[] }) => {
    setFilters((prev) => ({ ...prev, ...filter }));
  };

  const currentFilterValues = useMemo(() => {
    if (!filterMenu) return [];

    const column = sortingEnhancedColumns[filterMenu.col];

    const filtersExcludingCurrentColumn = omit(filters, [column.id]) as Record<string, string[]>;

    const values = localData.flatMap((record) => {
      const shouldKeep = Object.entries(filtersExcludingCurrentColumn).every(([columnId, filterItems]) => {
        const filterColumn = sortingEnhancedColumns.find(({ id }) => id === columnId);
        if (!filterColumn) return false;

        const content = getCellData(filterColumn, record);

        if (content === "" && filterItems.includes("Empty")) return true;
        if (!filterItems.includes(content)) return false;

        return true;
      });

      if (!shouldKeep) return [];

      return getCellData(column, record) || [];
    });

    return Array.from(new Set(values));
  }, [filterMenu, sortingEnhancedColumns, filters, localData]);

  const handleCellsEdited = useCallback(
    (editListItems: EditListItems) => {
      const edits = new Map<T, T>();

      // If the table is read-only, we do not make the update.
      if (!onDataEdited) {
        return;
      }

      editListItems.forEach((editListItem) => {
        const { location, value: newGridCell } = editListItem;
        const [col, row] = location;

        const column = sortingEnhancedColumns[col];
        const editedRecord = enhancedData[row];
        const { value } = getEditedCellData(newGridCell);
        const newValue = value?.toString() ?? "";

        // Skip the update if the value is not of a valid type
        if (column.validator && !column.validator(newValue, editedRecord)) {
          return;
        }

        // Skip the update if we are expecting a number, but the new value is not one
        if (column.kind === GridCellKind.Number && newValue.trim() !== "" && isNaN(parseInt(newValue, 10))) {
          return;
        }

        const currentRecord = edits.get(editedRecord) ?? editedRecord;
        const currentValue = get(currentRecord, column.id);

        if (currentValue === newValue) return;

        const formattedValue = (() => {
          if (column.kind === GridCellKind.Number) {
            return parseFloat(newValue);
          }

          return newValue;
        })();

        const record = edits.get(editedRecord) ?? editedRecord;

        onDataEdited?.(formattedValue, column.id, record, [col, row]);

        edits.set(
          editedRecord,
          column.getUpdatedRecord?.(newValue, currentRecord) ?? fpSet(column.id, value, currentRecord),
        );
      });

      /*
        There is a bug where updating local state with setLocalData causes the table to lose focus.
        Placing the state update call inside a setTimeout with a timer of 0 will reorder the call stack
        to ensure that this is called in the correct order.
      */
      const updateStateCallback = () => setLocalData((prev) => prev.map((record) => edits.get(record) ?? record));
      setTimeout(() => {
        updateStateCallback();
      }, 0);
    },
    [enhancedData, onDataEdited, sortingEnhancedColumns],
  );

  const handlePaste = useCallback(
    (_: any, copiedValues: readonly (readonly string[])[]) => {
      if (editing && gridSelection.rows.length > 0) return false;
      if (!gridSelection.current || !editing) return true;

      /**
       * the logic we're using here is a mirror of that which is present in Excel. it is as follows:
       *
       * 1. if the grid selection is a perfect multiple of the copied value, fill in the grid selection perfectly
       * 2. if the grid selection has a width or height of 1 and the other dimension is a perfect multiple of the
       *    corresponding dimension in the copied value, fill in the grid selection along that dimension
       * 3. if the grid selection is not a perfect multiple of the copied value, only set the copied value once
       *    from the top left corner (startX and startY)
       */

      const copiedValuesWidth = copiedValues[0].length;
      const copiedValuesHeight = copiedValues.length;
      const gridSelectionWidth = gridSelection.current.range.width;
      const gridSelectionHeight = gridSelection.current.range.height;

      const shouldFillSelection =
        (gridSelectionWidth === 1 || gridSelectionWidth % copiedValuesWidth === 0) &&
        (gridSelectionHeight === 1 || gridSelectionHeight % copiedValuesHeight === 0);

      const newData: EditItem[] = [];
      const startX = gridSelection.current.range.x;
      const startY = gridSelection.current.range.y;

      const xRepeat = !shouldFillSelection || gridSelectionWidth === 1 ? 1 : gridSelectionWidth / copiedValuesWidth;
      const yRepeat = !shouldFillSelection || gridSelectionHeight === 1 ? 1 : gridSelectionHeight / copiedValuesHeight;

      for (let xRepeatCount = 0; xRepeatCount < xRepeat; xRepeatCount++) {
        for (let yRepeatCount = 0; yRepeatCount < yRepeat; yRepeatCount++) {
          copiedValues.forEach((valueRow, rowIndex) => {
            valueRow.forEach((value, colIndex) => {
              const row = startY + yRepeatCount * copiedValuesHeight + rowIndex;
              const col = startX + xRepeatCount * copiedValuesWidth + colIndex;

              const column = sortingEnhancedColumns[col];
              const { kind } = column;
              const readOnly = column.getIsReadonly?.(enhancedData[row]) ?? false;

              if (readOnly) return;

              newData.push({
                location: [col, row],
                // @ts-ignore
                value: {
                  allowOverlay: true,
                  copyData: value,
                  data: kind === GridCellKind.Custom ? { value } : value,
                  kind,
                },
              });
            });
          });
        }
      }

      handleCellsEdited(newData);

      return false;
    },
    [editing, gridSelection, handleCellsEdited, sortingEnhancedColumns],
  );

  const handleColumnResize = (gridColumn: GridColumn, width: number) => {
    setLocalColumns((prev) => prev?.map((column) => (column.id === gridColumn.id ? { ...column, width } : column)));
  };

  const handleModalConfirm = () => {
    switch (modalType) {
      case "DISCARD": {
        setLocalData(data);
        break;
      }
    }
  };

  const handleChangeEditing = (newEditing: boolean) => {
    setInternalEditing(newEditing);
    onChangeEditing?.(newEditing);

    if (!newEditing) setGridSelection({ ...gridSelection, current: undefined });
  };

  const manageClearFilters = () => {
    setFilters({});
    setSearchText("");
  };
  /*
      TODO: add this check back in
      We experienced issues where this did not evaluate as expected in CI, and the helpers were never attached.
      Need to investigate more on the root cause for that, but disabling now as this will not impact the user experience.
  */
  // if (isE2e())
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useDataTableE2eHelpers({
    clickCell: selectCellRow,
    columns: sortingEnhancedColumns,
    editCell: handleCellsEdited,
    enhancedData,
    records: localData,
    setFilterMenu,
    selectedRecords: gridSelection.rows.toArray(),
    selectRecords: onSelectionChange,
    tableWrapperRef,
  });

  const handleExportTable = () => {
    exportTableAsCsv(enhancedData, sortingEnhancedColumns);
  };

  return (
    <StyledWrapper data-testid="data-table-wrapper" ref={tableWrapperRef}>
      {title ? (
        <StyledHeader>
          <StyledTitle>{title}</StyledTitle>
        </StyledHeader>
      ) : null}
      {editable ? <ConfirmationModal onConfirm={handleModalConfirm} /> : null}
      <Manage
        clearColumnFilters={manageClearFilters}
        columnConfigKey={columnConfigKey}
        columns={columns}
        defaultColumns={defaultColumns}
        editable={editable}
        editing={editing}
        isFilterVisible={isFilterVisible}
        isLockerVisible={isLockerVisible}
        isManageVisible={isManageVisible}
        isSearchVisible={isSearchVisible}
        isToggleVisible={isToggleVisible}
        onChangeEditing={handleChangeEditing}
        onSelectionBehaviorChange={onSelectionBehaviorChange}
        openExportsModal={handleExportTable}
        position={position}
        right={right}
        searchTextState={[searchText, setSearchText]}
        selectionBehavior={selectionBehavior}
      />
      <DataEditor
        className="data-editor"
        columns={sortingEnhancedColumns}
        customRenderers={[DatePickerCell, DropdownCell, NameCell, OutflowCell, StatusCell, TagsCell]}
        freezeColumns={1}
        getCellContent={getCellContent}
        getCellsForSelection
        getRowThemeOverride={getRowThemeOverride}
        gridSelection={gridSelection}
        headerHeight={tableSize}
        headerIcons={headerIcons}
        isDraggable="cell"
        onCellClicked={handleCellClicked}
        // onCellEdited={handleCellEdited}
        onCellsEdited={handleCellsEdited}
        // onColumnMoved={(fromIndex, toIndex) => handleColumnMoved(fromIndex, toIndex)}
        onColumnResize={handleColumnResize}
        // onDelete={(grid) => {
        //   const col = grid.current?.cell[0];
        //   if (col !== undefined) {
        //     return handleDelete(col);
        //   }
        //   return false;
        // }}
        onGridSelectionChange={handleGridSelectionChange}
        onGroupHeaderClicked={clearSorting}
        onHeaderClicked={sortByColumn}
        onHeaderMenuClick={handleHeaderMenuClick}
        onItemHovered={handleItemHovered}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        overscrollX={0}
        onDragStart={(event) => event.setData("text/plain", "Drag data here!")}
        rowHeight={tableSize}
        rowMarkers={rowMarkers ?? "both"}
        rowMarkerTheme={{ accentColor: theme.colors.skyBlue.skyBlue }}
        rowSelectionMode={rowSelectionMode}
        rows={enhancedData.length}
        smoothScrollX
        smoothScrollY
        theme={tableTheme}
      />
      <WaveTableMenu
        columnKey={filterMenu ? sortingEnhancedColumns[filterMenu.col].id : ""}
        checkboxValues={currentFilterValues}
        filter={(filterMenu && filters[sortingEnhancedColumns[filterMenu.col].id]) ?? []}
        handleClose={() => setFilterMenu(undefined)}
        handleSetFilters={handleSetFilters}
        isDate={(filterMenu && sortingEnhancedColumns[filterMenu.col].isDatePicker) ?? false}
        menu={filterMenu}
      />
      {loading && (
        <StyledSpinnerContainer>
          <WaveLoader />
        </StyledSpinnerContainer>
      )}
    </StyledWrapper>
  );
};

export default DataTable;
