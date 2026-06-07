import { describe, expect, it } from "vitest";
import {
  isSupportedEvmNumericChainId,
  parseHexChainId,
  parseSwitchEthereumChainParams,
  toHexChainId,
  walletChainFromNumericChainId
} from "./evm-chains";
import { PROVIDER_RPC_ERROR_CODES, ProviderRpcError } from "./provider/errors";

describe("evm chain helpers", () => {
  it("round-trips supported numeric chain IDs", () => {
    expect(toHexChainId(137)).toBe("0x89");
    expect(parseHexChainId("0x89")).toBe(137);
    expect(walletChainFromNumericChainId(137)).toBe("polygon");
    expect(isSupportedEvmNumericChainId(9745)).toBe(true);
    expect(isSupportedEvmNumericChainId(999)).toBe(false);
  });

  it("parses wallet_switchEthereumChain params", () => {
    expect(parseSwitchEthereumChainParams([{ chainId: "0xa4b1" }])).toBe(42161);
  });

  it("rejects malformed switch params with EIP-1193 codes", () => {
    expect(() => parseSwitchEthereumChainParams([])).toThrow(ProviderRpcError);
    expect(() => parseSwitchEthereumChainParams([])).toThrow(
      expect.objectContaining({
        code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
        message: "Invalid wallet_switchEthereumChain params"
      })
    );
    expect(() => parseSwitchEthereumChainParams([{ chainId: "not-hex" }])).toThrow(ProviderRpcError);
    expect(() => parseSwitchEthereumChainParams([{ chainId: "not-hex" }])).toThrow(
      expect.objectContaining({
        code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
        message: "Invalid chain ID"
      })
    );
  });
});
