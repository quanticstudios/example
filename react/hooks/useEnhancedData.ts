import { useMemo } from "react";

import { DataTableColumn } from "@src/types/table";

import { getCellData } from "../utils/cells";
import { handleFuzzySort } from "@src/utils/fuzzySort";

type UseEnhancedDataParams<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  filters: Record<string, string[]>;
  searchText: string;
};

const useEnhancedData = <T extends { name: string }>({
  columns,
  data,
  filters,
  searchText,
}: UseEnhancedDataParams<T>) => {
  return useMemo(() => {
    const filteredData = handleFuzzySort(searchText, data, "name");
    return filteredData.filter((record) => {
      if (!("name" in record)) return true;

      let shouldKeep = true;

      Object.entries(filters).forEach(([columnId, filterItems]) => {
        const column = columns.find(({ id }) => id === columnId);
        if (!column) return;

        const content = getCellData(column, record);

        if (filterItems.includes(content) || (content === "" && filterItems.includes("Empty"))) return;

        shouldKeep = false;
      });

      return shouldKeep;
    });
  }, [columns, data, filters, searchText]);
};

export default useEnhancedData;
