/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBridgeMac, encodeBridgeSecret, generateBridgeSecret } from "./bridge-auth";
import { CONTENT_TO_INPAGE, INPAGE_TO_CONTENT, PROVIDER_RDNS } from "./constants";
import { ProviderRpcError, PROVIDER_RPC_ERROR_CODES } from "./errors";
import { installInpageProvider } from "./inpage";

describe("inpage provider installation", () => {
  const pageWindow = window as Window & { ethereum?: unknown };
  const teardowns: Array<() => void> = [];
  let bridgeSecret = generateBridgeSecret();
  let encodedBridgeSecret = encodeBridgeSecret(bridgeSecret);

  async function postFromContent(payload: Record<string, unknown>, assertProcessed: () => boolean) {
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: await attachBridgeMac(bridgeSecret, payload)
    }));
    await vi.waitFor(() => {
      if (!assertProcessed()) throw new Error("Bridge message not processed yet");
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    while (teardowns.length) teardowns.pop()?.();
  });

  beforeEach(() => {
    bridgeSecret = generateBridgeSecret();
    encodedBridgeSecret = encodeBridgeSecret(bridgeSecret);
    delete pageWindow.ethereum;
    vi.spyOn(crypto, "randomUUID").mockReturnValue("request-1" as `${string}-${string}-${string}-${string}-${string}`);
  });

  it("installs the legacy provider when no page provider exists", () => {
    const observed: unknown[] = [];
    window.addEventListener("eip6963:announceProvider", (event) => observed.push((event as CustomEvent).detail));

    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    expect(pageWindow.ethereum).toBe(provider);
    expect(Object.getOwnPropertyDescriptor(window, "ethereum")).toMatchObject({ configurable: true, writable: false });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      info: { name: "WDK Browser Wallet", rdns: PROVIDER_RDNS },
      provider
    });
  });

  it("announces through EIP-6963 without clobbering an existing page provider", () => {
    const existingProvider = { isMetaMask: true };
    Object.defineProperty(window, "ethereum", { value: existingProvider, configurable: true });
    const observed: unknown[] = [];
    window.addEventListener("eip6963:announceProvider", (event) => observed.push((event as CustomEvent).detail));

    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect(pageWindow.ethereum).toBe(existingProvider);
    expect(observed).toHaveLength(2);
    expect(observed[1]).toMatchObject({ info: { rdns: PROVIDER_RDNS }, provider });
  });

  it("routes provider requests and resolves authenticated content responses", async () => {
    const posted: Array<{ message: unknown; targetOrigin: string }> = [];
    vi.spyOn(window, "postMessage").mockImplementation((message, targetOrigin) => {
      posted.push({ message, targetOrigin: String(targetOrigin) });
    });
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    const result = provider.request({ method: "eth_accounts" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(posted[0]?.targetOrigin).toBe(window.location.origin);
    expect(posted[0]?.message).toMatchObject({
      target: INPAGE_TO_CONTENT,
      id: "request-1",
      method: "eth_accounts",
      params: []
    });
    expect(posted[0]?.message).toHaveProperty("mac");

    await postFromContent({ target: CONTENT_TO_INPAGE, id: "request-1", result: ["0xabc"] }, () => true);
    await expect(result).resolves.toEqual(["0xabc"]);
  });

  it("ignores unsigned or forged content bridge responses", async () => {
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    const result = provider.request({ method: "eth_accounts" });
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: { target: CONTENT_TO_INPAGE, id: "request-1", result: ["0xabc"] }
    }));

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50))
    ])).resolves.toBe("pending");
  });

  it("rejects malformed provider requests before posting to the page bridge", async () => {
    const postMessage = vi.spyOn(window, "postMessage");
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    await expect(provider.request({ method: "" })).rejects.toThrow("Invalid provider method");
    await expect(provider.request({ method: "eth_accounts", params: "bad" } as never)).rejects.toThrow("Invalid provider params");
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ target: INPAGE_TO_CONTENT }), expect.anything());
  });

  it("rejects content bridge error responses with ProviderRpcError codes", async () => {
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    const result = provider.request({ method: "eth_requestAccounts" });
    const rejection = expect(result).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      message: "Connection approval required"
    });
    await postFromContent({
      target: CONTENT_TO_INPAGE,
      id: "request-1",
      error: { code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, message: "Connection approval required" }
    }, () => true);

    await rejection;
  });

  it("exposes chainId and updates it from authenticated chainChanged events", async () => {
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    expect(provider.chainId).toBe("0x1");
    await postFromContent({ target: CONTENT_TO_INPAGE, event: "chainChanged", chainId: "0x89" }, () => provider.chainId === "0x89");
    expect(provider.chainId).toBe("0x89");
  });

  it("emits an initial connect event on the next tick", async () => {
    const connects: string[] = [];
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);
    provider.on("connect", (info) => connects.push((info as { chainId: string }).chainId));

    await vi.waitFor(() => expect(connects).toEqual(["0x1"]));
  });

  it("emits accountsChanged, connect, and disconnect provider events", async () => {
    const accounts: string[][] = [];
    const connects: string[] = [];
    const disconnects: ProviderRpcError[] = [];
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);
    provider.on("accountsChanged", (next) => accounts.push(next as string[]));
    provider.on("connect", (info) => connects.push((info as { chainId: string }).chainId));
    provider.on("disconnect", (error) => disconnects.push(error as ProviderRpcError));

    // Wait out the initial connect emitted on provider install before asserting bridge-driven events.
    await vi.waitFor(() => expect(connects).toEqual(["0x1"]));
    await postFromContent({ target: CONTENT_TO_INPAGE, event: "accountsChanged", accounts: ["0xabc"] }, () => accounts.length === 1);
    await postFromContent({ target: CONTENT_TO_INPAGE, event: "connect", chainId: "0x89" }, () => connects.length === 2);
    await postFromContent({
      target: CONTENT_TO_INPAGE,
      event: "disconnect",
      error: { code: PROVIDER_RPC_ERROR_CODES.DISCONNECTED, message: "Wallet disconnected from site" }
    }, () => disconnects.length === 1);

    expect(accounts).toEqual([["0xabc"]]);
    expect(connects).toEqual(["0x1", "0x89"]);
    expect(disconnects[0]).toMatchObject({ code: PROVIDER_RPC_ERROR_CODES.DISCONNECTED });
  });

  it("supports once and removeAllListeners", async () => {
    const onceCalls: string[][] = [];
    const persistentCalls: string[][] = [];
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);
    provider.once("accountsChanged", (next) => onceCalls.push(next as string[]));
    provider.on("accountsChanged", (next) => persistentCalls.push(next as string[]));

    await postFromContent({ target: CONTENT_TO_INPAGE, event: "accountsChanged", accounts: ["0xabc"] }, () => persistentCalls.length === 1);
    await postFromContent({ target: CONTENT_TO_INPAGE, event: "accountsChanged", accounts: ["0xdef"] }, () => persistentCalls.length === 2);

    expect(onceCalls).toEqual([["0xabc"]]);

    provider.removeAllListeners("accountsChanged");
    await postFromContent({ target: CONTENT_TO_INPAGE, event: "accountsChanged", accounts: ["0x123"] }, () => true);

    expect(persistentCalls).toEqual([["0xabc"], ["0xdef"]]);
  });

  it("emits chainChanged when the content bridge broadcasts a chain update", async () => {
    const observed: string[] = [];
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);
    provider.on("chainChanged", (chainId) => observed.push(String(chainId)));

    await postFromContent({ target: CONTENT_TO_INPAGE, event: "chainChanged", chainId: "0x89" }, () => observed.length === 1);

    expect(observed).toEqual(["0x89"]);
  });

  it("times out provider requests that do not receive a content response", async () => {
    vi.useFakeTimers();
    const { provider, teardown } = installInpageProvider(encodedBridgeSecret);
    teardowns.push(teardown);

    const result = expect(provider.request({ method: "eth_accounts" })).rejects.toThrow("WDK provider request timed out");
    await vi.advanceTimersByTimeAsync(60_000);

    await result;
  });
});
