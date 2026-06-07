import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearWdkRuntimeCache, resetWdkRuntimeCacheForTests, withWdkRuntime } from "./runtime-cache";
import type { WdkManagerAdapter, WdkRuntime } from "./types";

const encoder = new TextEncoder();

function seedBytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function createMockRuntime(overrides: Partial<WdkManagerAdapter> = {}): WdkRuntime {
  const wdk: WdkManagerAdapter = {
    registerWallet: vi.fn(() => wdk),
    getAccount: vi.fn(),
    dispose: vi.fn(),
    ...overrides
  };
  return { wdk };
}

describe("wdk runtime cache", () => {
  beforeEach(() => {
    resetWdkRuntimeCacheForTests();
  });

  it("reuses the same runtime for repeated calls in a session", async () => {
    const load = vi.fn(async () => createMockRuntime());

    await withWdkRuntime(seedBytes("seed-a"), load, async () => "first");
    await withWdkRuntime(seedBytes("seed-a"), load, async () => "second");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads when the seed phrase changes", async () => {
    const load = vi.fn(async () => createMockRuntime());

    await withWdkRuntime(seedBytes("seed-a"), load, async () => undefined);
    await withWdkRuntime(seedBytes("seed-b"), load, async () => undefined);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads when RPC overrides change", async () => {
    const load = vi.fn(async () => createMockRuntime());

    await withWdkRuntime(seedBytes("seed-a"), load, async () => undefined);
    await withWdkRuntime(seedBytes("seed-a"), load, async () => undefined, { ethereum: "https://rpc.example.com" });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("disposes cached runtime on clear", async () => {
    const dispose = vi.fn();
    const load = vi.fn(async () => createMockRuntime({ dispose }));

    await withWdkRuntime(seedBytes("seed-a"), load, async () => undefined);
    await clearWdkRuntimeCache();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("decodes the seed phrase only when loading a new runtime", async () => {
    const load = vi.fn(async () => createMockRuntime());

    await withWdkRuntime(seedBytes("seed-a"), load, async () => "first");
    await withWdkRuntime(seedBytes("seed-a"), load, async () => "second");

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("seed-a", undefined);
  });
});
