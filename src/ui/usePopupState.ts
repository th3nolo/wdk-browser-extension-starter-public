import { useCallback, useEffect, useState } from "react";
import type { BalanceRecord, PopupState, PopupSummaryState } from "../sdk/view-types";
import { walletClient } from "./api";

const EMPTY_STATE: PopupState = {
  locked: true,
  hasVault: false,
  wallets: [],
  accounts: [],
  balances: [],
  transactions: [],
  connectedSites: [],
  pendingConnections: [],
  pendingSignatures: [],
  pendingTransactions: []
};

export type PopupActionRunner = <T>(action: () => Promise<T>) => Promise<T | undefined>;

export function usePopupState() {
  const [state, setState] = useState<PopupState>(EMPTY_STATE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected wallet error");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async function refresh() {
    const next = await run(() => walletClient.getSummary());
    if (next) setState((prev) => mergePopupState(prev, next));
  }, [run]);

  const applyState = useCallback(function applyState(next: PopupSummaryState | PopupState) {
    setState((prev) => mergePopupState(prev, next));
  }, []);

  const updateBalances = useCallback(function updateBalances(balances: BalanceRecord[]) {
    setState((prev) => ({ ...prev, balances }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, busy, error, refresh, applyState, updateBalances, run };
}

function mergePopupState(prev: PopupState, next: PopupSummaryState | PopupState): PopupState {
  if (next.locked) return { ...next, balances: [] };
  const balances = "balances" in next ? next.balances : prev.balances;
  return { ...next, balances };
}
