import { primaryRpcUrl } from "./rpc-endpoints";
import type { AssetId, ChainId } from "./types";

export type ChainDefinition = {
  id: ChainId;
  label: string;
  wdkKey: string;
  family: "btc" | "spark" | "evm" | "solana";
  nativeAsset: AssetId;
  rpcUrl?: string;
  chainId?: number;
  usdtContract?: string;
  xautContract?: string;
};

const CHAIN_METADATA = [
  { id: "bitcoin", label: "Bitcoin", wdkKey: "bitcoin", family: "btc", nativeAsset: "BTC" },
  { id: "spark", label: "Lightning (Spark)", wdkKey: "spark", family: "spark", nativeAsset: "SATS" },
  { id: "ethereum", label: "Ethereum", wdkKey: "ethereum", family: "evm", nativeAsset: "ETH", chainId: 1, usdtContract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", xautContract: "0x68749665FF8D2d112Fa859AA293F07A622782F38" },
  { id: "polygon", label: "Polygon", wdkKey: "polygon", family: "evm", nativeAsset: "POL", chainId: 137, usdtContract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
  { id: "arbitrum", label: "Arbitrum", wdkKey: "arbitrum", family: "evm", nativeAsset: "ETH", chainId: 42161, usdtContract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" },
  { id: "plasma", label: "Plasma", wdkKey: "plasma", family: "evm", nativeAsset: "XPL", chainId: 9745 },
  { id: "solana", label: "Solana", wdkKey: "solana", family: "solana", nativeAsset: "SOL" }
] as const satisfies ReadonlyArray<Omit<ChainDefinition, "rpcUrl"> & { id: ChainId }>;

export const CHAINS: ChainDefinition[] = CHAIN_METADATA.map((chain) => ({
  ...chain,
  rpcUrl: primaryRpcUrl(chain.id)
}));

export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((chain) => [chain.id, chain])) as Record<ChainId, ChainDefinition>;

export function supportedAssetsForChain(chainId: ChainId): AssetId[] {
  const chain = CHAIN_BY_ID[chainId];
  return [
    chain.nativeAsset,
    ...(chain.usdtContract ? ["USDt" as const] : []),
    ...(chain.xautContract ? ["XAUt" as const] : [])
  ];
}

export function isAssetSupportedOnChain(chainId: ChainId, asset: AssetId): boolean {
  return supportedAssetsForChain(chainId).includes(asset);
}

/** Base-unit decimals for an asset on a given chain. */
export function assetDecimals(chainId: ChainId, asset: AssetId): number {
  if (asset === "USDt" || asset === "XAUt") return 6;
  const family = CHAIN_BY_ID[chainId].family;
  if (family === "btc" || family === "spark") return 8;
  if (family === "solana") return 9;
  return 18;
}
