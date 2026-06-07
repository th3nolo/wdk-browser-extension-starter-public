import { attachBridgeMac, decodeBridgeSecret, verifyBridgeMessage } from "./bridge-auth";
import { CONTENT_TO_INPAGE, INPAGE_TO_CONTENT, PROVIDER_RDNS } from "./constants";
import {
  isProviderRpcErrorPayload,
  providerRpcErrorFromMessage,
  providerRpcErrorFromPayload,
  ProviderRpcError,
  type ProviderRpcErrorPayload
} from "./errors";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type ProviderListener = (...args: unknown[]) => void;

type LegacyEthereumProvider = { isWDKWallet?: boolean };

type ProviderRequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };

type ProviderWindow = Window & typeof globalThis & { ethereum?: LegacyEthereumProvider };

const DEFAULT_CHAIN_ID = "0x1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateProviderRequestArgs(args: unknown): ProviderRequestArgs {
  if (!isRecord(args) || typeof args.method !== "string" || args.method.length === 0) {
    throw providerRpcErrorFromMessage("Invalid provider method");
  }
  if (args.params !== undefined && !Array.isArray(args.params) && !isRecord(args.params)) {
    throw providerRpcErrorFromMessage("Invalid provider params");
  }
  return { method: args.method, params: args.params };
}

function rejectProviderRequest(entry: PendingRequest, error: string | ProviderRpcErrorPayload) {
  if (typeof error === "string") {
    entry.reject(providerRpcErrorFromMessage(error));
    return;
  }
  entry.reject(providerRpcErrorFromPayload(error));
}

const PROVIDER_UUID = "6ad97f0a-8c7b-4c99-9d12-wdk-browser-starter";
const PROVIDER_NAME = "WDK Browser Wallet";
const PROVIDER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23101b2d'/%3E%3Cpath d='M17 20h30v24H17z' fill='%23f1f5f9'/%3E%3Cpath d='M23 26h18v4H23zm0 8h12v4H23z' fill='%23101b2d'/%3E%3C/svg%3E";

export const providerInfo = {
  uuid: PROVIDER_UUID,
  name: PROVIDER_NAME,
  rdns: PROVIDER_RDNS,
  icon: PROVIDER_ICON
};

export function installInpageProvider(
  encodedBridgeSecret: string,
  pageWindow: ProviderWindow = window as ProviderWindow
) {
  const bridgeSecret = decodeBridgeSecret(encodedBridgeSecret);
  const pending = new Map<string, PendingRequest>();
  const listeners = new Map<string, Set<ProviderListener>>();
  let chainId = DEFAULT_CHAIN_ID;

  function on(event: string, listener: ProviderListener) {
    const bucket = listeners.get(event) ?? new Set<ProviderListener>();
    bucket.add(listener);
    listeners.set(event, bucket);
  }

  function once(event: string, listener: ProviderListener) {
    const wrapped: ProviderListener = (...args) => {
      removeListener(event, wrapped);
      listener(...args);
    };
    on(event, wrapped);
  }

  function removeListener(event: string, listener: ProviderListener) {
    listeners.get(event)?.delete(listener);
  }

  function removeAllListeners(event?: string) {
    if (event === undefined) {
      listeners.clear();
      return;
    }
    listeners.delete(event);
  }

  function emit(event: string, ...args: unknown[]) {
    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch {
        // Ignore listener failures so one dApp handler cannot break the provider.
      }
    }
  }

  function setChainId(nextChainId: string) {
    chainId = nextChainId;
  }

  function createRequestId(): string {
    if (typeof pageWindow.crypto.randomUUID === "function") return pageWindow.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    pageWindow.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function request(args: ProviderRequestArgs) {
    let validated: ProviderRequestArgs;
    try {
      validated = validateProviderRequestArgs(args);
    } catch (error) {
      return Promise.reject(error);
    }
    const id = createRequestId();
    void attachBridgeMac(bridgeSecret, {
      target: INPAGE_TO_CONTENT,
      id,
      method: validated.method,
      params: validated.params ?? []
    }).then((message) => {
      pageWindow.postMessage(message, pageWindow.location.origin);
    });

    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => {
          if (validated.method === "eth_chainId" && typeof value === "string") setChainId(value);
          resolve(value);
        },
        reject
      });
      pageWindow.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new ProviderRpcError(-32603, "WDK provider request timed out"));
      }, 60_000);
    });
  }

  const provider = {
    isWDKWallet: true,
    get chainId() {
      return chainId;
    },
    request,
    on,
    once,
    removeListener,
    removeAllListeners
  };

  function announceProvider() {
    pageWindow.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: providerInfo, provider }
    }));
  }

  function installLegacyEthereumProvider() {
    const descriptor = Object.getOwnPropertyDescriptor(pageWindow, "ethereum");
    if (descriptor && descriptor.configurable === false) return;
    if (pageWindow.ethereum && !pageWindow.ethereum.isWDKWallet) return;

    Object.defineProperty(pageWindow, "ethereum", {
      value: provider,
      configurable: true,
      writable: false
    });
  }

  function handleContentMessage(event: MessageEvent) {
    if (event.source !== pageWindow || event.data?.target !== CONTENT_TO_INPAGE) return;
    void verifyBridgeMessage(bridgeSecret, event.data).then((data) => {
      if (!data) return;
      if (data.event === "chainChanged" && typeof data.chainId === "string") {
        setChainId(data.chainId);
        emit("chainChanged", data.chainId);
        return;
      }
      if (data.event === "accountsChanged" && Array.isArray(data.accounts)) {
        emit("accountsChanged", data.accounts);
        return;
      }
      if (data.event === "connect" && typeof data.chainId === "string") {
        setChainId(data.chainId);
        emit("connect", { chainId: data.chainId });
        return;
      }
      if (data.event === "disconnect" && isProviderRpcErrorPayload(data.error)) {
        emit("disconnect", providerRpcErrorFromPayload(data.error));
        return;
      }
      if (typeof data.id !== "string") return;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) {
        if (typeof data.error === "string" || isProviderRpcErrorPayload(data.error)) {
          rejectProviderRequest(entry, data.error);
        }
        return;
      }
      entry.resolve(data.result);
    });
  }

  installLegacyEthereumProvider();
  pageWindow.addEventListener("message", handleContentMessage);
  pageWindow.addEventListener("eip6963:requestProvider", announceProvider);
  announceProvider();

  // Emit an initial EIP-1193 connect on the next tick so dApps that attach a
  // listener immediately after obtaining the provider are notified it is ready.
  pageWindow.setTimeout(() => emit("connect", { chainId }), 0);

  return {
    provider,
    providerInfo,
    teardown() {
      pageWindow.removeEventListener("message", handleContentMessage);
      pageWindow.removeEventListener("eip6963:requestProvider", announceProvider);
      pending.clear();
      listeners.clear();
    }
  };
}
