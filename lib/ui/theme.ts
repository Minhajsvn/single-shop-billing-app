export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Per-browser choice; "system" (no saved value) follows the device's light/dark setting. */
export const THEME_KEY = "shop-ledger-theme-v1";
export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * Mirrors parseThemePreference + resolveTheme; storage may be blocked, matchMedia always answers.
 */
export const THEME_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var l=p==="light"||(p!=="dark"&&window.matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches);document.documentElement.setAttribute("data-theme",l?"light":"dark")})()`;

/** Browser-side store: the saved preference, applied to <html data-theme> and kept in step with the device setting. */
export function createThemeStore() {
  const listeners = new Set<() => void>();
  let preference: ThemePreference = "system";
  let loaded = false;

  function read(): ThemePreference {
    if (!loaded && typeof window !== "undefined") {
      try { preference = parseThemePreference(window.localStorage.getItem(THEME_KEY)); } catch { /* storage blocked: keep system */ }
      loaded = true;
    }
    return preference;
  }

  function apply() {
    if (typeof window === "undefined") return;
    const theme = resolveTheme(read(), window.matchMedia(LIGHT_QUERY).matches);
    document.documentElement.setAttribute("data-theme", theme);
  }

  function setPreference(next: ThemePreference) {
    preference = next;
    loaded = true;
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch { /* storage blocked: the choice lasts for this page only */ }
    apply();
    listeners.forEach((listener) => listener());
  }

  /** Re-applies the theme now and whenever the device switches light/dark (only matters for "system"). */
  function watchSystem() {
    apply();
    const media = window.matchMedia(LIGHT_QUERY);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }

  return {
    getPreference: read,
    getServerPreference: (): ThemePreference => "system",
    setPreference,
    watchSystem,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const themeStore = createThemeStore();
