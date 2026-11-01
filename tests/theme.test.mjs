import assert from "node:assert/strict";
import test from "node:test";
import { createThemeStore, parseThemePreference, resolveTheme, THEME_KEY, THEME_SCRIPT } from "../lib/ui/theme.ts";

/** Minimal browser stand-ins: localStorage, matchMedia and <html> attributes. */
function fakeBrowser({ saved = null, systemLight = false, storageBlocked = false } = {}) {
  const store = new Map(saved === null ? [] : [[THEME_KEY, saved]]);
  const attrs = {};
  const mediaListeners = new Set();
  const media = { matches: systemLight, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
  const localStorage = {
    getItem: (key) => { if (storageBlocked) throw new Error("blocked"); return store.get(key) ?? null; },
    setItem: (key, value) => { if (storageBlocked) throw new Error("blocked"); store.set(key, value); },
    removeItem: (key) => { if (storageBlocked) throw new Error("blocked"); store.delete(key); },
  };
  const window = { localStorage, matchMedia: () => media };
  const document = { documentElement: { setAttribute: (name, value) => { attrs[name] = value; } } };
  return { window, document, localStorage, attrs, store, setSystemLight(value) { media.matches = value; mediaListeners.forEach((fn) => fn()); } };
}

function withBrowser(browser, run) {
  const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: browser.window, document: browser.document, localStorage: browser.localStorage });
  try { return run(); } finally { Object.assign(globalThis, saved); }
}

test("unknown or missing saved values mean System", () => {
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("blue"), "system");
});

test("System follows the device; Light and Dark ignore it", () => {
  assert.equal(resolveTheme("system", true), "light");
  assert.equal(resolveTheme("system", false), "dark");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
});

for (const [saved, systemLight, expected] of [[null, true, "light"], [null, false, "dark"], ["light", false, "light"], ["dark", true, "dark"], ["junk", true, "light"]]) {
  test(`pre-paint script: saved=${saved} systemLight=${systemLight} -> ${expected}`, () => {
    const browser = fakeBrowser({ saved, systemLight });
    withBrowser(browser, () => new Function(THEME_SCRIPT)());
    assert.equal(browser.attrs["data-theme"], expected);
  });
}

test("pre-paint script falls back to the device when storage is blocked", () => {
  const browser = fakeBrowser({ systemLight: true, storageBlocked: true });
  withBrowser(browser, () => new Function(THEME_SCRIPT)());
  assert.equal(browser.attrs["data-theme"], "light");
});

test("choosing a theme saves it, applies it and notifies; System clears the saved value", () => {
  const browser = fakeBrowser({ systemLight: false });
  withBrowser(browser, () => {
    const store = createThemeStore();
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    assert.equal(store.getPreference(), "system");
    store.setPreference("light");
    assert.equal(browser.store.get(THEME_KEY), "light");
    assert.equal(browser.attrs["data-theme"], "light");
    store.setPreference("system");
    assert.equal(browser.store.has(THEME_KEY), false);
    assert.equal(browser.attrs["data-theme"], "dark");
    assert.equal(calls, 2);
  });
});

test("on System the page follows the device switching light/dark; a fixed choice does not", () => {
  const browser = fakeBrowser({ systemLight: false });
  withBrowser(browser, () => {
    const store = createThemeStore();
    const stop = store.watchSystem();
    browser.setSystemLight(true);
    assert.equal(browser.attrs["data-theme"], "light");
    store.setPreference("dark");
    browser.setSystemLight(false);
    browser.setSystemLight(true);
    assert.equal(browser.attrs["data-theme"], "dark");
    stop();
  });
});
