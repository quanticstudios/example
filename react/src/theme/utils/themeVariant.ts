import { isNil } from "lodash";

/**
 * Selects a `variant` theme based on `prop` and passes it to styles
 * This function takes 2 generics that define
 *    1. the options for the component props (the variant names) i.e. "red" | "blue" or "sm" | "md" | "lg"
 *    2. the variant theme options, what properties are available in variant i.e. "background" | "border" | "color"
 *
 * @param prop
 * @param variants
 * @param styles
 *
 * Example
 *
 * ```
 * type ButtonProps = {
 *   color: "red" | "blue";
 * };
 * const StyledButton = styled.button`
 *   ${({ theme, color }) =>
 *     themeVariant<ButtonProps["color"], "background" | "border">(
 *       color,
 *       {
 *         red: {
 *           background: theme.color("red500", "red100"),
 *           border: theme.color("red900", "red500"),
 *         },
 *         blue: {
 *           background: theme.color("blue500", "blue100"),
 *           border: theme.color("blue900", "blue500"),
 *         },
 *       },
 *       (variant) => css`
 *         background: ${variant.background};
 *         border: 1px solid ${variant.border};
 *       `
 *     )}
 * `;
 */
export function themeVariant<VariantNames extends string | undefined, ThemeProps extends string>(
  prop: VariantNames,
  variants: Record<NonNullable<VariantNames>, Record<ThemeProps, any>>,
  styles: (variant: Record<ThemeProps, any>) => any
) {
  return () => {
    if (isNil(prop)) {
      throw new Error("undefined is not a valid option for themeVariant()");
    }
    return styles(variants[prop as NonNullable<VariantNames>]);
  };
}
