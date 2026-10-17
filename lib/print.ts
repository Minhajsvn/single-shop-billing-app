export type PrintMode = "receipt" | "a4" | "daily-report" | "labels";

/**
 * Prints one document: CSS in app/globals.css shows only the element matching html[data-print-mode].
 * pageSize sets @page for this print only (thermal label printers expect one label per page).
 */
export function printDocument(mode: PrintMode, options: { pageSize?: string } = {}): void {
  document.documentElement.dataset.printMode = mode;
  let pageStyle: HTMLStyleElement | null = null;
  if (options.pageSize) {
    pageStyle = document.createElement("style");
    pageStyle.textContent = `@page { size: ${options.pageSize}; margin: 0; }`;
    document.head.appendChild(pageStyle);
  }
  window.addEventListener("afterprint", () => {
    delete document.documentElement.dataset.printMode;
    pageStyle?.remove();
  }, { once: true });
  window.setTimeout(() => window.print(), 0);
}
