import { rpcUrlsForChain } from "./rpc-endpoints";
import type { ChainId } from "./types";

export const DEFAULT_RPC_TIMEOUT_MS = 15_000;

export class RpcFetchError extends Error {
  readonly url?: string;
  readonly timedOut: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { cause?: unknown; url?: string; timedOut?: boolean; statusCode?: number } = {}) {
    super(message, { cause: options.cause });
    this.name = "RpcFetchError";
    this.url = options.url;
    this.timedOut = options.timedOut ?? false;
    this.statusCode = options.statusCode;
  }
}

function linkAbortSignal(parent: AbortSignal | null | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort(parent.reason);
    return () => {};
  }
  const onAbort = () => child.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

export async function rpcFetch(
  urls: readonly string[],
  init: RequestInit,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS
): Promise<Response> {
  if (!urls.length) throw new RpcFetchError("No RPC endpoints configured");

  let lastError: RpcFetchError | undefined;
  for (const url of urls) {
    const controller = new AbortController();
    const unlink = linkAbortSignal(init.signal, controller);
    const timeoutId = setTimeout(() => controller.abort(new Error("RPC request timed out")), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return response;
      lastError = new RpcFetchError(`RPC ${url} returned ${response.status}`, { url, statusCode: response.status });
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = new RpcFetchError(`RPC ${url} timed out after ${timeoutMs}ms`, { cause: error, url, timedOut: true });
      } else {
        lastError = new RpcFetchError(`RPC ${url} failed`, { cause: error, url });
      }
    } finally {
      clearTimeout(timeoutId);
      unlink();
    }
  }

  throw lastError ?? new RpcFetchError("All RPC endpoints failed");
}

export async function rpcFetchForChain(
  chainId: ChainId,
  init: RequestInit,
  override?: string,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS
): Promise<Response> {
  return rpcFetch(rpcUrlsForChain(chainId, override), init, timeoutMs);
}
