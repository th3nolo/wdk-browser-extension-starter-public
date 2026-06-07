import { secureZeroBytes } from "../crypto/secure-zero";
import type { RpcOverrides } from "../rpc-overrides";
import type { WdkRuntime } from "./types";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

let cachedRuntime: { cacheKey: string; runtime: WdkRuntime } | undefined;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runtimeCacheKey(seedPhraseBytes: Uint8Array, rpcOverrides?: RpcOverrides): Promise<string> {
  const parts: Uint8Array[] = [seedPhraseBytes, new Uint8Array([0])];
  if (rpcOverrides) {
    parts.push(encoder.encode(JSON.stringify(rpcOverrides)));
  }
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const material = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    material.set(part, offset);
    offset += part.length;
    if (part !== seedPhraseBytes) secureZeroBytes(part);
  }
  const digest = await crypto.subtle.digest("SHA-256", material);
  secureZeroBytes(material);
  return bytesToHex(new Uint8Array(digest));
}

export async function withWdkRuntime<T>(
  seedPhraseBytes: Uint8Array,
  load: (seedPhrase: string, rpcOverrides?: RpcOverrides) => Promise<WdkRuntime>,
  run: (runtime: WdkRuntime) => Promise<T>,
  rpcOverrides?: RpcOverrides
): Promise<T> {
  const runtime = await acquireWdkRuntime(seedPhraseBytes, load, rpcOverrides);
  return run(runtime);
}

async function acquireWdkRuntime(
  seedPhraseBytes: Uint8Array,
  load: (seedPhrase: string, rpcOverrides?: RpcOverrides) => Promise<WdkRuntime>,
  rpcOverrides?: RpcOverrides
): Promise<WdkRuntime> {
  const cacheKey = await runtimeCacheKey(seedPhraseBytes, rpcOverrides);
  if (cachedRuntime?.cacheKey === cacheKey) {
    return cachedRuntime.runtime;
  }
  await clearWdkRuntimeCache();
  let seedPhrase: string | undefined = decoder.decode(seedPhraseBytes);
  try {
    const runtime = await load(seedPhrase, rpcOverrides);
    cachedRuntime = { cacheKey, runtime };
    return runtime;
  } finally {
    seedPhrase = undefined;
  }
}

export async function clearWdkRuntimeCache(): Promise<void> {
  if (!cachedRuntime) return;
  cachedRuntime.runtime.wdk.dispose?.();
  cachedRuntime = undefined;
}

/** Test helper to reset cached runtime without simulating a service worker restart. */
export function resetWdkRuntimeCacheForTests(): void {
  cachedRuntime = undefined;
}
