import { boxShadows } from "./boxShadows";
import { colors } from "./colors";
import { fontFamily, fontSize, fontWeight, lineHeight } from "./font";
import { radius } from "./radius";
import { spacing } from "./spacing";
import { text } from "./text";
import { transitions } from "./transitions";

const config = {
  colors,
  spacing,
  radius,
  text,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  transitions,
  boxShadows,
} as const;

export type ThemeColors = keyof typeof colors;
export type ThemeSpacing = keyof typeof spacing;
export type ThemeRadius = keyof typeof radius;
export type ThemeText = keyof typeof text;
export type ThemeFontFamily = keyof typeof fontFamily;
export type ThemeFontSize = keyof typeof fontSize;
export type ThemeFontWeight = keyof typeof fontWeight;
export type ThemeLineHeight = keyof typeof lineHeight;
export type ThemeBoxShadows = keyof typeof boxShadows;

export type ThemeConfig = typeof config;

export default config;
