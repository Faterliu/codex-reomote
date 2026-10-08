import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import { Appearance, Platform, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";

const ThemeContext = createContext(false);

export function AppThemeProvider({ isDark, children }: PropsWithChildren<{ isDark: boolean }>) {
  useEffect(() => {
    // 同步原生控件及键盘的外观，应用内开关优先于系统主题。
    if (Platform.OS !== "web") {
      Appearance.setColorScheme(isDark ? "dark" : "light");
    }
  }, [isDark]);

  return <ThemeContext.Provider value={isDark}>{children}</ThemeContext.Provider>;
}

const darkSurfaces: Record<string, string> = {
  "#ffffff": "#182230",
  "#f4f7fb": "#101720",
  "#f8fafc": "#141d29",
  "#f6f8fb": "#141d29",
  "#edf1f7": "#243244",
  "#e7edf5": "#243244",
  "#f2f5f9": "#202c3c",
  "#eef2f7": "#202c3c",
  "#eaf0f7": "#202c3c",
  "#cfd7e3": "#35445a",
  "#edf3ff": "#223553",
  "#e8f0ff": "#223553",
  "#edf7ff": "#223553",
  "#e8eef8": "#223553",
  "#eef4ff": "#223553",
  "#e8eefb": "#223553",
  "#eef5ff": "#223553",
  "#dce9ff": "#2c446b",
  "#dff7e8": "#193b2d",
  "#e8f7ef": "#193b2d",
  "#eaf7ed": "#193b2d",
  "#dcfce7": "#193b2d",
  "#fff1f1": "#43262b",
  "#fdecec": "#43262b",
  "#fee2e2": "#43262b",
  "#fff1f0": "#43262b",
  "#fff8eb": "#372e20",
  "#ffefd2": "#453821",
  "#fff4d8": "#453821",
  "#fff7e6": "#372e20",
  "#e0f2fe": "#19384c",
  "#eef2ff": "#302d50",
};

const darkText: Record<string, string> = {
  "#121a26": "#edf2fa",
  "#182230": "#edf2fa",
  "#142235": "#edf2fa",
  "#304052": "#d5deec",
  "#344256": "#d5deec",
  "#1f3a5f": "#c5d7f2",
  "#516071": "#a9b6c9",
  "#526071": "#a9b6c9",
  "#526073": "#a9b6c9",
  "#647287": "#a9b6c9",
  "#697789": "#a9b6c9",
  "#6b7687": "#a9b6c9",
  "#6b7788": "#a9b6c9",
  "#738094": "#a9b6c9",
  "#7b8797": "#a9b6c9",
  "#8a94a6": "#a9b6c9",
  "#2454d6": "#91b5ff",
  "#3674c5": "#91b5ff",
  "#19663b": "#87d39d",
  "#1e7b45": "#87d39d",
  "#2e6f40": "#87d39d",
  "#166534": "#87d39d",
  "#1d8f54": "#87d39d",
  "#b42318": "#ffa198",
  "#d92d20": "#ffa198",
  "#991b1b": "#ffa198",
  "#9b2222": "#ffa198",
  "#b54708": "#f2c478",
  "#9b5b00": "#f2c478",
  "#8a5a00": "#f2c478",
  "#704b00": "#f2c478",
  "#4a3a17": "#f2c478",
  "#075985": "#8dd4ff",
  "#3730a3": "#b9b4ff",
};

const darkBorders: Record<string, string> = {
  "#ffffff": "#35445a",
  "#e2e8f0": "#35445a",
  "#d8dee8": "#35445a",
  "#cfd7e3": "#35445a",
  "#e3e8f0": "#35445a",
  "#edf1f7": "#2c3a4e",
  "#e1e6ee": "#35445a",
  "#c7d7fe": "#416090",
  "#b9d2ff": "#416090",
  "#c8d7ef": "#416090",
  "#9fb4d8": "#416090",
  "#9db7f4": "#416090",
  "#f0b8b8": "#83464d",
  "#ffccc7": "#83464d",
  "#f0c77a": "#7d6337",
  "#f0cf85": "#7d6337",
  "#d9b95f": "#7d6337",
};

function resolveDarkColor(color: string, property: string) {
  const key = color.toLowerCase();
  if (property === "backgroundColor") {
    return darkSurfaces[key] ?? color;
  }
  if (property.startsWith("border")) {
    return darkBorders[key] ?? color;
  }
  return darkText[key] ?? color;
}

export function useAppTheme() {
  const isDark = useContext(ThemeContext);
  const color = useMemo(() => (value: string) => (isDark ? resolveDarkColor(value, "color") : value), [isDark]);
  return { isDark, color };
}

// 保留现有浅色布局与颜色，以属性用途映射深色配色；样式只在模块加载时构建一次。
export function createThemedStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(definitions: T) {
  const light = StyleSheet.create(definitions);
  const darkDefinitions = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      Object.fromEntries(
        Object.entries(definition).map(([property, value]) => [
          property,
          typeof value === "string" && /color$/i.test(property) ? resolveDarkColor(value, property) : value,
        ]),
      ),
    ]),
  ) as T;
  const dark = StyleSheet.create(darkDefinitions);
  return function useStyles() {
    return useContext(ThemeContext) ? dark : light;
  };
}
