import { useCallback, useRef } from "react";

import { CompactSelection, GridSelection, Item } from "@glideapps/glide-data-grid";

import useCtrlPressed from "@src/hooks/useCtrlPressed";

type UseRowSelectionParams<T> = {
  data: T[];
  gridSelection: GridSelection;
  setGridSelection: (selection: GridSelection) => void;
};

const useRowSelection = <T>({ data, gridSelection, setGridSelection }: UseRowSelectionParams<T>) => {
  const prevSelectedCell = useRef<Item>([0, 0]);
  const wasSelectionFromCell = useRef(true);

  const { getIsCtrlPressed } = useCtrlPressed();

  const selectCellRow = useCallback(
    (cell: Item, isShiftSelect: boolean) => {
      const [col, row] = cell;
      const prevSelectedRow = prevSelectedCell.current[1];
      const selection = { ...gridSelection };

      const rowSelection: number | [number, number] = isShiftSelect
        ? [Math.min(prevSelectedRow, row), Math.max(prevSelectedRow, row + 1)]
        : row;

      if (selection.rows.hasIndex(row)) {
        selection.rows = selection.rows.remove(rowSelection);
      } else if (typeof rowSelection === "number" && !getIsCtrlPressed() && col !== -1) {
        selection.rows = CompactSelection.empty().add(rowSelection);
      } else {
        selection.rows = selection.rows.add(rowSelection);
      }

      prevSelectedCell.current = cell;
      wasSelectionFromCell.current = true;

      setGridSelection(selection);

      return selection.rows.toArray().map((row) => data[row]);
    },
    [data, getIsCtrlPressed, gridSelection, setGridSelection],
  );

  const updateIfSelectAllRows = useCallback(
    (newSelection: GridSelection) => {
      const oldFirst = gridSelection.rows.first();
      const oldLast = gridSelection.rows.last();
      const first = newSelection.rows.first();
      const last = newSelection.rows.last();

      if (data.length === 1 && wasSelectionFromCell.current) {
        wasSelectionFromCell.current = false;
        return;
      }

      if (first === 0 && last === data.length - 1) {
        setGridSelection(newSelection);
        return data;
      }

      if (oldFirst === 0 && oldLast === data.length - 1 && first === undefined && last === undefined) {
        setGridSelection({ ...gridSelection, rows: CompactSelection.empty() });
        return [];
      }
    },
    [data, gridSelection, setGridSelection],
  );

  return { selectCellRow, updateIfSelectAllRows };
};

export default useRowSelection;
