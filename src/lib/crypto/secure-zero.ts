import { sodium_memzero } from "sodium-universal";

/** Zeroes a mutable byte buffer. JS strings cannot be wiped in place — use Uint8Array at secret boundaries. */
export function secureZeroBytes(bytes: Uint8Array): void {
  sodium_memzero(bytes);
}
