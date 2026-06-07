import type { ChainId } from "./types";

export const BTC_ADDRESS_BALANCE_URLS = [
  "https://blockstream.info/api",
  "https://mempool.space/api"
] as const;

/** Default and fallback RPC URLs per chain. First entry is the primary endpoint. */
export const CHAIN_RPC_URLS: Partial<Record<ChainId, readonly string[]>> = {
  bitcoin: BTC_ADDRESS_BALANCE_URLS,
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
  ],
  polygon: [
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
    "https://rpc.ankr.com/polygon"
  ],
  arbitrum: [
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arbitrum.llamarpc.com",
    "https://rpc.ankr.com/arbitrum"
  ],
  plasma: ["https://rpc.plasma.to"],
  // The public Solana RPCs (api.mainnet-beta.solana.com / api.mainnet.solana.com)
  // return 403 for app/extension-origin traffic, so they are not usable as fallbacks.
  // publicnode is keyless and CORS-friendly; add a keyed endpoint via RPC override for redundancy.
  solana: ["https://solana-rpc.publicnode.com"]
};

export const BTC_BLOCKBOOK_URL = "https://btc1.trezor.io/api";
export const SPARK_SERVICE_URLS = [
  "https://api.lightspark.com",
  "https://api.sparkscan.io",
  "https://0.spark.lightspark.com",
  "https://spark-operator.breez.technology",
  "https://2.spark.flashnet.xyz",
  "https://mempool.space/api",
  "https://regtest-mempool.us-west-2.sparkinfra.net/api"
] as const;

const LOCAL_DEV_RPC_PERMISSIONS = ["http://localhost/*", "http://127.0.0.1/*"] as const;

function collectConfiguredRpcUrls(): string[] {
  const urls = Object.values(CHAIN_RPC_URLS).flatMap((entries) => entries ?? []);
  urls.push(BTC_BLOCKBOOK_URL);
  urls.push(...SPARK_SERVICE_URLS);
  return urls;
}

export function primaryRpcUrl(chainId: ChainId): string | undefined {
  return CHAIN_RPC_URLS[chainId]?.[0];
}

export function rpcUrlsForChain(chainId: ChainId, override?: string): readonly string[] {
  const defaults = CHAIN_RPC_URLS[chainId] ?? [];
  if (!override) return defaults;
  return [override, ...defaults.filter((url) => url !== override)];
}

export function isHttpsRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isLocalDevRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

export function isValidRpcOverrideUrl(value: string): boolean {
  return isHttpsRpcUrl(value) || isLocalDevRpcUrl(value);
}

export function urlToHostPermissionPattern(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function urlToConnectSrcOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Host permission patterns derived from configured default RPC endpoints. */
export function rpcHostPermissionPatterns(): string[] {
  return uniqueSorted(collectConfiguredRpcUrls().map(urlToHostPermissionPattern));
}

/** CSP connect-src origins for extension pages that call RPC directly. */
export function rpcConnectSrcOrigins(): string[] {
  return uniqueSorted(collectConfiguredRpcUrls().map(urlToConnectSrcOrigin));
}

export function buildHostPermissions(): string[] {
  return uniqueSorted([...rpcHostPermissionPatterns(), ...LOCAL_DEV_RPC_PERMISSIONS]);
}

export function buildConnectSrcDirective(): string {
  const origins = uniqueSorted(["'self'", ...rpcConnectSrcOrigins(), ...LOCAL_DEV_RPC_PERMISSIONS.map((entry) => entry.replace("/*", ""))]);
  return `connect-src ${origins.join(" ")}`;
}

export function isHostPermissionCovered(url: string, grantedPatterns: readonly string[]): boolean {
  const pattern = urlToHostPermissionPattern(url);
  return grantedPatterns.includes(pattern);
}
