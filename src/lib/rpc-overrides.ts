import {
  buildHostPermissions,
  isHostPermissionCovered,
  isValidRpcOverrideUrl,
  urlToHostPermissionPattern
} from "./rpc-endpoints";
import type { ChainId } from "./types";

export type RpcOverrides = Partial<Record<ChainId, string>>;

const DEFAULT_HOST_PERMISSIONS = buildHostPermissions();

export function sanitizeRpcOverrides(input: RpcOverrides | undefined): RpcOverrides {
  if (!input) return {};
  const sanitized: RpcOverrides = {};
  for (const [chainId, url] of Object.entries(input) as Array<[ChainId, string]>) {
    if (typeof url === "string" && isValidRpcOverrideUrl(url)) {
      sanitized[chainId] = url;
    }
  }
  return sanitized;
}

export function mergeRpcOverrides(
  current: RpcOverrides | undefined,
  chainId: ChainId,
  url: string | undefined
): RpcOverrides {
  const next = { ...sanitizeRpcOverrides(current) };
  if (url === undefined) {
    delete next[chainId];
    return next;
  }
  if (!isValidRpcOverrideUrl(url)) {
    throw new Error("RPC URL must be a valid https endpoint or local dev URL");
  }
  next[chainId] = url;
  return next;
}

export async function listGrantedRpcHostPatterns(): Promise<string[]> {
  const granted = await browser.permissions.getAll();
  return [...DEFAULT_HOST_PERMISSIONS, ...(granted.origins ?? [])];
}

export async function ensureRpcOverridePermission(url: string): Promise<boolean> {
  if (!isValidRpcOverrideUrl(url)) return false;

  const granted = await listGrantedRpcHostPatterns();
  if (isHostPermissionCovered(url, granted)) return true;

  const pattern = urlToHostPermissionPattern(url);
  return browser.permissions.request({ origins: [pattern] });
}
