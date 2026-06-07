import type { Eip712TypedDataPayload } from "../types";
import {
  addressWord,
  boolWord,
  concat,
  fixedBytesWord,
  hexBytes,
  int256,
  keccak,
  keccakHex,
  toHex,
  uint256,
  utf8Bytes,
  type Hex
} from "./hash";

export type Eip712DigestEvidence = {
  finalDigest: Hex;
  domainSeparator: Hex;
  messageHash: Hex;
};

type Eip712Types = Record<string, Array<{ name: string; type: string }>>;

const DOMAIN_FIELD_ORDER = ["name", "version", "chainId", "verifyingContract", "salt", "extensions"] as const;

export function eip712DigestEvidence(payload: Eip712TypedDataPayload): Eip712DigestEvidence {
  const domainSeparator = hashDomain(payload.domain);
  const messageHash = hashStructHex(payload.primaryType, messageTypes(payload.types), payload.message);
  return {
    finalDigest: keccakHex(concat(new Uint8Array([0x19, 0x01]), hexBytes(domainSeparator), hexBytes(messageHash))),
    domainSeparator,
    messageHash
  };
}

export function hashDomain(domain: Record<string, unknown>): Hex {
  const fields = DOMAIN_FIELD_ORDER.flatMap((name) => {
    if (domain[name] === undefined) return [];
    return [{ name, type: domainFieldType(name) }];
  });
  return hashStructHex("EIP712Domain", { EIP712Domain: fields }, domain);
}

export function hashStructHex(primaryType: string, types: Eip712Types, value: Record<string, unknown>): Hex {
  return toHex(hashStruct(primaryType, types, value));
}

function hashStruct(primaryType: string, types: Eip712Types, value: Record<string, unknown>): Uint8Array {
  const fields = types[primaryType];
  if (!fields) throw new Error(`Missing EIP-712 type ${primaryType}`);
  return keccak(encodeData(primaryType, types, value));
}

function encodeData(primaryType: string, types: Eip712Types, value: Record<string, unknown>): Uint8Array {
  const fields = types[primaryType];
  if (!fields) throw new Error(`Missing EIP-712 type ${primaryType}`);
  return concat(
    keccak(utf8Bytes(encodeType(primaryType, types))),
    ...fields.map((field) => encodeValue(field.type, value[field.name], types))
  );
}

function encodeType(primaryType: string, types: Eip712Types): string {
  const fields = types[primaryType];
  if (!fields) throw new Error(`Missing EIP-712 type ${primaryType}`);
  const dependencies = [...findDependencies(primaryType, types)]
    .filter((dependency) => dependency !== primaryType)
    .sort();
  return [primaryType, ...dependencies]
    .map((typeName) => encodeTypeFragment(typeName, types[typeName]))
    .join("");
}

function encodeTypeFragment(typeName: string, fields: Array<{ name: string; type: string }> | undefined): string {
  if (!fields) throw new Error(`Missing EIP-712 type ${typeName}`);
  return `${typeName}(${fields.map((field) => `${field.type} ${field.name}`).join(",")})`;
}

function findDependencies(primaryType: string, types: Eip712Types, found = new Set<string>()): Set<string> {
  const base = baseType(primaryType);
  if (found.has(base) || !types[base]) return found;
  found.add(base);
  for (const field of types[base]) {
    findDependencies(field.type, types, found);
  }
  return found;
}

function encodeValue(type: string, value: unknown, types: Eip712Types): Uint8Array {
  const array = parseArrayType(type);
  if (array) {
    if (!Array.isArray(value)) throw new Error(`Invalid EIP-712 array value for ${type}`);
    if (array.length !== undefined && value.length !== array.length) {
      throw new Error(`Invalid EIP-712 fixed array length for ${type}`);
    }
    return keccak(concat(...value.map((entry) => encodeValue(array.itemType, entry, types))));
  }

  if (types[type]) {
    if (!isRecord(value)) throw new Error(`Invalid EIP-712 struct value for ${type}`);
    return hashStruct(type, types, value);
  }

  if (type === "string") {
    if (typeof value !== "string") throw new Error("Invalid EIP-712 string value");
    return keccak(utf8Bytes(value));
  }

  if (type === "bytes") {
    if (typeof value !== "string") throw new Error("Invalid EIP-712 bytes value");
    return keccak(hexBytes(value, "bytes"));
  }

  const fixedBytes = /^bytes([1-9]|[12]\d|3[0-2])$/.exec(type);
  if (fixedBytes) {
    if (typeof value !== "string") throw new Error(`Invalid EIP-712 ${type} value`);
    return fixedBytesWord(value, Number(fixedBytes[1]));
  }

  if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("Invalid EIP-712 bool value");
    return boolWord(value);
  }

  if (type === "address") {
    if (typeof value !== "string") throw new Error("Invalid EIP-712 address value");
    return addressWord(value);
  }

  const uint = /^uint(?:(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256))?$/.exec(type);
  if (uint) {
    const bits = uint[1] ? Number(uint[1]) : 256;
    const parsed = parseInteger(value, type);
    if (parsed < 0n || parsed >= (1n << BigInt(bits))) throw new Error(`EIP-712 ${type} value out of range`);
    return uint256(parsed);
  }

  const int = /^int(?:(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256))?$/.exec(type);
  if (int) {
    const bits = int[1] ? Number(int[1]) : 256;
    const parsed = parseInteger(value, type);
    const min = -(1n << BigInt(bits - 1));
    const max = (1n << BigInt(bits - 1)) - 1n;
    if (parsed < min || parsed > max) throw new Error(`EIP-712 ${type} value out of range`);
    return int256(parsed);
  }

  throw new Error(`Unsupported EIP-712 field type ${type}`);
}

function messageTypes(types: Eip712Types): Eip712Types {
  const message = { ...types };
  delete message.EIP712Domain;
  return message;
}

function domainFieldType(field: typeof DOMAIN_FIELD_ORDER[number]): string {
  switch (field) {
    case "name":
    case "version":
      return "string";
    case "chainId":
      return "uint256";
    case "verifyingContract":
      return "address";
    case "salt":
      return "bytes32";
    case "extensions":
      return "uint256[]";
  }
}

function baseType(type: string): string {
  let current = type;
  while (true) {
    const array = parseArrayType(current);
    if (!array) return current;
    current = array.itemType;
  }
}

function parseArrayType(type: string): { itemType: string; length?: number } | undefined {
  const match = /^(.*)\[(\d*)\]$/.exec(type);
  if (!match) return undefined;
  return {
    itemType: match[1],
    length: match[2] === "" ? undefined : Number(match[2])
  };
}

function parseInteger(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`Invalid EIP-712 ${field} number`);
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?0x[0-9a-fA-F]+$/.test(trimmed)) {
      if (trimmed.startsWith("-")) return -BigInt(`0x${trimmed.slice(3)}`);
      return BigInt(trimmed);
    }
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  throw new Error(`Invalid EIP-712 ${field} value`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
