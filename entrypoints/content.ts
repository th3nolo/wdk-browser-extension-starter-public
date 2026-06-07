import { DAPP_PROVIDER_EVENT_MESSAGE } from "../src/lib/background/dapp-provider-events";
import { attachBridgeMac, encodeBridgeSecret, generateBridgeSecret, verifyBridgeMessage } from "../src/lib/provider/bridge-auth";
import { CONTENT_TO_INPAGE } from "../src/lib/provider/constants";
import { isProviderRpcErrorResponse, toProviderRpcErrorPayload } from "../src/lib/provider/errors";
import { parseInpageRequestMessage } from "../src/lib/provider/rpc";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  main() {
    const bridgeSecret = generateBridgeSecret();
    const encodedBridgeToken = encodeBridgeSecret(bridgeSecret);

    async function postToInpage(payload: Record<string, unknown>) {
      window.postMessage(await attachBridgeMac(bridgeSecret, payload), location.origin);
    }

    function sendBackgroundMessage(message: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(response);
        });
      });
    }

    browser.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== browser.runtime.id) return;
      if (message?.type !== DAPP_PROVIDER_EVENT_MESSAGE) return;
      if (message.event === "chainChanged" && typeof message.chainId === "string") {
        void postToInpage({ target: CONTENT_TO_INPAGE, event: "chainChanged", chainId: message.chainId });
        return;
      }
      if (message.event === "accountsChanged" && Array.isArray(message.accounts)) {
        void postToInpage({ target: CONTENT_TO_INPAGE, event: "accountsChanged", accounts: message.accounts });
        return;
      }
      if (message.event === "connect" && typeof message.chainId === "string") {
        void postToInpage({ target: CONTENT_TO_INPAGE, event: "connect", chainId: message.chainId });
        return;
      }
      if (message.event === "disconnect" && message.error) {
        void postToInpage({ target: CONTENT_TO_INPAGE, event: "disconnect", error: message.error });
      }
    });

    const inpageUrl = browser.runtime.getURL("/inpage.js");
    const script = document.createElement("script");
    script.src = inpageUrl;
    script.dataset.wdkBridgeToken = encodedBridgeToken;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    window.addEventListener("message", async (event) => {
      if (event.source !== window) return;
      const verified = await verifyBridgeMessage(bridgeSecret, event.data);
      if (!verified) return;
      const parsed = parseInpageRequestMessage(verified);
      if (!parsed) return;
      if (!parsed.ok) {
        void postToInpage({ target: CONTENT_TO_INPAGE, id: parsed.id, error: parsed.error });
        return;
      }

      const { id, method, params } = parsed.request;
      try {
        const result = await sendBackgroundMessage({
          type: "DAPP_REQUEST",
          method,
          params
        });
        if (isProviderRpcErrorResponse(result)) {
          void postToInpage({ target: CONTENT_TO_INPAGE, id, error: result.__wdkProviderRpcError });
          return;
        }
        void postToInpage({ target: CONTENT_TO_INPAGE, id, result });
      } catch (error) {
        void postToInpage({ target: CONTENT_TO_INPAGE, id, error: toProviderRpcErrorPayload(error) });
      }
    });
  }
});
