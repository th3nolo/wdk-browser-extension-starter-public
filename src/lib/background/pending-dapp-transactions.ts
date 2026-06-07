import type { ChainId, DappTransactionRequest } from "../types";
import { nativeTransferReview, type ParsedDappEvmTransaction } from "../dapp-transaction";
import { openApprovalWindow } from "./approval-window";
import {
  DAPP_APPROVAL_TTL_MS,
  getPendingDappApproval,
  initPendingDappApprovals,
  listPendingDappApprovals,
  queueAndWaitPendingDappApproval,
  rejectPendingDappApprovalsForWallet,
  removePendingDappApproval,
  resetPendingDappApprovalsForTests,
  settlePendingDappApproval,
  type DappApprovalOutcome,
  type StoredPendingApproval,
  type StoredPendingDappTransaction,
  transactionDedupeKey
} from "./pending-dapp-approvals";

export const DAPP_TRANSACTION_TTL_MS = DAPP_APPROVAL_TTL_MS;

export type { StoredPendingDappTransaction };

function transactionLookupKeys(
  origin: string,
  walletId: string,
  accountIndex: number,
  dedupeKey: string,
  existing?: StoredPendingApproval
): string[] {
  return [
    transactionDedupeKey(origin, walletId, accountIndex, dedupeKey),
    existing?.id
  ].filter((key): key is string => Boolean(key));
}

function asTransactionRequest(approval: StoredPendingDappTransaction): DappTransactionRequest {
  return {
    id: approval.id,
    origin: approval.origin,
    walletId: approval.walletId,
    accountIndex: approval.accountIndex,
    chain: approval.chain,
    to: approval.to,
    value: approval.value,
    data: approval.data,
    gasLimit: approval.gasLimit,
    review: approval.review,
    verification: approval.verification,
    requestedAt: approval.requestedAt
  };
}

function unwrapTransactionOutcome(outcome: DappApprovalOutcome): string {
  if (outcome.status === "rejected") throw new Error(outcome.message);
  if (outcome.approvalKind !== "transaction" || typeof outcome.txHash !== "string") {
    throw new Error("Stored approval outcome type mismatch");
  }
  return outcome.txHash;
}

export async function initPendingDappTransactions(): Promise<void> {
  await initPendingDappApprovals();
}

export function listPendingDappTransactions(walletId?: string): DappTransactionRequest[] {
  return listPendingDappApprovals("transaction", walletId).map(asTransactionRequest);
}

export function getPendingDappTransaction(id: string): StoredPendingDappTransaction | undefined {
  return getPendingDappApproval("transaction", id);
}

export async function queuePendingDappTransaction(
  origin: string,
  walletId: string,
  accountIndex: number,
  chain: ChainId,
  dedupeKey: string,
  parsed: ParsedDappEvmTransaction,
  verification?: DappTransactionRequest["verification"]
): Promise<string> {
  await initPendingDappTransactions();
  void openApprovalWindow();
  const approvalDedupeKey = transactionDedupeKey(origin, walletId, accountIndex, dedupeKey);
  const approval: StoredPendingDappTransaction = {
    id: crypto.randomUUID(),
    approvalKind: "transaction",
    origin,
    walletId,
    accountIndex,
    chain,
    dedupeKey: approvalDedupeKey,
    to: parsed.to,
    value: parsed.value.toString(),
    data: parsed.data,
    gasLimit: parsed.gasLimit?.toString(),
    review: parsed.review ?? nativeTransferReview(parsed.to, parsed.value),
    verification,
    from: parsed.from,
    requestedAt: new Date().toISOString(),
    expiresAt: Date.now() + DAPP_TRANSACTION_TTL_MS
  };
  return unwrapTransactionOutcome(await queueAndWaitPendingDappApproval(
    approval,
    (existing) => transactionLookupKeys(origin, walletId, accountIndex, dedupeKey, existing)
  ));
}

export function parsedTransactionForApproval(approval: StoredPendingDappTransaction): ParsedDappEvmTransaction {
  return {
    from: approval.from,
    to: approval.to,
    value: BigInt(approval.value),
    data: approval.data,
    gasLimit: approval.gasLimit ? BigInt(approval.gasLimit) : undefined,
    review: approval.review
  };
}

export async function removePendingDappTransaction(id: string): Promise<StoredPendingDappTransaction | undefined> {
  return removePendingDappApproval(id, "transaction");
}

export async function resolvePendingDappTransaction(id: string, txHash: string): Promise<StoredPendingDappTransaction> {
  return settlePendingDappApproval(
    id,
    "transaction",
    { status: "resolved", approvalKind: "transaction", txHash },
    "Transaction request was not found or already resolved"
  );
}

export async function rejectPendingDappTransaction(id: string, message = "User rejected transaction request"): Promise<StoredPendingDappTransaction> {
  return settlePendingDappApproval(
    id,
    "transaction",
    { status: "rejected", message },
    "Transaction request was not found or already resolved"
  );
}

export async function rejectPendingDappTransactionsForWallet(walletId?: string): Promise<void> {
  await rejectPendingDappApprovalsForWallet(walletId, "transaction", "Transaction request cancelled");
}

export function resetPendingDappTransactionsForTests(): void {
  resetPendingDappApprovalsForTests();
}
