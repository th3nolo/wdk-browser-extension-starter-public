import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export type Hex = `0x${string}`;

const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function keccak(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function keccakHex(data: Uint8Array): Hex {
  return toHex(keccak(data));
}

export function toHex(data: Uint8Array): Hex {
  return `0x${bytesToHex(data)}` as Hex;
}

export function utf8Bytes(value: string): Uint8Array {
  return utf8ToBytes(value);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  return concatBytes(...parts);
}

export function hexBytes(hex: string, field = "hex data"): Uint8Array {
  if (!HEX_RE.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`Invalid ${field}`);
  }
  return hexToBytes(hex.slice(2));
}

export function word(data: Uint8Array): Uint8Array {
  if (data.length > 32) throw new Error("ABI word overflow");
  const output = new Uint8Array(32);
  output.set(data, 32 - data.length);
  return output;
}

export function rightPaddedWord(data: Uint8Array): Uint8Array {
  if (data.length > 32) throw new Error("ABI word overflow");
  const output = new Uint8Array(32);
  output.set(data, 0);
  return output;
}

export function uint256(value: bigint): Uint8Array {
  if (value < 0n || value >= (1n << 256n)) throw new Error("uint256 out of range");
  return word(unsignedIntegerBytes(value));
}

export function int256(value: bigint): Uint8Array {
  const min = -(1n << 255n);
  const max = (1n << 255n) - 1n;
  if (value < min || value > max) throw new Error("int256 out of range");
  return uint256(value < 0n ? (1n << 256n) + value : value);
}

export function boolWord(value: boolean): Uint8Array {
  return uint256(value ? 1n : 0n);
}

export function addressWord(address: string): Uint8Array {
  const bytes = hexBytes(address, "address");
  if (bytes.length !== 20) throw new Error("Invalid address length");
  return word(bytes);
}

export function fixedBytesWord(hex: string, byteLength: number): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > 32) {
    throw new Error("Invalid fixed bytes length");
  }
  const bytes = hexBytes(hex, `bytes${byteLength}`);
  if (bytes.length !== byteLength) throw new Error(`Invalid bytes${byteLength} length`);
  return rightPaddedWord(bytes);
}

export function unsignedIntegerBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("Unsigned integer cannot be negative");
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return hexToBytes(hex);
}
