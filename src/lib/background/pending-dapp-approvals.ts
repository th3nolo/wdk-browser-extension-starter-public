import { createMutationChain } from "../storage/mutation-chain";
import type { DappSignatureRequest, PersonalSignMessageEncoding, SignatureRequestKind } from "../types";
import { parseStoredApproval, pruneExpired } from "./pending-dapp-approval-codec";
import {
  outcomeKeysForApproval,
  readStoredApprovals,
  readStoredOutcomes,
  removeOutcomeKeys,
  writeOutcome,
  writeStoredApprovals,
  writeStoredOutcomes
} from "./pending-dapp-approval-storage";
import {
  hasLiveApproval,
  registerOutcomeStorageListener,
  rejectLiveApproval,
  resetDappApprovalTransportForTests,
  resolveLiveApproval,
  waitForApprovalOutcome
} from "./pending-dapp-approval-transport";
import type {
  DappApprovalKind,
  DappApprovalOutcome,
  StoredDappApproval,
  StoredPendingApproval,
  StoredPendingDappTransaction,
  StoredPendingSignature
} from "./pending-dapp-approval-types";

export {
  DAPP_APPROVAL_OUTCOMES_STORAGE_KEY,
  DAPP_APPROVALS_STORAGE_KEY,
  DAPP_APPROVAL_TTL_MS
} from "./pending-dapp-approval-types";

export type {
  DappApprovalKind,
  DappApprovalOutcome,
  RejectedDappApprovalOutcome,
  SignatureDappApprovalOutcome,
  StoredDappApproval,
  StoredPendingApproval,
  StoredPendingDappTransaction,
  StoredPendingSignature,
  TransactionDappApprovalOutcome
} from "./pending-dapp-approval-types";

type QueuedApprovalResult =
  | { type: "outcome"; outcome: DappApprovalOutcome }
  | { type: "approval"; approval: StoredPendingApproval };

let storedApprovals: StoredPendingApproval[] = [];
let initPromise: Promise<void> | undefined;
const approvalMutationChain = createMutationChain();

export const UNCERTAIN_APPROVAL_MESSAGE = "Approval execution outcome is unknown. Check the wallet and network before submitting again; this request cannot be retried.";

function executionStarted(approval: StoredDappApproval): boolean {
  return approval.executionState === "executing" || approval.executionState === "uncertain";
}

export function signatureDedupeKey(origin: string, walletId: string, accountIndex: number, kind: SignatureRequestKind, message: string): string {
  return `signature:${origin}|${walletId}|${accountIndex}|${kind}|${message}`;
}

export function transactionDedupeKey(origin: string, walletId: string, accountIndex: number, dedupeKey: string): string {
  return `transaction:${origin}|${walletId}|${accountIndex}|${dedupeKey}`;
}

export function normalizeSignatureDisplay(
  message: string,
  displayMessage?: string,
  messageEncoding?: PersonalSignMessageEncoding,
  messageByteLength?: number
): Pick<DappSignatureRequest, "displayMessage" | "messageEncoding" | "messageByteLength"> {
  return {
    displayMessage: displayMessage ?? message,
    messageEncoding: messageEncoding ?? "utf8",
    messageByteLength: messageByteLength ?? new TextEncoder().encode(message).length
  };
}

async function persistApprovals(): Promise<void> {
  await writeStoredApprovals(storedApprovals);
}

function storedApprovalById(id: string): StoredPendingApproval | undefined {
  return storedApprovals.find((approval) => approval.id === id);
}

async function expireApproval(approval: StoredDappApproval): Promise<void> {
  await approvalMutationChain.run(async () => {
    const current = storedApprovalById(approval.id);
    if (!current) return;
    if (executionStarted(current)) {
      // A timeout is not proof that the provider did not broadcast. Keep the
      // durable dedupe barrier; a late result can still settle the execution.
      rejectLiveApproval(approval.id, new Error(UNCERTAIN_APPROVAL_MESSAGE));
      return;
    }
    storedApprovals = storedApprovals.filter((entry) => entry.id !== approval.id);
    await persistApprovals();
  });
  rejectLiveApproval(approval.id, new Error(`${approval.approvalKind === "signature" ? "Signature" : "Transaction"} request timed out`));
}

async function waitForApproval(approval: StoredDappApproval): Promise<DappApprovalOutcome> {
  const outcome = await waitForApprovalOutcome(approval, expireApproval);
  // Keep a resolved result for one equivalent request to recover if the worker
  // dies before the response reaches the page. Rejections need no such receipt.
  if (outcome.status === "rejected") {
    await approvalMutationChain.run(() => removeOutcomeKeys(outcomeKeysForApproval(approval)));
  }
  return outcome;
}

