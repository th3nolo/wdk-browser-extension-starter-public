import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RPC_TIMEOUT_MS, rpcFetch, rpcFetchForChain } from "./rpc-fetch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rpc-fetch", () => {
  it("returns the first successful RPC response", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("primary down"))
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const response = await rpcFetch(["https://primary.example", "https://fallback.example"], { method: "POST" });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws RpcFetchError when every RPC endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await expect(rpcFetch(["https://primary.example"], { method: "POST" })).rejects.toMatchObject({
      name: "RpcFetchError",
      message: expect.stringContaining("failed")
    });
  });

  it("times out slow RPC endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));

    await expect(rpcFetch(["https://slow.example"], { method: "POST" }, 1)).rejects.toMatchObject({
      name: "RpcFetchError",
      timedOut: true,
      url: "https://slow.example"
    });
  });

  it("uses chain failover URLs for RPC requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("publicnode")) throw new Error("down");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await rpcFetchForChain("ethereum", { method: "POST" });

    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("llamarpc"))).toBe(true);
  });

  it("exposes a default RPC timeout constant", () => {
    expect(DEFAULT_RPC_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
