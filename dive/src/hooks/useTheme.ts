import { useEffect } from "react";
import { useThemeStore, type Theme } from "../stores/theme";

export function useTheme() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (event: MediaQueryListEvent) => {
      const stored = localStorage.getItem("dive.theme");
      if (stored === "dark" || stored === "light") return;
      setTheme(event.matches ? "light" : "dark");
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [setTheme]);

  return { theme, setTheme, toggleTheme } satisfies {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
  };
}
