import { CHAIN_BY_ID, isAssetSupportedOnChain } from "./chains";
import type { AccountRecord, AssetId, ChainId, SendRequest, WalletRecord } from "./types";
import { validateAddress, validateAmount } from "./validation";

export type SendRequestPreviewInput = {
  walletId: string | undefined;
  account: AccountRecord | undefined;
  chain: ChainId;
  asset: AssetId;
  accountIndex: number;
  to: string;
  amount: string;
};

export type SendRequestPreview = {
  request: SendRequest | undefined;
  assetSupported: boolean;
  canReview: boolean;
  fieldError: string | undefined;
};

export function previewSendRequest(input: SendRequestPreviewInput): SendRequestPreview {
  const request = input.walletId ? {
    walletId: input.walletId,
    chain: input.chain,
    asset: input.asset,
    accountIndex: input.accountIndex,
    to: input.to,
    amount: input.amount
  } : undefined;
  const assetSupported = isSendAssetSupported(input.chain, input.asset);
  const fieldError = request ? getSendRequestFieldError(request) : undefined;

  return {
    request,
    assetSupported,
    canReview: Boolean(request && input.account && !fieldError),
    fieldError
  };
}

export function assertSendRequestAllowedForWallet(request: SendRequest, wallet: WalletRecord | undefined): void {
  if (!wallet) throw new Error("Selected wallet was not found");
  if (!isWalletSendAccountAvailable(wallet, request.accountIndex)) {
    throw new Error("Selected account is not available for this wallet");
  }
  assertSendRequestFields(request);
}

export function assertSendRequestFields(request: SendRequest): void {
  const error = getSendRequestFieldError(request);
  if (error) throw new Error(error);
}

export function assertExecutableSendRequest(request: SendRequest): void {
  const error = getExecutableSendRequestError(request);
  if (error) throw new Error(error);
}

export function getSendRequestFieldError(request: SendRequest): string | undefined {
  return getSendRequestCapabilityError(request)
    ?? getSendRequestRecipientError(request)
    ?? getSendRequestAmountError(request);
}

function getExecutableSendRequestError(request: SendRequest): string | undefined {
  return getSendRequestRecipientError(request)
    ?? getSendRequestAmountError(request)
    ?? getSendRequestCapabilityError(request);
}

function getSendRequestCapabilityError(request: SendRequest): string | undefined {
  const chain = CHAIN_BY_ID[request.chain];
  if (!chain) return "Unsupported network";
  if (!isSendAssetSupported(request.chain, request.asset)) {
    return `${request.asset} is not configured for ${chain.label}`;
  }
  return undefined;
}

function getSendRequestRecipientError(request: SendRequest): string | undefined {
  if (validateAddress(request.chain, request.to)) return undefined;
  return "Invalid recipient address for selected network";
}

function getSendRequestAmountError(request: SendRequest): string | undefined {
  if (validateAmount(request.amount)) return undefined;
  return "Invalid amount";
}

function isSendAssetSupported(chain: ChainId, asset: AssetId): boolean {
  return isAssetSupportedOnChain(chain, asset);
}

function isWalletSendAccountAvailable(wallet: WalletRecord, accountIndex: number): boolean {
  return Number.isInteger(accountIndex) && accountIndex >= 0 && accountIndex < wallet.accountCount;
}
