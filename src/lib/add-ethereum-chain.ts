import { isSupportedEvmNumericChainId, parseHexChainId } from "./evm-chains";
import { PROVIDER_RPC_ERROR_CODES, ProviderRpcError } from "./provider/errors";

export function parseAddEthereumChainParams(params: unknown): number {
  const list = Array.isArray(params) ? params : [];
  const entry = list[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN, "Invalid wallet_addEthereumChain params");
  }
  const chainIdRaw = (entry as Record<string, unknown>).chainId;
  if (typeof chainIdRaw !== "string") {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN, "Invalid wallet_addEthereumChain params");
  }
  const chainId = parseHexChainId(chainIdRaw);
  if (chainId === undefined) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN, "Invalid chain ID");
  }
  if (!isSupportedEvmNumericChainId(chainId)) {
    throw new ProviderRpcError(
      PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      "Only pre-configured WDK networks can be added. Custom RPC endpoints are not supported."
    );
  }
  return chainId;
}
