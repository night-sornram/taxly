import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
const STORAGE_KEY = "taxly-theme";
const DARK_CANVAS = "#0f1214";

export function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * The attribute is only set for explicit choices; in system mode the CSS
 * prefers-color-scheme media query drives the palette without JavaScript,
 * so the first paint is already correct.
 */
function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = mode;
  root.style.colorScheme = mode === "system" ? "" : mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", resolveTheme(mode) === "dark" ? DARK_CANVAS : "#f3f5f7");
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredMode()));
  useEffect(() => {
    const update = () => {
      const resolved = resolveTheme(mode);
      setTheme(resolved);
      applyMode(mode);
    };
    update();
    if (mode !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [mode]);
  const setThemeChoice = useCallback((choice: ResolvedTheme) => {
    localStorage.setItem(STORAGE_KEY, choice);
    setModeState(choice);
  }, []);
  return { mode, theme, setTheme: setThemeChoice };
}
