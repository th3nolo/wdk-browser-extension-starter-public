import { describe, expect, it } from "vitest";
import { validateAddressChecksum } from "./address-validation";
import { validateAddress, validateAmount, validatePassword, validateSeedPhrase, getPasswordValidationMessage } from "./validation";

describe("address checksum validation", () => {
  it("accepts valid EVM addresses including all-lowercase", () => {
    expect(validateAddressChecksum("ethereum", "0x0000000000000000000000000000000000000000")).toBe(true);
    expect(validateAddressChecksum("polygon", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(true);
  });

  it("rejects EVM addresses with invalid EIP-55 checksum", () => {
    expect(validateAddressChecksum("ethereum", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee")).toBe(false);
    expect(validateAddressChecksum("arbitrum", "0x00000000000000000000000000000000000000000")).toBe(false);
  });

  it("accepts valid Bitcoin mainnet addresses", () => {
    expect(validateAddressChecksum("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(true);
    expect(validateAddressChecksum("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(true);
  });

  it("rejects Bitcoin addresses with invalid base58check or bech32 checksum", () => {
    expect(validateAddressChecksum("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t0")).toBe(false);
    expect(validateAddressChecksum("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3")).toBe(false);
  });

  it("accepts valid Solana addresses", () => {
    expect(validateAddressChecksum("solana", "11111111111111111111111111111111")).toBe(true);
  });

  it("rejects malformed Solana addresses", () => {
    expect(validateAddressChecksum("solana", "not-a-solana-address")).toBe(false);
    expect(validateAddressChecksum("solana", "0")).toBe(false);
  });

  it("accepts valid Spark bech32m addresses", () => {
    expect(validateAddressChecksum("spark", "spark1pgss85kzu8r3kerhnvxwzzasls3wz3tycfdc4f6d4wgp5trmsel3x8jgad52lz")).toBe(true);
  });

  it("rejects Spark addresses with invalid checksum or prefix", () => {
    expect(validateAddressChecksum("spark", "spark1pgss85kzu8r3kerhnvxwzzasls3wz3tycfdc4f6d4wgp5trmsel3x8jgad52ly")).toBe(false);
    expect(validateAddressChecksum("spark", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(false);
  });
});

describe("wallet validation", () => {
  it("validates BIP-39 phrases", () => {
    expect(validateSeedPhrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")).toBe(true);
    expect(validateSeedPhrase("not a real seed phrase")).toBe(false);
  });

  it("validates network addresses", () => {
    expect(validateAddress("ethereum", "0x0000000000000000000000000000000000000000")).toBe(true);
    expect(validateAddress("polygon", "0xxyz")).toBe(false);
    expect(validateAddress("solana", "11111111111111111111111111111111")).toBe(true);
    expect(validateAddress("spark", "spark1pgss85kzu8r3kerhnvxwzzasls3wz3tycfdc4f6d4wgp5trmsel3x8jgad52lz")).toBe(true);
    expect(validateAddress("ethereum", "  0x0000000000000000000000000000000000000000  ")).toBe(true);
    expect(validateAddress("ethereum", "")).toBe(false);
  });

  it("validates positive decimal amounts", () => {
    expect(validateAmount("1")).toBe(true);
    expect(validateAmount("0.0001")).toBe(true);
    expect(validateAmount("1000000000000000000.5")).toBe(true);
    expect(validateAmount("9007199254740993")).toBe(true);
    expect(validateAmount("0")).toBe(false);
    expect(validateAmount("0.0")).toBe(false);
    expect(validateAmount("-1")).toBe(false);
    expect(validateAmount("1e18")).toBe(false);
  });

  it("validates wallet passwords", () => {
    expect(validatePassword("12345678901")).toBe(false);
    expect(validatePassword("123456789012")).toBe(false);
    expect(validatePassword("correct horse battery staple")).toBe(true);
  });

  it("returns password guidance for weak choices", () => {
    expect(getPasswordValidationMessage("")).toBeUndefined();
    expect(getPasswordValidationMessage("short")).toMatch(/12 characters/);
    expect(getPasswordValidationMessage("123456789012")).toBeTruthy();
  });
});
