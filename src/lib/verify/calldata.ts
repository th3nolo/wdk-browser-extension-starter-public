import { concat, hexBytes, keccakHex, uint256, type Hex } from "./hash";

export function calldataByteLength(calldataHex: string): number {
  return hexBytes(calldataHex, "calldata").length;
}

export function calldataDigest(calldataHex: string): Hex {
  const calldata = hexBytes(calldataHex, "calldata");
  return keccakHex(concat(uint256(BigInt(calldata.length)), calldata));
}
