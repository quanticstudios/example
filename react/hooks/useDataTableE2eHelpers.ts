import { useEffect } from "react";

import { GridCellKind, Rectangle } from "@glideapps/glide-data-grid";

import { DataTableColumn, DataTableE2eHelpers, EditListItems } from "@src/types/table";

type DataTableE2eHelperArgs<T> = {
  clickCell: (location: [number, number], isShiftKey: boolean) => void;
  columns: DataTableColumn<T>[];
  editCell: (editListItems: EditListItems) => void;
  enhancedData: T[];
  records: T[];
  selectedRecords: number[];
  selectRecords?: (records: T[], shouldToggleRow: boolean, clickedRecord?: T) => void;
  setFilterMenu: (menuLocation: { bounds: Rectangle; col: number }) => void;
  tableWrapperRef: React.RefObject<HTMLDivElement>;
};

interface DataTableWrapper<T> extends HTMLDivElement {
  helpers: DataTableE2eHelpers<T>;
}

const useDataTableE2eHelpers = <T extends { id: number; name: string }>({
  clickCell,
  columns,
  editCell,
  enhancedData,
  records,
  selectedRecords,
  selectRecords,
  setFilterMenu,
  tableWrapperRef,
}: DataTableE2eHelperArgs<T>) => {
  useEffect(() => {
    const helpers: DataTableE2eHelpers<T> = {
      clickCell: (location: [number, number], isShiftKey = false) => {
        clickCell(location, isShiftKey);
      },
      editCell: (location: [number, number], value: string) => {
        const [col] = location;
        const { kind } = columns[col];

        editCell([
          {
            location,
            // @ts-ignore
            value: {
              allowOverlay: true,
              copyData: value,
              data: kind === GridCellKind.Custom ? { value } : value,
              kind,
            },
          },
        ]);
      },
      getRecordAtIndex: (index: number) => records[index],
      getRecordIndex: (recordName: string) => records.findIndex((record) => record.name === recordName),
      getSelectedRecords: () => {
        return selectedRecords;
      },
      selectRecord: (index: number) => {
        if (selectRecords && enhancedData[index]) selectRecords([enhancedData[index]], false, enhancedData[index]);
      },
      toggleFilter: (columnId: string) => {
        const columnIndex = columns.findIndex(({ id }) => columnId === id);

        if (columnIndex === -1) {
          console.error(`Could not toggle filter for column with ID '${columnId}'`);
          return;
        }

        setFilterMenu({ col: columnIndex, bounds: { height: 0, width: 0, x: 0, y: 0 } });
      },
    };

    if (tableWrapperRef.current) {
      (tableWrapperRef.current as DataTableWrapper<T>).helpers = helpers;
    }
  }, [clickCell, columns, editCell, enhancedData, records, selectRecords, setFilterMenu, tableWrapperRef]);
};

export default useDataTableE2eHelpers;
