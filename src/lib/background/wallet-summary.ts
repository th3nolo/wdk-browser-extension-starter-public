import type { BalanceRecord, PopupState, PopupSummaryState, WalletSummary } from "../types";
import { peekSession, sessionExpiresAt } from "../session/session";
import { readStore, updateStore } from "../storage/store";
import { refreshTransactionStatuses } from "../transactions/status";
import { listPendingDappApprovalRequests } from "./dapp-approval-workflow";
import { listBalancesForWalletAccounts, listWalletAccounts } from "./wallet-execution";

export async function walletSummary(): Promise<WalletSummary> {
  const store = await readStore();
  const session = peekSession();
  const activeUnlocked = Boolean(store.activeWalletId && session?.walletId === store.activeWalletId);
  const pendingApprovals = listPendingDappApprovalRequests(store.activeWalletId);
  return {
    locked: !activeUnlocked,
    hasVault: store.wallets.some((wallet) => Boolean(store.vaults[wallet.id])),
    wallets: store.wallets,
    activeWalletId: store.activeWalletId,
    sessionExpiresAt: activeUnlocked ? sessionExpiresAt(store.activeWalletId) : undefined,
    rpcOverrides: store.rpcOverrides,
    connectedSites: store.activeWalletId ? store.connectedSites.filter((site) => site.walletId === store.activeWalletId) : [],
    pendingConnections: store.activeWalletId
      ? store.pendingConnections.filter((request) => request.walletId === store.activeWalletId)
      : [],
    ...pendingApprovals
  };
}

export async function refreshStoredTransactionStatuses() {
  return updateStore(async (store) => {
    const refreshedTransactions = await refreshTransactionStatuses(store.transactions, store.rpcOverrides);
    return refreshedTransactions === store.transactions ? store : { ...store, transactions: refreshedTransactions };
  });
}

export async function walletSummaryState(): Promise<PopupSummaryState> {
  const base = await walletSummary();
  const store = await refreshStoredTransactionStatuses();
  const activeWallet = base.wallets.find((entry) => entry.id === base.activeWalletId);
  const walletTransactions = activeWallet ? store.transactions.filter((tx) => tx.walletId === activeWallet.id) : [];
  const session = peekSession();

  if (!session || !activeWallet || session.walletId !== activeWallet.id) {
    return { ...base, accounts: [], transactions: walletTransactions };
  }

  const accounts = await listWalletAccounts(activeWallet, store) ?? [];
  return { ...base, accounts, transactions: walletTransactions };
}

export async function walletBalances(): Promise<BalanceRecord[]> {
  const store = await readStore();
  const session = peekSession();
  const activeWallet = store.wallets.find((entry) => entry.id === store.activeWalletId);
  if (!session || !activeWallet || session.walletId !== activeWallet.id) {
    return [];
  }
  const accounts = await listWalletAccounts(activeWallet, store) ?? [];
  return aggregateBalances(await listBalancesForWalletAccounts(activeWallet.id, accounts, store));
}

export async function fullWalletState(): Promise<PopupState> {
  const summary = await walletSummaryState();
  if (summary.locked) return { ...summary, balances: [] };
  if (!summary.activeWalletId) return { ...summary, balances: [] };
  const store = await readStore();
  const balances = aggregateBalances(await listBalancesForWalletAccounts(summary.activeWalletId, summary.accounts, store));
  return { ...summary, balances };
}

function aggregateBalances(entries: BalanceRecord[]): BalanceRecord[] {
  const byKey = new Map<string, BalanceRecord>();
  for (const balance of entries) {
    const key = `${balance.chain}-${balance.asset}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...balance });
      continue;
    }
    byKey.set(key, {
      ...existing,
      amount: (BigInt(existing.amount) + BigInt(balance.amount)).toString()
    });
  }
  return [...byKey.values()];
}
