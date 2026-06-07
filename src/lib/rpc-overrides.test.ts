import { describe, expect, it } from "vitest";
import { mergeRpcOverrides, sanitizeRpcOverrides } from "./rpc-overrides";

describe("rpc-overrides", () => {
  it("sanitizes invalid override URLs", () => {
    expect(sanitizeRpcOverrides({
      ethereum: "https://rpc.example.com",
      polygon: "ftp://bad.example"
    })).toEqual({
      ethereum: "https://rpc.example.com"
    });
  });

  it("merges and clears per-chain overrides", () => {
    expect(mergeRpcOverrides(undefined, "ethereum", "https://rpc.example.com")).toEqual({
      ethereum: "https://rpc.example.com"
    });
    expect(mergeRpcOverrides({ ethereum: "https://rpc.example.com" }, "ethereum", undefined)).toEqual({});
  });

  it("rejects invalid override URLs", () => {
    expect(() => mergeRpcOverrides(undefined, "ethereum", "not-a-url")).toThrow("RPC URL must be a valid https endpoint or local dev URL");
  });
});
