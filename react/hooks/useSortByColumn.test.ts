import { GridCellKind } from "@glideapps/glide-data-grid";
import { renderHook } from "@testing-library/react-hooks";
import { describe, test, expect } from "vitest";

import useSortByColumn from "./useSortByColumn";

describe("ScheduleGraph::hooks", () => {
  describe("useSortByColumn", () => {
    test("it sorts column number data", () => {
      const testColumns = [
        {
          id: "col1",
          kind: GridCellKind.Number as const,
          title: "Column1",
          width: 0,
        },
      ];

      const testData = [
        { id: 0, col1: 2 },
        { id: 1, col1: 1 },
      ];

      const { result } = renderHook(() => useSortByColumn({ columns: testColumns, data: testData, editing: false }));

      result.current.sortByColumn(0);

      expect(result.current.sortingEnhancedData[0].id).to.eq(1);
      expect(result.current.sortingEnhancedData[1].id).to.eq(0);

      result.current.sortByColumn(0); // reverse
      expect(result.current.sortingEnhancedData[0].id).to.eq(0);
      expect(result.current.sortingEnhancedData[1].id).to.eq(1);
    });

    test("it sorts column text input", () => {
      const testColumns = [
        {
          id: "col1",
          kind: GridCellKind.Text as const,
          title: "Column1",
          width: 0,
        },
      ];

      const testData = [
        { id: 0, col1: "Zzz" },
        { id: 1, col1: "Aaa" },
        { id: 2, col1: "Ccc" },
      ];

      const { result } = renderHook(() => useSortByColumn({ columns: testColumns, data: testData, editing: false }));

      result.current.sortByColumn(0);
      expect(result.current.sortingEnhancedData[0].id).to.eq(1);
      expect(result.current.sortingEnhancedData[1].id).to.eq(2);
      expect(result.current.sortingEnhancedData[2].id).to.eq(0);

      result.current.sortByColumn(0); // reverse
      expect(result.current.sortingEnhancedData[0].id).to.eq(0);
      expect(result.current.sortingEnhancedData[1].id).to.eq(2);
      expect(result.current.sortingEnhancedData[2].id).to.eq(1);
    });

    test("it sorts column date input", () => {
      const testColumns = [
        {
          customCellType: "wave-datepicker" as const,
          id: "col1",
          kind: GridCellKind.Custom as const,
          title: "Column1",
          width: 0,
        },
      ];

      const testData = [
        { id: 0, col1: "2020-01-01" },
        { id: 1, col1: "2021-01-01" },
        { id: 2, col1: "NA" },
        { id: 3, col1: "2022-01-01" },
      ];

      const { result } = renderHook(() => useSortByColumn({ columns: testColumns, data: testData, editing: false }));

      result.current.sortByColumn(0);
      expect(result.current.sortingEnhancedData[0].id).to.eq(0);
      expect(result.current.sortingEnhancedData[1].id).to.eq(1);
      expect(result.current.sortingEnhancedData[2].id).to.eq(3);
      expect(result.current.sortingEnhancedData[3].id).to.eq(2);

      result.current.sortByColumn(0); // reverse
      expect(result.current.sortingEnhancedData[0].id).to.eq(3);
      expect(result.current.sortingEnhancedData[1].id).to.eq(1);
      expect(result.current.sortingEnhancedData[2].id).to.eq(0);
      expect(result.current.sortingEnhancedData[3].id).to.eq(2);
    });
  });
});
