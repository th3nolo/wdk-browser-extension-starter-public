import { evaluateCdp, waitForCdpExpression } from "./cdp.mjs";

// Real-UI helpers that drive the popup's React DOM directly (no chrome.runtime
// shortcut). They operate on an already-open popup CDP target (popupWs) via
// evaluateCdp/waitForCdpExpression so a UI-only regression — a disabled button,
// an overlay intercepting the click, a missing checkbox — fails the smoke.

const CONNECT_LABEL = "Connect";
const REJECT_LABEL = "Reject";

// Serialised in-page helper: find a button inside the connection card by its
// trimmed textContent. Returns the element so callers can assert on it.
const FIND_BUTTON_FN = `(label) => {
  const card = document.querySelector(".connection-request-card");
  const scope = card ?? document;
  const buttons = Array.from(scope.querySelectorAll("button"));
  return buttons.find((button) => (button.textContent || "").replace(/\\s+/g, " ").trim() === label) ?? null;
}`;

/**
 * Reload the popup so React renders the freshly-queued pending request, then
 * wait until the connection card exists with at least one account row and a
 * default-checked checkbox. Resolves once the card is interactable.
 *
 * If the reload lands on the Unlock screen (the session re-locked), the
 * optional `unlockPassword` is used to unlock before waiting for the card.
 */
export async function waitForConnectionCard(popupWs, timeoutMs, unlockPassword) {
  // The popup may have been opened before the connection was queued; a reload
  // forces React to re-read the pending request from the background store.
  await evaluateCdp(popupWs, "(() => { location.reload(); return true; })()", {
    label: "reload popup for connection card"
  });
  // Wait for React to mount and the runtime to settle after the reload.
  await waitForCdpExpression(
    popupWs,
    "document.readyState === 'complete' && typeof chrome?.runtime?.sendMessage === 'function'",
    timeoutMs
  );
  if (unlockPassword) {
    await unlockPopupIfLocked(popupWs, unlockPassword, timeoutMs);
  }
  await waitForCdpExpression(
    popupWs,
    `(() => {
      const card = document.querySelector(".connection-request-card");
      if (!card) return false;
      const rows = card.querySelectorAll(".account-check-row");
      if (!rows.length) return false;
      const checkboxes = card.querySelectorAll('.account-check-row input[type="checkbox"]');
      return Array.from(checkboxes).some((input) => input.checked);
    })()`,
    timeoutMs
  );
}

/**
 * Assert the Connect button exists, is enabled, and is the top element at its
 * own centre point (no overlay/toast/modal intercepting a real click). Throws a
 * descriptive error otherwise so the failure pinpoints the broken UI invariant.
 */
export async function assertConnectClickable(popupWs) {
  const report = await evaluateCdp(
    popupWs,
    `(() => {
      const findButton = ${FIND_BUTTON_FN};
      const button = findButton(${JSON.stringify(CONNECT_LABEL)});
      if (!button) return JSON.stringify({ ok: false, reason: "Connect button not found in connection card" });
      if (button.disabled) return JSON.stringify({ ok: false, reason: "Connect button is disabled" });
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return JSON.stringify({ ok: false, reason: "Connect button has zero size (not laid out / hidden)" });
      }
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const topElement = document.elementFromPoint(x, y);
      const intercepts = topElement && topElement !== button && !button.contains(topElement);
      if (intercepts) {
        const describe = (node) => {
          if (!node) return "null";
          const cls = typeof node.className === "string" && node.className ? "." + node.className.trim().replace(/\\s+/g, ".") : "";
          return node.tagName.toLowerCase() + cls;
        };
        return JSON.stringify({
          ok: false,
          reason: "Connect button click is intercepted by an overlay element",
          intercepting: describe(topElement),
          point: { x, y }
        });
      }
      return JSON.stringify({ ok: true });
    })()`,
    { label: "assert Connect button clickable" }
  );
  const parsed = typeof report === "string" ? JSON.parse(report) : report;
  if (!parsed?.ok) {
    const detail = parsed?.intercepting ? ` (top element at click point: ${parsed.intercepting})` : "";
    throw new Error(`Connect button is not clickable: ${parsed?.reason ?? "unknown reason"}${detail}`);
  }
  return parsed;
}

