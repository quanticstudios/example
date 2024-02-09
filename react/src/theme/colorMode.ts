import { useRecoilState } from "recoil";

import { themeMode } from "@src/recoil/theme";

export function useColorMode() {
  return useRecoilState(themeMode);
}
