import { PropsWithChildren, useEffect } from "react";
import { ThemeProvider as StyledThemeProvider } from "styled-components";

import { DEFAULT_COLOR_MODE, ThemeMode } from "@src/config/theme";
import { styleguide } from "@src/styleguide";
import { createSimpleThemeGetter, createMultiThemeGetter } from "@src/theme/utils/createThemeGetter";

import { useColorMode } from "./colorMode";
import config, { ThemeBoxShadows, ThemeColors } from "./config";

type ThemeProviderProps = PropsWithChildren<{
  modeOverride?: ThemeMode;
}>;

export function ThemeProvider(props: ThemeProviderProps) {
  const [themeMode, setColorMode] = useColorMode();

  // sync color mode override with our recoil state
  // this is need for storybook to work when changing themes
  useEffect(() => {
    if (props.modeOverride) {
      setColorMode(props.modeOverride);
    }
  }, [props.modeOverride, setColorMode]);

  return <StyledThemeProvider theme={{ ...theme, mode: themeMode }}>{props.children as any}</StyledThemeProvider>;
}

export const theme = {
  mode: DEFAULT_COLOR_MODE,
  config,

  color(darkOrDefault: ThemeColors, light?: ThemeColors) {
    let color = darkOrDefault;
    if (light && this.mode === "light") {
      color = light;
    }

    return config.colors[color];
  },
  boxShadow(darkOrDefault: ThemeBoxShadows, light?: ThemeBoxShadows) {
    let boxShadow = darkOrDefault;
    if (light && this.mode === "light") {
      boxShadow = light;
    }
    return config.boxShadows[boxShadow];
  },

  spacing: createMultiThemeGetter("spacing"),
  radius: createMultiThemeGetter("radius"),
  text: createSimpleThemeGetter("text"),
  fontFamily: createSimpleThemeGetter("fontFamily"),
  fontSize: createSimpleThemeGetter("fontSize"),
  fontWeight: createSimpleThemeGetter("fontWeight"),
  lineHeight: createSimpleThemeGetter("lineHeight"),
  transitions: config.transitions,

  // todo: remove old styleguide once we refactor its usage out of the application
  ...styleguide,
};

/**
 * @deprecated
 * todo: remove once not used anymore
 */
export function lightDark(theme: WaveTheme, light: string, dark: string) {
  return theme.mode === "light" ? light : dark;
}

export type WaveTheme = typeof theme;

declare module "styled-components" {
  export interface DefaultTheme extends WaveTheme {}
}
