import type { BackgroundMessage } from "./messages";

const POPUP_PATH = /\/popup\.html$/;

type DappRequestMessage = Extract<BackgroundMessage, { type: "DAPP_REQUEST" }>;
type PopupCommandMessage = Exclude<BackgroundMessage, DappRequestMessage>;

export type AllowedMessageContext =
  | { kind: "popup"; message: PopupCommandMessage }
  | { kind: "dapp"; message: DappRequestMessage; origin: string; sender: Browser.runtime.MessageSender };

function extensionOrigin(): string {
  return new URL(browser.runtime.getURL("/popup.html")).origin;
}

export function isPopupSender(sender: Browser.runtime.MessageSender): boolean {
  if (sender.id !== browser.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === extensionOrigin() && POPUP_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function dappOriginFromSender(sender: Browser.runtime.MessageSender): string {
  if (sender.id !== browser.runtime.id) throw new Error("Unauthorized message sender");
  const frameUrl = sender.url;
  if (!frameUrl) throw new Error("dApp requests must originate from a browser tab");
  let parsed: URL;
  try {
    parsed = new URL(frameUrl);
  } catch {
    throw new Error("Invalid dApp frame URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("dApp requests are only allowed from http(s) pages");
  }
  return parsed.origin;
}

export function assertAllowedMessageContext(message: BackgroundMessage, sender: Browser.runtime.MessageSender): AllowedMessageContext {
  if (message.type === "DAPP_REQUEST") {
    if (isPopupSender(sender)) throw new Error("dApp requests cannot be sent from the popup");
    return { kind: "dapp", message, origin: dappOriginFromSender(sender), sender };
  }
  if (!isPopupSender(sender)) throw new Error("Unauthorized message sender");
  return { kind: "popup", message };
}
