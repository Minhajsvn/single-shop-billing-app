"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_OPTIONS, themeStore } from "@/lib/ui/theme";

/**
 * Mounted once in the root layout. The inline <head> script sets data-theme before paint;
 * this re-applies it after React's dev-mode remount and follows the device when the choice is System.
 */
export function ThemeWatcher() {
  useLayoutEffect(() => themeStore.watchSystem(), []);
  return null;
}

/** System / Light / Dark switch. Inside a role="menu" popover pass itemRole="menuitemradio". */
export function ThemeChoice({ itemRole = "radio" }: { itemRole?: "radio" | "menuitemradio" }) {
  const preference = useSyncExternalStore(themeStore.subscribe, themeStore.getPreference, themeStore.getServerPreference);
  return (
    <div className="theme-choice" role={itemRole === "radio" ? "radiogroup" : "group"} aria-label="Theme">
      <span className="theme-choice-label">Theme</span>
      <div className="theme-choice-options">
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value} type="button" role={itemRole} aria-checked={preference === value}
            className={preference === value ? "active" : ""} onClick={() => themeStore.setPreference(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
