import { z } from "zod";
import type { EncryptedVault } from "../crypto/vault";

export const MIN_VAULT_ITERATIONS = 600_000;
export const MAX_VAULT_ITERATIONS = 1_000_000;

export const encryptedVaultSchema = z.object({
  version: z.literal(1),
  kdf: z.literal("PBKDF2-SHA256"),
  cipher: z.literal("AES-256-GCM"),
  iterations: z.number().int().min(MIN_VAULT_ITERATIONS).max(MAX_VAULT_ITERATIONS),
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  createdAt: z.string().min(1)
});

export function parseEncryptedVault(input: unknown): EncryptedVault {
  const result = encryptedVaultSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid encrypted vault");
  return result.data;
}

export function parseVaultMap(input: unknown): Record<string, EncryptedVault> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const vaults: Record<string, EncryptedVault> = {};
  for (const [walletId, value] of Object.entries(input)) {
    const parsed = encryptedVaultSchema.safeParse(value);
    if (parsed.success) vaults[walletId] = parsed.data;
  }
  return vaults;
}
