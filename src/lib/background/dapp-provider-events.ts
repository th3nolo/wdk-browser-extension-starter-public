import { PROVIDER_RPC_ERROR_CODES, type ProviderRpcErrorPayload } from "../provider/errors";
import { toHexChainId } from "../evm-chains";
import { dappMessageTargetsForOrigin, removeDappMessageTarget, type DappMessageTarget } from "./dapp-targets";

export const DAPP_PROVIDER_EVENT_MESSAGE = "DAPP_PROVIDER_EVENT";

/** @deprecated Use DAPP_PROVIDER_EVENT_MESSAGE */
export const DAPP_CHAIN_CHANGED_MESSAGE = DAPP_PROVIDER_EVENT_MESSAGE;

type DappProviderEventMessage =
  | { type: typeof DAPP_PROVIDER_EVENT_MESSAGE; event: "chainChanged"; chainId: string }
  | { type: typeof DAPP_PROVIDER_EVENT_MESSAGE; event: "accountsChanged"; accounts: string[] }
  | { type: typeof DAPP_PROVIDER_EVENT_MESSAGE; event: "connect"; chainId: string }
  | { type: typeof DAPP_PROVIDER_EVENT_MESSAGE; event: "disconnect"; error: ProviderRpcErrorPayload };

async function broadcastDappProviderEvent(origin: string, message: DappProviderEventMessage): Promise<void> {
  const targets = await dappMessageTargetsForOrigin(origin);
  await Promise.all(targets.map(async (target) => {
    try {
      await browser.tabs.sendMessage(target.tabId, message, targetSendOptions(target));
    } catch {
      await removeDappMessageTarget(target);
    }
  }));
}

function targetSendOptions(target: DappMessageTarget): Browser.tabs.MessageSendOptions {
  if (target.documentId) return { documentId: target.documentId };
  if (target.frameId !== undefined) return { frameId: target.frameId };
  return {};
}

export async function broadcastDappChainChanged(origin: string, chainIdHex: string): Promise<void> {
  await broadcastDappProviderEvent(origin, {
    type: DAPP_PROVIDER_EVENT_MESSAGE,
    event: "chainChanged",
    chainId: chainIdHex
  });
}

export async function broadcastDappAccountsChanged(origin: string, accounts: string[]): Promise<void> {
  await broadcastDappProviderEvent(origin, {
    type: DAPP_PROVIDER_EVENT_MESSAGE,
    event: "accountsChanged",
    accounts
  });
}

export async function broadcastDappConnect(origin: string, chainIdHex: string): Promise<void> {
  await broadcastDappProviderEvent(origin, {
    type: DAPP_PROVIDER_EVENT_MESSAGE,
    event: "connect",
    chainId: chainIdHex
  });
}

export async function broadcastDappDisconnect(origin: string): Promise<void> {
  await broadcastDappProviderEvent(origin, {
    type: DAPP_PROVIDER_EVENT_MESSAGE,
    event: "disconnect",
    error: {
      code: PROVIDER_RPC_ERROR_CODES.DISCONNECTED,
      message: "Wallet disconnected from site"
    }
  });
}

/** Notify a site that the wallet session ended (lock, revoke, or vault removal). */
export async function broadcastDappSessionClosed(origin: string): Promise<void> {
  await broadcastDappAccountsChanged(origin, []);
  await broadcastDappDisconnect(origin);
}

export async function broadcastDappConnectState(origin: string, accounts: string[], numericChainId: number): Promise<void> {
  const chainIdHex = toHexChainId(numericChainId);
  if (accounts.length) {
    await broadcastDappConnect(origin, chainIdHex);
    await broadcastDappAccountsChanged(origin, accounts);
    return;
  }
  await broadcastDappAccountsChanged(origin, []);
}
