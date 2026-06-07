import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertAllowedMessageContext, dappOriginFromSender, isPopupSender } from "./message-acl";
import type { BackgroundMessage } from "./messages";

const EXTENSION_ID = "test-extension";
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup.html`;

beforeEach(() => {
  vi.stubGlobal("browser", {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`
    }
  });
});

function popupSender(): Browser.runtime.MessageSender {
  return { id: EXTENSION_ID, url: POPUP_URL };
}

function contentSender(frameUrl: string, tabUrl = frameUrl): Browser.runtime.MessageSender {
  return { id: EXTENSION_ID, tab: { id: 1, url: tabUrl } as Browser.tabs.Tab, url: frameUrl };
}

describe("message ACL", () => {
  it("accepts popup senders for wallet management messages", () => {
    expect(isPopupSender(popupSender())).toBe(true);
    expect(assertAllowedMessageContext({ type: "LOCK" }, popupSender())).toMatchObject({ kind: "popup" });
    expect(assertAllowedMessageContext({ type: "SEND", request: {} as never }, popupSender())).toMatchObject({ kind: "popup" });
    expect(assertAllowedMessageContext({ type: "APPROVE_SIGNATURE", id: "sig-1" }, popupSender())).toMatchObject({ kind: "popup" });
  });

  it("rejects privileged messages from content scripts", () => {
    const sender = contentSender("https://evil.example/page");
    expect(() => assertAllowedMessageContext({ type: "LOCK" }, sender)).toThrow("Unauthorized message sender");
    expect(() => assertAllowedMessageContext({ type: "SEND", request: {} as never }, sender)).toThrow("Unauthorized message sender");
    expect(() => assertAllowedMessageContext({ type: "APPROVE_SIGNATURE", id: "sig-1" }, sender)).toThrow("Unauthorized message sender");
  });

  it("binds dApp origin to the sender frame URL", () => {
    const sender = contentSender("https://dapp.example/path");
    expect(dappOriginFromSender(sender)).toBe("https://dapp.example");
    expect(assertAllowedMessageContext({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, sender)).toMatchObject({ kind: "dapp", origin: "https://dapp.example" });
  });

  it("uses the iframe frame URL instead of the top tab URL", () => {
    const sender = contentSender(
      "https://evil.example/embed",
      "https://trusted.example/app"
    );
    expect(dappOriginFromSender(sender)).toBe("https://evil.example");
  });

  it("rejects dApp requests without a frame URL", () => {
    expect(() => dappOriginFromSender({ id: EXTENSION_ID })).toThrow("dApp requests must originate from a browser tab");
  });

  it("rejects dApp requests from the popup", () => {
    expect(() => assertAllowedMessageContext({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, popupSender())).toThrow("dApp requests cannot be sent from the popup");

    expect(() => assertAllowedMessageContext({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, { id: EXTENSION_ID, url: POPUP_URL })).toThrow("dApp requests cannot be sent from the popup");
  });

  it("rejects dApp requests from non-http(s) tabs", () => {
    expect(() => dappOriginFromSender(contentSender("chrome://extensions"))).toThrow("dApp requests are only allowed from http(s) pages");
  });

  it("rejects messages from foreign extension contexts", () => {
    const foreignSender = { id: "other-extension", url: POPUP_URL };
    expect(() => assertAllowedMessageContext({ type: "LOCK" }, foreignSender)).toThrow("Unauthorized message sender");
    expect(() => assertAllowedMessageContext({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    } satisfies BackgroundMessage, contentSender("https://dapp.example"))).not.toThrow();
    expect(() => dappOriginFromSender({ id: "other-extension", tab: { id: 1, url: "https://dapp.example" } as Browser.tabs.Tab })).toThrow("Unauthorized message sender");
  });
});
