import { z } from "zod";

export const chainIdSchema = z.enum(["bitcoin", "spark", "ethereum", "polygon", "arbitrum", "plasma", "solana"]);
export const assetIdSchema = z.enum(["BTC", "SATS", "ETH", "POL", "XPL", "MATIC", "SOL", "USDt", "XAUt"]);
export const transactionStatusSchema = z.enum(["draft", "pending", "confirmed", "failed", "dropped"]);

export const walletRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string().min(1),
  accountCount: z.number().int().nonnegative()
});

export const transactionRecordSchema = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  chain: chainIdSchema,
  asset: assetIdSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.string().min(1),
  status: transactionStatusSchema,
  txHash: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const dappConnectionSchema = z.object({
  origin: z.string().min(1),
  walletId: z.string().min(1),
  accountIndex: z.number().int().nonnegative(),
  accountIndexes: z.array(z.number().int().nonnegative()).min(1).optional(),
  evmChainId: z.number().int().positive().optional(),
  connectedAt: z.string().min(1),
  lastUsedAt: z.string().min(1)
}).transform((connection) => ({
  ...connection,
  evmChainId: connection.evmChainId ?? 1
}));

export const dappConnectionRequestSchema = z.object({
  origin: z.string().min(1),
  walletId: z.string().min(1),
  requestedAt: z.string().min(1)
});

export const sendRequestSchema = z.object({
  walletId: z.string().min(1),
  chain: chainIdSchema,
  asset: assetIdSchema,
  accountIndex: z.number().int().nonnegative(),
  to: z.string().min(1),
  amount: z.string().min(1)
});
