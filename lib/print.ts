export type PrintMode = "receipt" | "a4" | "daily-report";

/** Prints one document: CSS in app/globals.css shows only the element matching html[data-print-mode]. */
export function printDocument(mode: PrintMode): void {
  document.documentElement.dataset.printMode = mode;
  window.addEventListener("afterprint", () => { delete document.documentElement.dataset.printMode; }, { once: true });
  window.setTimeout(() => window.print(), 0);
}
