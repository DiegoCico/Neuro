// Simple theme manager using localStorage + system fallback
const KEY = "theme"; // "light" | "dark"

export type Theme = "light" | "dark";

export function getCachedTheme(): Theme | null {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "dark" ? t : null;
}

export function getSystemTheme(): Theme {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function initThemeFromCache() {
  const cached = getCachedTheme();
  const theme = cached ?? getSystemTheme();
  applyTheme(theme);
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

export function toggleTheme() {
  const current = (document.documentElement.getAttribute("data-theme") as Theme) || getSystemTheme();
  setTheme(current === "light" ? "dark" : "light");
}
