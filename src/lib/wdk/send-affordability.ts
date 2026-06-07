import { assetDecimals, CHAIN_BY_ID } from "../chains";
import { decimalToBaseUnits } from "../decimal-amount";
import type { ChainId, SendRequest } from "../types";
import { EVM_TRANSFER_MAX_FEE_WEI } from "./constants";
import type { WdkAccount } from "./types";

/** Conservative native fee reserves by chain family (base units). */
const NATIVE_FEE_RESERVE: Record<ChainId, bigint> = {
  bitcoin: 10_000n,
  spark: 10_000n,
  solana: 1_000_000n,
  ethereum: EVM_TRANSFER_MAX_FEE_WEI,
  polygon: EVM_TRANSFER_MAX_FEE_WEI,
  arbitrum: EVM_TRANSFER_MAX_FEE_WEI,
  plasma: EVM_TRANSFER_MAX_FEE_WEI
};

export async function assertSendAffordable(account: WdkAccount, request: SendRequest): Promise<void> {
  const chain = CHAIN_BY_ID[request.chain];
  const sendAmount = decimalToBaseUnits(request.amount, assetDecimals(request.chain, request.asset));
  const feeReserve = NATIVE_FEE_RESERVE[request.chain];

  if (request.asset === chain.nativeAsset) {
    const balance = await account.getBalance();
    if (balance < sendAmount + feeReserve) {
      throw new Error(`Insufficient ${chain.nativeAsset} for amount plus fees`);
    }
    return;
  }

  const token =
    request.asset === "USDt" ? chain.usdtContract :
    request.asset === "XAUt" ? chain.xautContract :
    undefined;
  if (!token) throw new Error(`${request.asset} transfers are not configured for ${chain.label}`);

  const tokenBalance = await account.getTokenBalance(token);
  if (tokenBalance < sendAmount) {
    throw new Error(`Insufficient ${request.asset} balance`);
  }

  if (chain.family === "evm") {
    const nativeBalance = await account.getBalance();
    if (nativeBalance < feeReserve) {
      throw new Error(`Insufficient ${chain.nativeAsset} for transaction fees`);
    }
  }
}