export async function initPendingDappApprovals(): Promise<void> {
  if (!initPromise) {
    initPromise = approvalMutationChain.run(async () => {
      const [current, currentOutcomes] = await Promise.all([
        readStoredApprovals(),
        readStoredOutcomes()
      ]);
      const byId = new Map<string, StoredPendingApproval>();
      for (const approval of current.flatMap((entry) => {
        const parsed = parseStoredApproval(entry);
        return parsed ? [parsed] : [];
      })) {
        byId.set(approval.id, approval);
      }
      storedApprovals = pruneExpired([...byId.values()]);
      // No execution callback survives a worker restart. Claimed requests never
      // reached it; executing requests may already have been broadcast.
      for (const approval of storedApprovals) {
        if (approval.executionState === "claimed") {
          for (const key of outcomeKeysForApproval(approval)) {
            currentOutcomes[key] = { status: "rejected", message: "Approval interrupted before execution; request cancelled" };
          }
        } else if (executionStarted(approval)) {
          approval.executionState = "uncertain";
        }
      }
      storedApprovals = storedApprovals.filter((approval) => approval.executionState !== "claimed");
      await persistApprovals();
      await writeStoredOutcomes(currentOutcomes);
      registerOutcomeStorageListener();
    });
  }
  await initPromise;
}

export function listPendingDappApprovals(approvalKind: "signature", walletId?: string): StoredPendingSignature[];
export function listPendingDappApprovals(approvalKind: "transaction", walletId?: string): StoredPendingDappTransaction[];
export function listPendingDappApprovals(approvalKind: DappApprovalKind, walletId?: string): StoredPendingApproval[] {
  return storedApprovals.filter(
    (approval) => approval.executionState === undefined && approval.expiresAt > Date.now()
      && approval.approvalKind === approvalKind && (!walletId || approval.walletId === walletId)
  );
}

export function getPendingDappApproval(approvalKind: "signature", id: string): StoredPendingSignature | undefined;
export function getPendingDappApproval(approvalKind: "transaction", id: string): StoredPendingDappTransaction | undefined;
export function getPendingDappApproval(approvalKind: DappApprovalKind, id: string): StoredPendingApproval | undefined {
  const approval = storedApprovalById(id);
  return approval?.approvalKind === approvalKind && approval.executionState === undefined
    && approval.expiresAt > Date.now() ? approval : undefined;
}

export function claimPendingDappApproval(id: string, kind: "signature"): Promise<StoredPendingSignature>;
export function claimPendingDappApproval(id: string, kind: "transaction"): Promise<StoredPendingDappTransaction>;
export async function claimPendingDappApproval(id: string, kind: DappApprovalKind): Promise<StoredPendingApproval> {
  await initPendingDappApprovals();
  return approvalMutationChain.run(async () => {
    const approval = storedApprovalById(id);
    if (!approval || approval.approvalKind !== kind || approval.expiresAt <= Date.now()) {
      throw new Error("Approval request was not found, expired or already resolved");
    }
    if (approval.executionState !== undefined) throw new Error("Approval request is already being processed; it cannot be retried");
    const claimed = { ...approval, executionState: "claimed" as const };
    storedApprovals = storedApprovals.map((entry) => entry === approval ? claimed : entry);
    try {
      await persistApprovals();
    } catch (error) {
      rejectLiveApproval(id, new Error("Approval could not be saved; request cancelled"));
      throw error;
    }
    return claimed;
  });
}

export async function executeClaimedDappApproval<T>(
  claim: StoredPendingApproval,
  assertCanExecute: () => void,
  execute: () => Promise<T>
): Promise<T> {
  const started = await approvalMutationChain.run(async () => {
    const current = storedApprovalById(claim.id);
    if (current !== claim || current.executionState !== "claimed" || current.expiresAt <= Date.now()) {
      throw new Error("Approval request was cancelled, expired or already resolved");
    }
    current.executionState = "executing";
    try {
      await persistApprovals();
      if (current.expiresAt <= Date.now()) throw new Error("Approval request expired before execution");
      assertCanExecute();
    } catch (error) {
      // No side effect was invoked; failure cleanup can safely cancel the claim.
      current.executionState = "claimed";
      throw error;
    }
    // Start inside the state transition, but never hold the storage queue while
    // signing or waiting on RPC. Cancellation ordered after this point loses.
    return { result: execute() };
  });
  return started.result;
}

export async function failClaimedDappApproval(claim: StoredPendingApproval): Promise<void> {
  await approvalMutationChain.run(async () => {
    const current = storedApprovalById(claim.id);
    if (current !== claim) return;
    const message = executionStarted(current) ? UNCERTAIN_APPROVAL_MESSAGE : "Approval failed before execution; request cancelled";
    if (executionStarted(current)) {
      current.executionState = "uncertain";
    } else {
      storedApprovals = storedApprovals.filter((entry) => entry !== current);
    }
    // Notify the caller even if persistence fails; an executing record was
    // persisted before effects and remains a barrier after worker recovery.
    try {
      await persistApprovals();
    } finally {
      if (current.executionOutcome) resolveLiveApproval(claim.id, current.executionOutcome);
      else rejectLiveApproval(claim.id, new Error(message));
    }
  });
}

