import { validateMnemonic } from "bip39";
import { validateAddressChecksum } from "./address-validation";
import { isPositiveDecimalAmount } from "./decimal-amount";
import { analyzePasswordStrength, MIN_PASSWORD_SCORE } from "./password-strength";
import type { ChainId } from "./types";

export const MIN_PASSWORD_LENGTH = 12;

export function validateSeedPhrase(seedPhrase: string): boolean {
  return validateMnemonic(seedPhrase.trim().replace(/\s+/g, " "));
}

export function normalizeSeedPhrase(seedPhrase: string): string {
  return seedPhrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export function validateAddress(chain: ChainId, address: string): boolean {
  if (!address.trim()) return false;
  return validateAddressChecksum(chain, address.trim());
}

export function validateAmount(amount: string): boolean {
  return isPositiveDecimalAmount(amount);
}

export function validatePassword(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  return analyzePasswordStrength(password).score >= MIN_PASSWORD_SCORE;
}

export function getPasswordValidationMessage(password: string): string | undefined {
  if (!password) return undefined;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const { score, feedback } = analyzePasswordStrength(password);
  if (score >= MIN_PASSWORD_SCORE) return undefined;
  return feedback.warning || feedback.suggestions[0] || "Choose a stronger password or passphrase.";
}
