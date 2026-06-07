import {
  DAPP_APPROVAL_OUTCOMES_STORAGE_KEY,
  DAPP_APPROVALS_STORAGE_KEY,
  type DappApprovalOutcome,
  type StoredDappApproval,
  type StoredPendingApproval
} from "./pending-dapp-approval-types";
import { isRecord, parseStoredOutcome } from "./pending-dapp-approval-codec";

async function readStoredArray<T>(storageKey: string): Promise<T[]> {
  const item = await browser.storage.session.get(storageKey);
  const value = item[storageKey];
  return Array.isArray(value) ? value as T[] : [];
}

async function writeStoredArray<T>(storageKey: string, values: T[]): Promise<void> {
  if (values.length) {
    await browser.storage.session.set({ [storageKey]: values });
    return;
  }
  await browser.storage.session.remove(storageKey);
}

async function readStoredRecord(storageKey: string): Promise<Record<string, unknown>> {
  const item = await browser.storage.session.get(storageKey);
  const value = item[storageKey];
  return isRecord(value) ? value : {};
}

export async function readStoredApprovals(): Promise<unknown[]> {
  return readStoredArray<unknown>(DAPP_APPROVALS_STORAGE_KEY);
}

export async function writeStoredApprovals(approvals: StoredPendingApproval[]): Promise<void> {
  await writeStoredArray(DAPP_APPROVALS_STORAGE_KEY, approvals);
}

export async function readStoredOutcomes(storageKey = DAPP_APPROVAL_OUTCOMES_STORAGE_KEY): Promise<Record<string, DappApprovalOutcome>> {
  const record = await readStoredRecord(storageKey);
  const outcomes: Record<string, DappApprovalOutcome> = {};
  for (const [key, value] of Object.entries(record)) {
    const outcome = parseStoredOutcome(value);
    if (outcome) outcomes[key] = outcome;
  }
  return outcomes;
}

export async function writeStoredOutcomes(outcomes: Record<string, DappApprovalOutcome>): Promise<void> {
  if (Object.keys(outcomes).length) {
    await browser.storage.session.set({ [DAPP_APPROVAL_OUTCOMES_STORAGE_KEY]: outcomes });
    return;
  }
  await browser.storage.session.remove(DAPP_APPROVAL_OUTCOMES_STORAGE_KEY);
}

export function outcomeKeysForApproval(approval: StoredDappApproval): string[] {
  return [approval.id, approval.dedupeKey];
}

export async function removeOutcomeKeys(keys: string[]): Promise<void> {
  const outcomes = await readStoredOutcomes();
  for (const key of keys) delete outcomes[key];
  await writeStoredOutcomes(outcomes);
}

export async function writeOutcome(approval: StoredDappApproval, outcome: DappApprovalOutcome): Promise<void> {
  const outcomes = await readStoredOutcomes();
  for (const key of outcomeKeysForApproval(approval)) outcomes[key] = outcome;
  await writeStoredOutcomes(outcomes);
}
