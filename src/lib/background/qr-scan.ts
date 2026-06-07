// The camera QR scanner runs in a dedicated window, not the toolbar popup: the
// popup closes the instant the camera permission prompt steals focus, so
// getUserMedia can never be granted from inside it ("Permission dismissed"). A
// real window stays open for the prompt, scans, hands the value back via
// session storage, and closes.
const SCANNER_WINDOW_WIDTH = 420;
const SCANNER_WINDOW_HEIGHT = 560;
const PENDING_SCAN_KEY = "wdk-pending-scan";

let scannerWindowId: number | undefined;

export async function openQrScannerWindow(): Promise<void> {
  if (typeof browser === "undefined" || typeof browser.windows?.create !== "function") return;
  try {
    if (scannerWindowId !== undefined) {
      const existing = await browser.windows.get(scannerWindowId).catch(() => undefined);
      if (existing) {
        await browser.windows.update(scannerWindowId, { focused: true }).catch(() => undefined);
        return;
      }
      scannerWindowId = undefined;
    }
    const created = await browser.windows.create({
      url: browser.runtime.getURL("/popup.html#scan"),
      type: "popup",
      width: SCANNER_WINDOW_WIDTH,
      height: SCANNER_WINDOW_HEIGHT,
      focused: true
    });
    scannerWindowId = created?.id ?? undefined;
  } catch {
    // No UI available (e.g. headless automation) — non-fatal.
  }
}

export async function setPendingScan(value: string): Promise<void> {
  if (typeof browser === "undefined") return;
  await browser.storage.session.set({ [PENDING_SCAN_KEY]: value });
}

/** Read and clear the most recent scanned value (consumed by the Send form). */
export async function takePendingScan(): Promise<string | null> {
  if (typeof browser === "undefined") return null;
  const stored = await browser.storage.session.get(PENDING_SCAN_KEY);
  const value = (stored as Record<string, unknown>)?.[PENDING_SCAN_KEY];
  if (typeof value !== "string") return null;
  await browser.storage.session.remove(PENDING_SCAN_KEY);
  return value;
}
