import { css } from "styled-components";

//* Created this function to make it easier to add breakpoints to styled-components
//* It is not used at the moment, but can be used in the future if needed
interface IBreakpointValues {
  cssProp: string;
  cssPropUnits: string;
  values: Array<{ [key: string]: number }>;
  mediaQueryType: string;
}

/**
 * @description
 * Breakpoints function for styled-components
 * @param cssProp - the CSS property to apply to the breakpoints
 * @param cssPropUnits - the units of the CSS property (can set equal to "" and apply units to values directly)
 * @param values - array of objects, e.g. [{ 800: 60 }, ...] <-- 800 (key) = screen breakpoint, 60 (value) = CSS prop breakpoint
 * @param mediaQueryType - media query breakpoint type, i.e.: max-width, min-width, max-height, min-height
 */
export const breakpoints = ({ cssProp, cssPropUnits, values, mediaQueryType }: IBreakpointValues) => {
  const breakpointProps = values.reduce((mediaQueries, value) => {
    const [screenBreakpoint, cssPropBreakpoint] = [Object.keys(value)[0], Object.values(value)[0]];
    return (
      mediaQueries +
      `
    @media screen and (${mediaQueryType}: ${screenBreakpoint}px) {
      ${cssProp}: ${cssPropBreakpoint}${cssPropUnits};
    }
    `
    );
  }, "");
  return css([breakpointProps] as unknown as TemplateStringsArray);
};

export const BREAKPOINTS = {
  mobile: `
    @media screen and (max-width: 500px) 
    `,
} as const;
