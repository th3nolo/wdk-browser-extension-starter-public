import type {
  ChainId,
  DappSignatureRequest,
  DappTransactionRequest,
  SignatureRequestKind
} from "../types";

export const DAPP_APPROVALS_STORAGE_KEY = "wdk-wallet-dapp-approvals";
export const DAPP_APPROVAL_OUTCOMES_STORAGE_KEY = "wdk-wallet-dapp-approval-outcomes";

export const DAPP_APPROVAL_TTL_MS = 55_000;

export type DappApprovalKind = "signature" | "transaction";

export type StoredDappApproval = {
  id: string;
  approvalKind: DappApprovalKind;
  walletId: string;
  dedupeKey: string;
  expiresAt: number;
};

export type StoredPendingSignature = Omit<DappSignatureRequest, "kind"> & StoredDappApproval & {
  approvalKind: "signature";
  signatureKind: SignatureRequestKind;
};

export type StoredPendingDappTransaction = DappTransactionRequest & StoredDappApproval & {
  approvalKind: "transaction";
  chain: ChainId;
  from?: string;
};

export type StoredPendingApproval = StoredPendingSignature | StoredPendingDappTransaction;

export type RejectedDappApprovalOutcome = { status: "rejected"; message: string };
export type SignatureDappApprovalOutcome = { status: "resolved"; approvalKind: "signature"; signature: string };
export type TransactionDappApprovalOutcome = { status: "resolved"; approvalKind: "transaction"; txHash: string };
export type DappApprovalOutcome =
  | RejectedDappApprovalOutcome
  | SignatureDappApprovalOutcome
  | TransactionDappApprovalOutcome;
