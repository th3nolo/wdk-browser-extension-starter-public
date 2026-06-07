// Opens a dedicated approval popup window so dApp connection / signature /
// transaction requests surface immediately, even when the toolbar popup is
// closed. This is the standard injected-wallet pattern (MetaMask/Rabby): a
// service worker cannot reliably call chrome.action.openPopup() without a user
// gesture (and it can hang headless), so we use chrome.windows.create().
//
// chrome.windows has no "resizable: false" option, so we keep the window at a
// fixed size by snapping it back via windows.onBoundsChanged — the user gets a
// stable, non-resizable approval surface that fits without scrolling.

const APPROVAL_WINDOW_WIDTH = 428;
const APPROVAL_WINDOW_HEIGHT = 620;
const APPROVAL_WINDOW_HASH = "#approval";

let approvalWindowId: number | undefined;
let openInFlight: Promise<void> | undefined;
let boundsListenerRegistered = false;

/** Surface the approval window. Safe to call repeatedly; dedupes. */
export async function openApprovalWindow(): Promise<void> {
  openInFlight ??= openApprovalWindowOnce().finally(() => {
    openInFlight = undefined;
  });
  await openInFlight;
}

async function openApprovalWindowOnce(): Promise<void> {
  try {
    if (typeof browser === "undefined" || typeof browser.windows?.create !== "function") return;
    if (approvalWindowId !== undefined) {
      const existing = await browser.windows.get(approvalWindowId).catch(() => undefined);
      if (existing) {
        await browser.windows.update(approvalWindowId, { focused: true, drawAttention: true }).catch(() => undefined);
        return;
      }
      approvalWindowId = undefined;
    }
    registerBoundsGuard();
    const created = await browser.windows.create({
      url: browser.runtime.getURL(`/popup.html${APPROVAL_WINDOW_HASH}`),
      type: "popup",
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
      focused: true
    });
    approvalWindowId = created?.id ?? undefined;
  } catch {
    // No UI available (e.g. headless automation) — the request still resolves
    // once approved from the toolbar popup, so failing to open is non-fatal.
  }
}

/** Keep the approval window at its fixed size (chrome.windows can't be made non-resizable directly). */
function registerBoundsGuard(): void {
  if (boundsListenerRegistered || typeof browser.windows?.onBoundsChanged?.addListener !== "function") return;
  boundsListenerRegistered = true;
  browser.windows.onBoundsChanged.addListener((win) => {
    if (typeof win.id !== "number" || win.id !== approvalWindowId) return;
    if (win.width === APPROVAL_WINDOW_WIDTH && win.height === APPROVAL_WINDOW_HEIGHT) return;
    void browser.windows.update(win.id, { width: APPROVAL_WINDOW_WIDTH, height: APPROVAL_WINDOW_HEIGHT }).catch(() => undefined);
  });
}

/** Close the approval window if we opened one. Called when no requests remain. */
export async function closeApprovalWindowIfOpen(): Promise<void> {
  if (approvalWindowId === undefined || typeof browser === "undefined") return;
  const id = approvalWindowId;
  approvalWindowId = undefined;
  try {
    await browser.windows.remove(id);
  } catch {
    // Already closed by the user — nothing to do.
  }
}
