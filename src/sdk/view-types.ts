/**
 * The UI-facing view surface. Everything the swappable UI shell needs to render
 * wallet state — domain types plus the display/validation helpers it legitimately
 * uses — is re-exported here from its `src/lib` home so the UI imports these only
 * from the SDK and never reaches into the core directly.
 */

// --- Domain types (src/lib/types) ---
export type {
  AccountRecord,
  AssetId,
  BalanceRecord,
  ChainId,
  DappConnection,
  DappConnectionRequest,
  DappFeeEstimate,
  DappSignatureRequest,
  DappTransactionRequest,
  DappTransactionReview,
  Eip712TypedDataPayload,
  Erc20TokenMetadata,
  PersonalSignMessageEncoding,
  PopupState,
  PopupSummaryState,
  SendRequest,
  SignatureRequestKind,
  SimulationResult,
  TransactionRecord,
  TransactionStatus,
  TypedDataSignatureRequestKind,
  WalletRecord,
  WalletSummary
} from "../lib/types";
export { exposedAccountIndexes, isTypedDataSignatureKind } from "../lib/types";

// --- Signature verification evidence (src/lib/verify/evidence) ---
export type {
  DappPersonalSignVerificationEvidence,
  DappSignatureVerificationEvidence,
  DappTransactionVerificationEvidence,
  DappTypedDataVerificationEvidence
} from "../lib/verify/evidence";

// --- Balance grouping (src/lib/balance-grouping) ---
export type { AssetChainBalance, GroupedAssetBalance } from "../lib/balance-grouping";
export { groupBalancesByAsset, isMultiChainAsset } from "../lib/balance-grouping";

// --- Decimal amount display (src/lib/decimal-amount) ---
export { formatBaseUnitsForDisplay } from "../lib/decimal-amount";

// --- Send request preview/validation (src/lib/send-request) ---
export type { SendRequestPreview, SendRequestPreviewInput } from "../lib/send-request";
export { previewSendRequest } from "../lib/send-request";

// --- RPC override validation (src/lib/rpc-endpoints) ---
export { isValidRpcOverrideUrl } from "../lib/rpc-endpoints";

// --- dApp transaction value formatting (src/lib/dapp-transaction) ---
export { formatDappTransactionValue } from "../lib/dapp-transaction";

// --- Signature message display helpers (src/lib/signature-message-display) ---
export {
  PERSONAL_SIGN_HEX_NOTICE,
  SIGNATURE_PHISHING_WARNING,
  formatMessageByteCount,
  formatTypedDataDomain,
  formatTypedDataMessagePreview,
  looksLikeEip712PersonalSign,
  personalSignEncodingLabel,
  signatureMessageScrollHint,
  typedDataEncodingLabel
} from "../lib/signature-message-display";

// --- Chain metadata (src/lib/chains) ---
export type { ChainDefinition } from "../lib/chains";
export { CHAINS, CHAIN_BY_ID, assetDecimals, supportedAssetsForChain } from "../lib/chains";

// --- Password strength + validation (src/lib/password-strength, src/lib/validation) ---
export { PASSWORD_STRENGTH_LABELS, analyzePasswordStrength } from "../lib/password-strength";
export {
  MIN_PASSWORD_LENGTH,
  getPasswordValidationMessage,
  validatePassword,
  validateSeedPhrase
} from "../lib/validation";

// --- Seed phrase generation (src/lib/crypto/vault) ---
export { createSeedPhrase } from "../lib/crypto/vault";

// --- WDK constants the UI displays (src/lib/wdk/constants) ---
export { EVM_TRANSFER_MAX_FEE_WEI } from "../lib/wdk/constants";
