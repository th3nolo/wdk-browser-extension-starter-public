import { describe, expect, it } from "vitest";
import {
  PROVIDER_RPC_ERROR_CODES,
  providerRpcErrorFromMessage,
  toProviderRpcError,
  toProviderRpcErrorPayload
} from "./errors";

describe("provider RPC errors", () => {
  it("maps known controller messages to EIP-1193 codes", () => {
    expect(providerRpcErrorFromMessage("Wallet is locked").code).toBe(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED);
    expect(providerRpcErrorFromMessage("Connection approval required. Open popup.").code).toBe(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED);
    expect(providerRpcErrorFromMessage("Signature request cancelled").code).toBe(PROVIDER_RPC_ERROR_CODES.USER_REJECTED);
    expect(providerRpcErrorFromMessage("Unsupported dApp method: eth_sign").code).toBe(PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD);
    expect(providerRpcErrorFromMessage("Unrecognized chain ID. Try adding the chain first.").code).toBe(PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN);
  });

  it("preserves explicit ProviderRpcError instances", () => {
    const error = providerRpcErrorFromMessage("Wallet is locked");
    expect(toProviderRpcError(error)).toBe(error);
    expect(toProviderRpcErrorPayload(error)).toEqual({ code: 4100, message: "Wallet is locked" });
  });
});
