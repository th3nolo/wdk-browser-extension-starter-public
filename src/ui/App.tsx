import { useEffect, useRef } from "react";
import { ApprovalView } from "./ApprovalView";
import { Onboarding } from "./Onboarding";
import { Unlock } from "./Unlock";
import { WalletHome } from "./WalletHome";
import { usePopupState } from "./usePopupState";

export function App() {
  const { state, busy, error, refresh, applyState, updateBalances, run } = usePopupState();

  // When opened as a dedicated approval window (chrome.windows.create with the
  // #approval hash), close it automatically once every request is handled.
  const isApprovalWindow = typeof window !== "undefined" && window.location.hash.includes("approval");
  const pendingCount = state.pendingConnections.length + state.pendingSignatures.length + state.pendingTransactions.length;
  const sawPending = useRef(false);
  useEffect(() => {
    if (!isApprovalWindow) return;
    if (pendingCount > 0) sawPending.current = true;
    else if (sawPending.current) window.close();
  }, [isApprovalWindow, pendingCount]);

  if (!state.hasVault) {
    return <Onboarding busy={busy} error={error} onState={applyState} run={run} />;
  }

  if (state.locked) {
    return <Unlock busy={busy} error={error} onState={applyState} run={run} />;
  }

  if (pendingCount > 0) {
    return <ApprovalView state={state} busy={busy} error={error} onState={applyState} run={run} />;
  }

  return (
    <WalletHome
      state={state}
      busy={busy}
      error={error}
      onState={applyState}
      updateBalances={updateBalances}
      refresh={refresh}
      run={run}
    />
  );
}
