import { z } from "zod";
import { isValidRpcOverrideUrl } from "../rpc-endpoints";
import type { ParsedStoredState } from "../storage/store";
import type { ChainId } from "../types";
import {
  dappConnectionRequestSchema,
  dappConnectionSchema,
  transactionRecordSchema,
  walletRecordSchema
} from "./common";
import { encryptedVaultSchema, parseVaultMap } from "./vault";

const chainIdSchema = z.enum(["bitcoin", "spark", "ethereum", "polygon", "arbitrum", "plasma", "solana"]);

function parseRpcOverrides(input: unknown): Partial<Record<ChainId, string>> | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) return undefined;

  const overrides: Partial<Record<ChainId, string>> = {};
  for (const [chainId, url] of Object.entries(input)) {
    const parsedChainId = chainIdSchema.safeParse(chainId);
    if (!parsedChainId.success || typeof url !== "string" || !isValidRpcOverrideUrl(url)) continue;
    overrides[parsedChainId.data] = url;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function parseRecordArray<T>(schema: z.ZodType<T>, input: unknown): T[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function parseStoredStateInput(input: unknown): ParsedStoredState | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) return undefined;

  const raw = input as Record<string, unknown>;
  const parsed: ParsedStoredState = {
    vaults: parseVaultMap(raw.vaults),
    wallets: parseRecordArray(walletRecordSchema, raw.wallets),
    transactions: parseRecordArray(transactionRecordSchema, raw.transactions),
    connectedSites: parseRecordArray(dappConnectionSchema, raw.connectedSites),
    pendingConnections: parseRecordArray(dappConnectionRequestSchema, raw.pendingConnections),
    rpcOverrides: parseRpcOverrides(raw.rpcOverrides)
  };

  if (typeof raw.activeWalletId === "string") {
    parsed.activeWalletId = raw.activeWalletId;
  }

  const legacyVault = encryptedVaultSchema.safeParse(raw.vault);
  if (legacyVault.success) {
    parsed.vault = legacyVault.data;
  }

  return parsed;
}
