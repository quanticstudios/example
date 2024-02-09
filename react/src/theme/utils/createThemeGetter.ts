import { isNil } from "lodash";

import config, { ThemeConfig } from "../config";

/**
 * Returns a function that si bound to the `option` prop of `theme`
 *
 * Example
 *```
 * const spacing = createSimpleThemeGetter('spacing');
 * spacing(4) => "4px"
 * spacing(8) => "8px"
 *```
 */
export function createSimpleThemeGetter<Option extends keyof ThemeConfig>(option: Option) {
  return (value: keyof ThemeConfig[Option]) => config[option][value];
}

/**
 * Returns a function that takes 4 arguments where the last 3 are optional
 * and works like `margin: 1px 2px 3px 4px` in css
 *
 * Example
 * ```
 * const spacing = createMultiThemeGetter('spacing'); // accesses theme.spacing
 * spacing(4) => "4px"
 * spacing(4, 8) => "4px 8px"
 * spacing(4, 0, 8) => "4px 0 8px"
 * spacing(4, 0, 8, 16) => "4px 0 8px 16px"
 * ```
 */
export function createMultiThemeGetter<Option extends keyof ThemeConfig, Value extends keyof ThemeConfig[Option]>(
  option: Option
) {
  function multiGetter<Value>(top: Value, right: Value, bottom: Value, left: Value): string;
  function multiGetter<Value>(topBottom: Value, leftRight: Value): string;
  function multiGetter<Value>(top: Value, leftRight: Value, bottom: Value): string;
  function multiGetter<Value>(all: Value): string;
  function multiGetter(top: Value, right?: Value, bottom?: Value, left?: Value) {
    return [top, right, bottom, left]
      .filter((value) => !isNil(value))
      .map((value) => config[option][value as Value])
      .join(" ");
  }

  return multiGetter;
}