/**
 * Tick additional account checkboxes by their row index to exercise the
 * multi-account selection path. Index 0 is the default-checked active account;
 * passing [1, 2] adds the second and third rows. Throws if a row is missing.
 */
export async function selectConnectionAccounts(popupWs, indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  const report = await evaluateCdp(
    popupWs,
    `(() => {
      const indexes = ${JSON.stringify(indexes)};
      const card = document.querySelector(".connection-request-card");
      if (!card) return JSON.stringify({ ok: false, reason: "connection card not found" });
      const rows = Array.from(card.querySelectorAll(".account-check-row"));
      const toggled = [];
      for (const index of indexes) {
        const row = rows[index];
        if (!row) return JSON.stringify({ ok: false, reason: "no account row at index " + index + " (have " + rows.length + ")" });
        const input = row.querySelector('input[type="checkbox"]');
        if (!input) return JSON.stringify({ ok: false, reason: "account row " + index + " has no checkbox" });
        if (!input.checked) input.click();
        toggled.push({ index, checked: input.checked });
      }
      return JSON.stringify({ ok: true, toggled });
    })()`,
    { label: "select connection accounts" }
  );
  const parsed = typeof report === "string" ? JSON.parse(report) : report;
  if (!parsed?.ok) throw new Error(`Unable to select connection accounts: ${parsed?.reason ?? "unknown reason"}`);
  return parsed.toggled;
}

/**
 * Click the real Connect button in the popup. Throws if it is missing or
 * disabled so a regression that hides/disables approval surfaces as a failure.
 */
export async function clickConnect(popupWs) {
  return clickCardButton(popupWs, CONNECT_LABEL);
}

/**
 * Click the real Reject button in the popup. Throws if it is missing/disabled.
 */
export async function clickReject(popupWs) {
  return clickCardButton(popupWs, REJECT_LABEL);
}

async function clickCardButton(popupWs, label) {
  const report = await evaluateCdp(
    popupWs,
    `(() => {
      const findButton = ${FIND_BUTTON_FN};
      const button = findButton(${JSON.stringify(label)});
      if (!button) return JSON.stringify({ ok: false, reason: ${JSON.stringify(label)} + " button not found in connection card" });
      if (button.disabled) return JSON.stringify({ ok: false, reason: ${JSON.stringify(label)} + " button is disabled" });
      button.click();
      return JSON.stringify({ ok: true });
    })()`,
    { label: `click ${label} button` }
  );
  const parsed = typeof report === "string" ? JSON.parse(report) : report;
  if (!parsed?.ok) throw new Error(`Unable to click ${label} button: ${parsed?.reason ?? "unknown reason"}`);
  return parsed;
}

/**
 * Optional minimal happy-path for the lock screen: fill the password input and
 * click Unlock if the popup is currently locked. No-op (returns false) if the
 * unlock surface is not present, so callers can call it unconditionally.
 */
export async function unlockPopupIfLocked(popupWs, password, timeoutMs) {
  const filled = await evaluateCdp(
    popupWs,
    `(() => {
      const input = document.querySelector('input[type="password"]');
      if (!input) return JSON.stringify({ present: false });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, ${JSON.stringify(password)});
      else input.value = ${JSON.stringify(password)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const buttons = Array.from(document.querySelectorAll("button"));
      const unlock = buttons.find((button) => /unlock/i.test((button.textContent || "").trim()));
      if (!unlock) return JSON.stringify({ present: true, clicked: false, reason: "Unlock button not found" });
      if (unlock.disabled) return JSON.stringify({ present: true, clicked: false, reason: "Unlock button disabled" });
      unlock.click();
      return JSON.stringify({ present: true, clicked: true });
    })()`,
    { label: "fill+click Unlock" }
  );
  const parsed = typeof filled === "string" ? JSON.parse(filled) : filled;
  if (!parsed?.present) return false;
  if (!parsed.clicked) throw new Error(`Unlock surface present but not actioned: ${parsed.reason ?? "unknown reason"}`);
  await waitForCdpExpression(
    popupWs,
    "document.querySelector('input[type=\"password\"]') === null",
    timeoutMs
  );
  return true;
}
