import "../src/shims/buffer";
import { createBackgroundWalletController } from "../src/lib/background/controller";
import { toBackgroundErrorResponse } from "../src/lib/background/error-response";
import { parseBackgroundMessage } from "../src/lib/schemas/messages";
import { PROVIDER_RPC_ERROR_RESPONSE_KEY, toProviderRpcErrorPayload } from "../src/lib/provider/errors";

export default defineBackground(() => {
  const controller = createBackgroundWalletController();
  void controller.initialize();

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let parsed;
    try {
      parsed = parseBackgroundMessage(message);
    } catch (error) {
      sendResponse(toBackgroundErrorResponse(error));
      return false;
    }

    Promise.resolve(controller.handleMessage(parsed, sender)).then(
      (result) => sendResponse(result),
      (error) => {
        sendResponse(parsed.type === "DAPP_REQUEST"
          ? { [PROVIDER_RPC_ERROR_RESPONSE_KEY]: toProviderRpcErrorPayload(error) }
          : toBackgroundErrorResponse(error));
      }
    );
    return true;
  });

  void browser.alarms.create("wallet-session-timeout", { periodInMinutes: 1 });
  void browser.alarms.create("transaction-status-refresh", { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "wallet-session-timeout") {
      void controller.expireIdleSession();
    }
    if (alarm.name === "transaction-status-refresh") {
      void controller.refreshPendingTransactions();
    }
  });
});
