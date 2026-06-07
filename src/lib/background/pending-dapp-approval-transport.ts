import { isRecord, parseStoredOutcome } from "./pending-dapp-approval-codec";
import { readStoredOutcomes } from "./pending-dapp-approval-storage";
import {
  DAPP_APPROVAL_OUTCOMES_STORAGE_KEY,
  type DappApprovalOutcome,
  type StoredDappApproval
} from "./pending-dapp-approval-types";

type ApprovalWaiter = {
  resolve: (outcome: DappApprovalOutcome) => void;
  reject: (error: Error) => void;
};

type LiveApproval = {
  approval: StoredDappApproval;
  waiters: ApprovalWaiter[];
  timeout: ReturnType<typeof setTimeout>;
};

let liveApprovals = new Map<string, LiveApproval>();
let outcomePollTimer: ReturnType<typeof setInterval> | undefined;
let storageListenerRegistered = false;
const OUTCOME_POLL_MS = 250;

function settleLive(id: string, settle: (waiter: ApprovalWaiter) => void): void {
  const live = liveApprovals.get(id);
  if (!live) return;
  clearTimeout(live.timeout);
  liveApprovals.delete(id);
  for (const waiter of live.waiters) settle(waiter);
  stopOutcomePollingIfIdle();
}

export function hasLiveApproval(id: string): boolean {
  return liveApprovals.has(id);
}

export function resolveLiveApproval(id: string, outcome: DappApprovalOutcome): void {
  settleLive(id, (waiter) => waiter.resolve(outcome));
}

export function rejectLiveApproval(id: string, error: Error): void {
  settleLive(id, (waiter) => waiter.reject(error));
}

async function pollStoredOutcomes(): Promise<void> {
  const outcomes = await readStoredOutcomes();
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (liveApprovals.has(id)) resolveLiveApproval(id, outcome);
  }
}

function startOutcomePolling(): void {
  if (outcomePollTimer) return;
  outcomePollTimer = setInterval(() => {
    void pollStoredOutcomes();
  }, OUTCOME_POLL_MS);
}

function stopOutcomePollingIfIdle(): void {
  if (liveApprovals.size || outcomePollTimer === undefined) return;
  clearInterval(outcomePollTimer);
  outcomePollTimer = undefined;
}

export function registerOutcomeStorageListener(): void {
  if (storageListenerRegistered || !browser.storage.session.onChanged) return;
  storageListenerRegistered = true;
  browser.storage.session.onChanged.addListener((changes) => {
    const change = changes[DAPP_APPROVAL_OUTCOMES_STORAGE_KEY];
    if (!isRecord(change?.newValue)) return;
    for (const [id, value] of Object.entries(change.newValue)) {
      const outcome = parseStoredOutcome(value);
      if (outcome && liveApprovals.has(id)) resolveLiveApproval(id, outcome);
    }
  });
}

function ensureLiveApproval(
  approval: StoredDappApproval,
  onExpire: (approval: StoredDappApproval) => void | Promise<void>
): LiveApproval {
  const existing = liveApprovals.get(approval.id);
  if (existing) return existing;
  const timeout = setTimeout(() => {
    void onExpire(approval);
  }, Math.max(0, approval.expiresAt - Date.now()));
  const live: LiveApproval = { approval, waiters: [], timeout };
  liveApprovals.set(approval.id, live);
  startOutcomePolling();
  return live;
}

export async function waitForApprovalOutcome(
  approval: StoredDappApproval,
  onExpire: (approval: StoredDappApproval) => void | Promise<void>
): Promise<DappApprovalOutcome> {
  const live = ensureLiveApproval(approval, onExpire);
  return new Promise<DappApprovalOutcome>((resolve, reject) => {
    live.waiters.push({ resolve, reject });
  });
}

export function resetDappApprovalTransportForTests(): void {
  for (const live of liveApprovals.values()) clearTimeout(live.timeout);
  liveApprovals = new Map();
  storageListenerRegistered = false;
  if (outcomePollTimer !== undefined) {
    clearInterval(outcomePollTimer);
    outcomePollTimer = undefined;
  }
}
