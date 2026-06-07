import { describe, expect, it } from "vitest";
import {
  buildConnectSrcDirective,
  buildHostPermissions,
  isValidRpcOverrideUrl,
  primaryRpcUrl,
  rpcHostPermissionPatterns,
  rpcUrlsForChain,
  urlToHostPermissionPattern
} from "./rpc-endpoints";

describe("rpc-endpoints", () => {
  it("derives primary RPC URLs for configured chains", () => {
    expect(primaryRpcUrl("ethereum")).toBe("https://ethereum-rpc.publicnode.com");
    expect(primaryRpcUrl("solana")).toBe("https://solana-rpc.publicnode.com");
    expect(primaryRpcUrl("spark")).toBeUndefined();
  });

  it("includes failover endpoints after the primary URL", () => {
    expect(rpcUrlsForChain("ethereum")).toEqual([
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth"
    ]);
  });

  it("uses browser-reachable fallback URLs for Solana and Bitcoin reads", () => {
    expect(rpcUrlsForChain("solana")).toEqual([
      "https://solana-rpc.publicnode.com"
    ]);
    expect(rpcUrlsForChain("bitcoin")).toEqual([
      "https://blockstream.info/api",
      "https://mempool.space/api"
    ]);
  });

  it("places user overrides ahead of defaults", () => {
    expect(rpcUrlsForChain("ethereum", "https://custom.example/rpc")).toEqual([
      "https://custom.example/rpc",
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth"
    ]);
  });

  it("builds host permission patterns without broad wildcards", () => {
    const patterns = rpcHostPermissionPatterns();
    expect(patterns).toContain("https://ethereum-rpc.publicnode.com/*");
    expect(patterns).toContain("https://solana-rpc.publicnode.com/*");
    expect(patterns).toContain("https://mempool.space/*");
    expect(patterns).not.toContain("https://*/*");
  });

  it("builds manifest host permissions for default RPCs and local dev", () => {
    const permissions = buildHostPermissions();
    expect(permissions).toContain("https://ethereum-rpc.publicnode.com/*");
    expect(permissions).toContain("https://api.lightspark.com/*");
    expect(permissions).toContain("https://api.sparkscan.io/*");
    expect(permissions).toContain("http://localhost/*");
    expect(permissions).not.toContain("https://*/*");
  });

  it("builds a connect-src directive scoped to configured RPC origins", () => {
    const directive = buildConnectSrcDirective();
    expect(directive.startsWith("connect-src ")).toBe(true);
    expect(directive).toContain("'self'");
    expect(directive).toContain("https://ethereum-rpc.publicnode.com");
    expect(directive).toContain("https://api.lightspark.com");
    expect(directive).toContain("https://api.sparkscan.io");
    expect(directive).not.toContain("https://*");
  });

  it("validates RPC override URLs", () => {
    expect(isValidRpcOverrideUrl("https://rpc.example.com")).toBe(true);
    expect(isValidRpcOverrideUrl("http://localhost:8545")).toBe(true);
    expect(isValidRpcOverrideUrl("http://evil.test")).toBe(false);
    expect(isValidRpcOverrideUrl("not-a-url")).toBe(false);
  });

  it("maps RPC URLs to host permission patterns", () => {
    expect(urlToHostPermissionPattern("https://rpc.example.com/v1/key")).toBe("https://rpc.example.com/*");
  });
});
