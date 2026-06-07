import { isAddress as isSolanaAddress } from "@solana/addresses";
import { bech32m } from "bech32";
import { address as btcAddress, networks } from "bitcoinjs-lib";
import { isAddress as isEvmAddress } from "ethers";
import type { ChainId } from "./types";

const EVM_CHAINS = new Set<ChainId>(["ethereum", "polygon", "arbitrum", "plasma"]);
const SPARK_HRP = "spark";

function validateEvmAddress(address: string): boolean {
  return isEvmAddress(address);
}

function validateBitcoinAddress(address: string): boolean {
  try {
    btcAddress.toOutputScript(address, networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

function validateSolanaAddress(address: string): boolean {
  return isSolanaAddress(address);
}

function validateSparkAddress(address: string): boolean {
  if (!address.startsWith(`${SPARK_HRP}1`)) return false;
  try {
    const decoded = bech32m.decode(address);
    return decoded.prefix === SPARK_HRP && decoded.words.length > 0;
  } catch {
    return false;
  }
}

export function validateAddressChecksum(chain: ChainId, address: string): boolean {
  if (EVM_CHAINS.has(chain)) return validateEvmAddress(address);
  if (chain === "bitcoin") return validateBitcoinAddress(address);
  if (chain === "solana") return validateSolanaAddress(address);
  if (chain === "spark") return validateSparkAddress(address);
  return false;
}
