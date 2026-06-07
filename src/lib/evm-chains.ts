import { CHAINS } from "./chains";
import { PROVIDER_RPC_ERROR_CODES, ProviderRpcError } from "./provider/errors";
import type { ChainId } from "./types";

export const DEFAULT_EVM_NUMERIC_CHAIN_ID = 1;

const EVM_CHAIN_BY_NUMERIC_ID = new Map(
  CHAINS.filter((chain) => chain.family === "evm" && chain.chainId !== undefined).map((chain) => [chain.chainId!, chain.id as ChainId])
);

export function isSupportedEvmNumericChainId(chainId: number): boolean {
  return EVM_CHAIN_BY_NUMERIC_ID.has(chainId);
}

export function walletChainFromNumericChainId(chainId: number): ChainId | undefined {
  return EVM_CHAIN_BY_NUMERIC_ID.get(chainId);
}

export function numericChainIdFromWalletChain(chain: ChainId): number | undefined {
  const definition = CHAINS.find((entry) => entry.id === chain && entry.family === "evm");
  return definition?.chainId;
}

export function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

export function parseHexChainId(value: string): number | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseSwitchEthereumChainParams(params: unknown): number {
  const list = Array.isArray(params) ? params : [];
  const entry = list[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ProviderRpcError(
      PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      "Invalid wallet_switchEthereumChain params"
    );
  }
  const chainId = (entry as Record<string, unknown>).chainId;
  if (typeof chainId !== "string") {
    throw new ProviderRpcError(
      PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      "Invalid wallet_switchEthereumChain params"
    );
  }
  const parsed = parseHexChainId(chainId);
  if (parsed === undefined) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN, "Invalid chain ID");
  }
  return parsed;
}