export async function queueAndWaitPendingDappApproval(
  approval: StoredPendingApproval,
  lookupKeys: (existing?: StoredPendingApproval) => string[]
): Promise<DappApprovalOutcome> {
  await initPendingDappApprovals();
  const result = await approvalMutationChain.run<QueuedApprovalResult>(async () => {
    const existing = storedApprovals.find(
      (entry) => entry.approvalKind === approval.approvalKind && entry.dedupeKey === approval.dedupeKey
    );
    const outcomes = await readStoredOutcomes();
    if (existing?.executionOutcome) return { type: "outcome", outcome: existing.executionOutcome };
    const keys = lookupKeys(existing);
    const outcome = keys.map((key) => outcomes[key]).find((entry) => entry !== undefined);
    if (outcome !== undefined) {
      for (const key of keys) delete outcomes[key];
      await writeStoredOutcomes(outcomes);
      return { type: "outcome", outcome };
    }
    if (existing?.executionState === "uncertain") {
      return { type: "outcome", outcome: { status: "rejected", message: UNCERTAIN_APPROVAL_MESSAGE } };
    }
    if (existing) return { type: "approval", approval: existing };

    storedApprovals = [...storedApprovals, approval];
    await persistApprovals();
    return { type: "approval", approval };
  });
  return result.type === "outcome" ? result.outcome : waitForApproval(result.approval);
}

export async function removePendingDappApproval(id: string, approvalKind: "signature"): Promise<StoredPendingSignature | undefined>;
export async function removePendingDappApproval(id: string, approvalKind: "transaction"): Promise<StoredPendingDappTransaction | undefined>;
export async function removePendingDappApproval(id: string, approvalKind: DappApprovalKind): Promise<StoredPendingApproval | undefined> {
  await initPendingDappApprovals();
  const approval = await approvalMutationChain.run(async () => {
    const found = storedApprovalById(id);
    if (!found || found.approvalKind !== approvalKind) return undefined;
    if (executionStarted(found)) throw new Error(UNCERTAIN_APPROVAL_MESSAGE);
    storedApprovals = storedApprovals.filter((entry) => entry.id !== id);
    await persistApprovals();
    return found;
  });
  if (approval) {
    rejectLiveApproval(id, new Error(`${approval.approvalKind === "signature" ? "Signature" : "Transaction"} request timed out`));
  }
  return approval;
}

export async function settlePendingDappApproval(id: string, approvalKind: "signature", outcome: DappApprovalOutcome, notFoundMessage: string): Promise<StoredPendingSignature>;
export async function settlePendingDappApproval(id: string, approvalKind: "transaction", outcome: DappApprovalOutcome, notFoundMessage: string): Promise<StoredPendingDappTransaction>;
export async function settlePendingDappApproval(
  id: string,
  approvalKind: DappApprovalKind,
  outcome: DappApprovalOutcome,
  notFoundMessage: string
): Promise<StoredPendingApproval> {
  await initPendingDappApprovals();
  const approval = await approvalMutationChain.run(async () => {
    const found = storedApprovalById(id);
    if (!found || found.approvalKind !== approvalKind) throw new Error(notFoundMessage);
    if (outcome.status === "rejected" && executionStarted(found)) {
      throw new Error("Approval execution has already started and cannot be cancelled");
    }
    if (executionStarted(found)) {
      found.executionOutcome = outcome;
      await persistApprovals();
    }
    if (outcome.status === "resolved" || !hasLiveApproval(id)) await writeOutcome(found, outcome);
    else await removeOutcomeKeys(outcomeKeysForApproval(found));
    const remaining = storedApprovals.filter((entry) => entry.id !== id);
    await writeStoredApprovals(remaining);
    storedApprovals = remaining;
    return found;
  });

  if (hasLiveApproval(id)) resolveLiveApproval(id, outcome);

  return approval;
}

export async function rejectPendingDappApprovalsForWallet(
  walletId: string | undefined,
  approvalKind: DappApprovalKind | undefined,
  message: string,
  origin?: string
): Promise<void> {
  await initPendingDappApprovals();
  const removed = await approvalMutationChain.run(async () => {
    const nextRemoved = storedApprovals.filter((approval) =>
      !executionStarted(approval) && (!walletId || approval.walletId === walletId)
      && (!approvalKind || approval.approvalKind === approvalKind) && (!origin || approval.origin === origin)
    );
    storedApprovals = storedApprovals.filter((approval) => !nextRemoved.includes(approval));
    await persistApprovals();
    for (const approval of nextRemoved) {
      if (!hasLiveApproval(approval.id)) await writeOutcome(approval, { status: "rejected", message });
    }
    return nextRemoved;
  });
  for (const approval of removed) {
    if (hasLiveApproval(approval.id)) resolveLiveApproval(approval.id, { status: "rejected", message });
  }
}

export function resetPendingDappApprovalsForTests(): void {
  storedApprovals = [];
  initPromise = undefined;
  approvalMutationChain.reset();
  resetDappApprovalTransportForTests();
}
