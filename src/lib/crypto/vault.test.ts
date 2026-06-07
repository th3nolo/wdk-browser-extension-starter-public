import { describe, expect, it } from "vitest";
import { validateSeedPhrase } from "../validation";
import { createSeedPhrase, decryptSeedPhrase, encryptSeedPhrase } from "./vault";

const seedPhrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "correct horse battery staple";

describe("encrypted seed vault", () => {
  it("generates valid BIP-39 seed phrases", () => {
    expect(validateSeedPhrase(createSeedPhrase())).toBe(true);
  });

  it("encrypts and decrypts the normalized seed phrase without storing plaintext", async () => {
    const vault = await encryptSeedPhrase(`  ${seedPhrase.toUpperCase()}  `, password);

    expect(vault).toMatchObject({
      version: 1,
      kdf: "PBKDF2-SHA256",
      cipher: "AES-256-GCM",
      iterations: 600_000
    });
    expect(vault.salt).toBeTruthy();
    expect(vault.iv).toBeTruthy();
    expect(vault.ciphertext).toBeTruthy();
    expect(JSON.stringify(vault)).not.toContain(seedPhrase);

    await expect(decryptSeedPhrase(vault, password)).resolves.toBe(seedPhrase);
  });

  it("rejects wrong passwords and invalid vault inputs", async () => {
    const vault = await encryptSeedPhrase(seedPhrase, password);

    await expect(decryptSeedPhrase(vault, "wrong password value")).rejects.toThrow();
    await expect(decryptSeedPhrase({ ...vault, version: 2 } as unknown as typeof vault, password)).rejects.toThrow("Invalid encrypted vault");
    await expect(decryptSeedPhrase({ ...vault, iterations: 599_999 }, password)).rejects.toThrow("Invalid encrypted vault");
    await expect(decryptSeedPhrase({ ...vault, iterations: 1_000_001 }, password)).rejects.toThrow("Invalid encrypted vault");
    await expect(decryptSeedPhrase({ ...vault, kdf: "scrypt" } as unknown as typeof vault, password)).rejects.toThrow("Invalid encrypted vault");
    await expect(decryptSeedPhrase({ ...vault, iterations: 600_001 }, password)).rejects.toThrow();
    await expect(encryptSeedPhrase(seedPhrase, "too-short")).rejects.toThrow("Password must be at least 12 characters");
    await expect(encryptSeedPhrase("not a real seed phrase", password)).rejects.toThrow("Invalid BIP-39 seed phrase");
  });
});
