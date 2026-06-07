import { CHAIN_BY_ID } from "../chains";
import { formatDappTransactionValue, type ParsedDappEvmTransaction } from "../dapp-transaction";
import type { ChainId, DappSignatureRequest, DappTransactionRequest } from "../types";
import { readStore, updateStore, type StoredState } from "../storage/store";
import { assertPendingRequestStillConnected, type ConnectedDappSession } from "./connected-sites";
import {
  getPendingDappTransaction,
  initPendingDappTransactions,
  listPendingDappTransactions,
  parsedTransactionForApproval,
  rejectPendingDappTransaction,
  rejectPendingDappTransactionsForWallet,
  resolvePendingDappTransaction,
  type StoredPendingDappTransaction
} from "./pending-dapp-transactions";
import {
  getPendingSignature,
  initPendingSignatures,
  listPendingSignatures,
  rejectPendingSignature,
  rejectPendingSignaturesForWallet,
  resolvePendingSignature,
  type StoredPendingSignature
} from "./pending-signatures";
import { signDappSignatureForApproval, submitDappTransactionForApproval } from "./wallet-execution";

export type PendingDappApprovalRequests = {
  pendingSignatures: DappSignatureRequest[];
  pendingTransactions: DappTransactionRequest[];
};

type PendingDappApprovalDecisionRequest = {
  origin: string;
  walletId: string;
  accountIndex: number;
  chain?: ChainId;
};

type ApprovalDecisionContext<TRequest extends PendingDappApprovalDecisionRequest> = {
  request: TRequest;
  connected: ConnectedDappSession;
  store: StoredState;
};

type ApprovalStoreEffect<TRequest extends PendingDappApprovalDecisionRequest, TResult> = {
  request: TRequest;
  connected: ConnectedDappSession;
  result: TResult;
  now: string;
};

type DappApprovalDecision<TRequest extends PendingDappApprovalDecisionRequest, TResult, TListRequest> = {
  label: "Signature" | "Transaction";
  listRequests: (walletId?: string) => TListRequest[];
  getRequest: (id: string) => TRequest | undefined;
  execute: (context: ApprovalDecisionContext<TRequest>) => Promise<TResult>;
  settle: (id: string, result: TResult) => Promise<TRequest>;
  reject: (id: string) => Promise<TRequest>;
  rejectForWallet: (walletId?: string) => Promise<void>;
  reduceStore?: (state: StoredState, effect: ApprovalStoreEffect<TRequest, TResult>) => StoredState;
};

type TransactionApprovalResult = {
  parsed: ParsedDappEvmTransaction;
  txHash: string;
};

const signatureApprovalDecision: DappApprovalDecision<StoredPendingSignature, string, DappSignatureRequest> = {
  label: "Signature",
  listRequests: listPendingSignatures,
  getRequest: getPendingSignature,
  execute: ({ request, connected, store }) => signDappSignatureForApproval(connected.walletId, connected.chain, request, store),
  settle: resolvePendingSignature,
  reject: rejectPendingSignature,
  rejectForWallet: rejectPendingSignaturesForWallet
};

const transactionApprovalDecision: DappApprovalDecision<StoredPendingDappTransaction, TransactionApprovalResult, DappTransactionRequest> = {
  label: "Transaction",
  listRequests: listPendingDappTransactions,
  getRequest: getPendingDappTransaction,
  execute: async ({ request, connected, store }) => {
    const parsed = parsedTransactionForApproval(request);
    const txHash = await submitDappTransactionForApproval(connected.walletId, request.chain, request.accountIndex, parsed, store);
    return { parsed, txHash };
  },
  settle: (requestId, result) => resolvePendingDappTransaction(requestId, result.txHash),
  reject: rejectPendingDappTransaction,
  rejectForWallet: rejectPendingDappTransactionsForWallet,
  reduceStore: (state, { request, connected, result, now }) => ({
    ...state,
    transactions: [dappTransactionRecord(request, connected, result.parsed, result.txHash, now), ...state.transactions]
  })
};

export async function initDappApprovalWorkflow(): Promise<void> {
  await Promise.all([initPendingSignatures(), initPendingDappTransactions()]);
}

export function listPendingDappApprovalRequests(walletId?: string): PendingDappApprovalRequests {
  return {
    pendingSignatures: signatureApprovalDecision.listRequests(walletId),
    pendingTransactions: transactionApprovalDecision.listRequests(walletId)
  };
}

function touchApprovedDappSite(state: StoredState, request: PendingDappApprovalDecisionRequest, now: string): StoredState {
  return {
    ...state,
    connectedSites: state.connectedSites.map((site) =>
      site.origin === request.origin && site.walletId === request.walletId ? { ...site, lastUsedAt: now } : site
    )
  };
}

async function approveDappDecision<TRequest extends PendingDappApprovalDecisionRequest, TResult>(
  id: string,
  decision: DappApprovalDecision<TRequest, TResult, unknown>
): Promise<void> {
  const pending = decision.getRequest(id);
  if (!pending) throw new Error(`${decision.label} request was not found or already resolved`);
  const store = await readStore();
  const connected = await assertPendingRequestStillConnected(pending, decision.label);
  const result = await decision.execute({ request: pending, connected, store });
  const request = await decision.settle(id, result);
  const now = new Date().toISOString();
  await updateStore((state) => {
    const touched = touchApprovedDappSite(state, request, now);
    return decision.reduceStore?.(touched, { request, connected, result, now }) ?? touched;
  });
}

export async function approveDappSignature(id: string): Promise<void> {
  await approveDappDecision(id, signatureApprovalDecision);
}

export async function rejectDappSignature(id: string): Promise<void> {
  await signatureApprovalDecision.reject(id);
}

export async function approveDappTransaction(id: string): Promise<void> {
  await approveDappDecision(id, transactionApprovalDecision);
}

function dappTransactionRecord(
  request: PendingDappApprovalDecisionRequest & { chain: ChainId; to: string },
  connected: ConnectedDappSession,
  parsed: ParsedDappEvmTransaction,
  txHash: string,
  now: string
) {
  return {
    id: crypto.randomUUID(),
    walletId: request.walletId,
    chain: request.chain,
    asset: CHAIN_BY_ID[request.chain].nativeAsset,
    from: connected.account.address,
    to: request.to,
    amount: formatDappTransactionValue(parsed.value),
    status: "pending" as const,
    txHash,
    createdAt: now,
    updatedAt: now
  };
}

export async function rejectDappTransactionApproval(id: string): Promise<void> {
  await transactionApprovalDecision.reject(id);
}

export async function rejectDappApprovalsForWallet(walletId?: string): Promise<void> {
  await signatureApprovalDecision.rejectForWallet(walletId);
  await transactionApprovalDecision.rejectForWallet(walletId);
}
