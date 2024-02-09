import { compareAsc } from "date-fns";
import get from "lodash/get";
import { useCallback, useMemo, useRef, useState } from "react";

import { GridCellKind } from "@glideapps/glide-data-grid";

import { DataTableColumn } from "@src/types/table";

export enum SortDirection {
  ASC,
  DESC,
}

type SortOptions = {
  column: string;
  direction: SortDirection;
};

type UseSortByColumnsParams<T> = {
  columns: DataTableColumn<T>[];
  customColumnSort?: (record1: T, record2: T) => number;
  data: T[];
  editing: boolean;
};

const useSortByColumn = <T extends { id: number }>({ columns, data, editing }: UseSortByColumnsParams<T>) => {
  const prevSortedOrder = useRef<number[] | null>(null);
  const hasSortChanged = useRef(false);
  const [sorting, setSorting] = useState<SortOptions | null>(null);

  const clearSorting = useCallback(() => setSorting(null), []);

  const sortingEnhancedColumns = useMemo(
    () =>
      columns.flatMap((column) => {
        if (column.inactive) return [];

        if (sorting && column.id === sorting.column) {
          const icon = sorting.direction === SortDirection.ASC ? "chevronDown" : "chevronUp";
          return { ...column, icon };
        }

        return column;
      }),
    [columns, sorting],
  );

  const sortByColumn = useCallback(
    (colIndex: number) => {
      hasSortChanged.current = true;

      const columnId = sortingEnhancedColumns[colIndex].id;

      if (sorting && sorting.column === columnId) {
        const newDirection = sorting.direction === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC;
        setSorting({ ...sorting, direction: newDirection });

        return;
      }

      setSorting({ column: columnId, direction: SortDirection.ASC });
    },
    [sorting, sortingEnhancedColumns],
  );

  const sortingEnhancedData = useMemo(() => {
    const sortingColumnConfig = columns.find((column) => column.id === sorting?.column);

    if (!sorting || !sortingColumnConfig) return data;

    if (editing && prevSortedOrder.current && !hasSortChanged.current) {
      return prevSortedOrder.current
        .map((recordId) => data.find((record) => record.id === recordId))
        .filter(Boolean) as T[];
    }

    const { customSorter } = sortingColumnConfig;

    if (customSorter) {
      return [...data].sort((record1, record2) => customSorter(record1, record2, sorting.direction));
    }

    if (sortingColumnConfig.kind === GridCellKind.Number) {
      return [...data].sort((record1, record2) => {
        const data1 = (sortingColumnConfig.getValue?.(record1) ?? get(record1, sortingColumnConfig.id, null)) as
          | number
          | null;

        const data2 = (sortingColumnConfig.getValue?.(record2) ?? get(record2, sortingColumnConfig.id, null)) as
          | number
          | null;

        if (data1 === null && data2 === null) return 0;
        if (data1 === null) return 1;
        if (data2 === null) return -1;

        return sorting.direction === SortDirection.ASC ? data1 - data2 : data2 - data1;
      });
    }

    if (sortingColumnConfig.customCellType === "wave-datepicker") {
      return [...data].sort((record1, record2) => {
        const data1 = get(record1, sortingColumnConfig.id, null) as string | null;
        const data2 = get(record2, sortingColumnConfig.id, null) as string | null;

        const date1 = data1 && data1 !== "NA" ? new Date(data1) : null;
        const date2 = data2 && data2 !== "NA" ? new Date(data2) : null;

        if (date1 === null && date2 === null) return 0;
        if (date1 === null) return 1;
        if (date2 === null) return -1;

        return sorting.direction === SortDirection.ASC ? compareAsc(date1, date2) : compareAsc(date2, date1);
      });
    }

    return [...data].sort((record1, record2) => {
      const data1 = sortingColumnConfig.getValue?.(record1) ?? get(record1, sortingColumnConfig.id, "");
      const data2 = sortingColumnConfig.getValue?.(record2) ?? get(record2, sortingColumnConfig.id, "");

      if (data1 === "" && data2 === "") return 0;
      if (data1 === "") return 1;
      if (data2 === "") return -1;
      if (typeof data1 !== "string" || typeof data2 !== "string") return 0;

      return sorting.direction === SortDirection.ASC ? data1.localeCompare(data2) : data2.localeCompare(data1);
    });
  }, [columns, data, editing, sorting]);

  if (hasSortChanged.current) {
    hasSortChanged.current = false;
    prevSortedOrder.current = sortingEnhancedData.map(({ id }) => id);
  }

  return {
    clearSorting,
    sortByColumn,
    sortingEnhancedColumns,
    sortingEnhancedData,
  };
};

export default useSortByColumn;
