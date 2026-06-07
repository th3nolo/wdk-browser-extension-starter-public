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
    storedApprovals = storedApprovals.filter((entry) => entry.id !== approval.id);
    await persistApprovals();
  });
  rejectLiveApproval(approval.id, new Error(`${approval.approvalKind === "signature" ? "Signature" : "Transaction"} request timed out`));
}

async function waitForApproval(approval: StoredDappApproval): Promise<DappApprovalOutcome> {
  const outcome = await waitForApprovalOutcome(approval, expireApproval);
  await approvalMutationChain.run(() => removeOutcomeKeys(outcomeKeysForApproval(approval)));
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
    (approval) => approval.approvalKind === approvalKind && (!walletId || approval.walletId === walletId)
  );
}

export function getPendingDappApproval(approvalKind: "signature", id: string): StoredPendingSignature | undefined;
export function getPendingDappApproval(approvalKind: "transaction", id: string): StoredPendingDappTransaction | undefined;
export function getPendingDappApproval(approvalKind: DappApprovalKind, id: string): StoredPendingApproval | undefined {
  const approval = storedApprovalById(id);
  return approval?.approvalKind === approvalKind ? approval : undefined;
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
    const keys = lookupKeys(existing);
    const outcome = keys.map((key) => outcomes[key]).find((entry) => entry !== undefined);
    if (outcome !== undefined) {
      for (const key of keys) delete outcomes[key];
      await writeStoredOutcomes(outcomes);
      return { type: "outcome", outcome };
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
    storedApprovals = storedApprovals.filter((entry) => entry.id !== id);
    await persistApprovals();
    if (hasLiveApproval(id)) await removeOutcomeKeys(outcomeKeysForApproval(found));
    else await writeOutcome(found, outcome);
    return found;
  });

  if (hasLiveApproval(id)) resolveLiveApproval(id, outcome);

  return approval;
}

export async function rejectPendingDappApprovalsForWallet(
  walletId: string | undefined,
  approvalKind: DappApprovalKind | undefined,
  message: string
): Promise<void> {
  await initPendingDappApprovals();
  const removed = await approvalMutationChain.run(async () => {
    const nextRemoved = storedApprovals.filter((approval) =>
      (!walletId || approval.walletId === walletId) && (!approvalKind || approval.approvalKind === approvalKind)
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
