import { addressWord, concat, hexBytes, keccak, keccakHex, uint256, utf8Bytes, type Hex } from "./hash";

export type SafeTx = {
  to: string;
  value: bigint;
  data: string;
  operation: number;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: string;
  refundReceiver: string;
  nonce: bigint;
};

const SAFE_TX_TYPEHASH = keccak(utf8Bytes(
  "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,"
  + "uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
));
const SAFE_DOMAIN_TYPEHASH_WITH_CHAIN_ID = keccak(utf8Bytes("EIP712Domain(uint256 chainId,address verifyingContract)"));
const SAFE_DOMAIN_TYPEHASH_NO_CHAIN_ID = keccak(utf8Bytes("EIP712Domain(address verifyingContract)"));

export function safeTxHash(tx: SafeTx, safe: string, chainId: bigint, version: string): Hex {
  const structHash = keccak(concat(
    SAFE_TX_TYPEHASH,
    addressWord(tx.to),
    uint256(tx.value),
    keccak(hexBytes(tx.data, "Safe transaction data")),
    uint256(BigInt(tx.operation)),
    uint256(tx.safeTxGas),
    uint256(tx.baseGas),
    uint256(tx.gasPrice),
    addressWord(tx.gasToken),
    addressWord(tx.refundReceiver),
    uint256(tx.nonce)
  ));
  return keccakHex(concat(
    new Uint8Array([0x19, 0x01]),
    safeDomainSeparator(safe, chainId, version),
    structHash
  ));
}

export function safeDomainSeparator(safe: string, chainId: bigint, version: string): Uint8Array {
  if (safeDomainIncludesChainId(version)) {
    return keccak(concat(SAFE_DOMAIN_TYPEHASH_WITH_CHAIN_ID, uint256(chainId), addressWord(safe)));
  }
  return keccak(concat(SAFE_DOMAIN_TYPEHASH_NO_CHAIN_ID, addressWord(safe)));
}

export function safeDomainIncludesChainId(version: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error("Invalid Safe version");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 3);
}
