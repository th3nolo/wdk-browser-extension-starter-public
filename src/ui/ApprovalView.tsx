import type { PopupState, PopupSummaryState } from "../sdk/view-types";
import { walletClient } from "./api";
import { Header } from "./common";
import { DappConnectionRequestCard } from "./DappConnectionRequestCard";
import { DappTransactionRequestCard } from "./DappTransactionRequestCard";
import { SignatureRequestCard } from "./SignatureRequestCard";
import type { PopupActionRunner } from "./usePopupState";

/**
 * Focused approval screen shown whenever there are pending dApp requests. It
 * deliberately renders ONLY the request(s) — no wallet switcher, tabs, or
 * management chrome — so the approval window fits without scrolling.
 */
export function ApprovalView({ state, busy, error, onState, run }: {
  state: PopupState;
  busy: boolean;
  error: string;
  onState: (state: PopupSummaryState | PopupState) => void;
  run: PopupActionRunner;
}) {
  const activeWallet = state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? state.wallets[0];

  async function onApproveConnection(origin: string, accountIndexes: number[]) {
    const next = await run(() => walletClient.connectApprove(origin, accountIndexes));
    if (next) onState(next);
  }

  async function onRejectConnection(origin: string) {
    const next = await run(() => walletClient.connectReject(origin));
    if (next) onState(next);
  }

  async function onSignature(type: "APPROVE_SIGNATURE" | "REJECT_SIGNATURE", id: string) {
    const next = await run(() => (type === "APPROVE_SIGNATURE" ? walletClient.approveSignature(id) : walletClient.rejectSignature(id)));
    if (next) onState(next);
  }

  async function onTransaction(type: "APPROVE_DAPP_TRANSACTION" | "REJECT_DAPP_TRANSACTION", id: string) {
    const next = await run(() => (type === "APPROVE_DAPP_TRANSACTION" ? walletClient.approveTransaction(id) : walletClient.rejectTransaction(id)));
    if (next) onState(next);
  }

  return (
    <main className="approval-shell wlt">
      <div className="approval-shell-top">
        <Header title={activeWallet?.name ?? "WDK Wallet"} subtitle="Review before approving" />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="approval-hero">
        <span className="approval-kind">Wallet confirmation</span>
        <h2>Review this request carefully</h2>
        <p>Only approve requests from sites you trust.</p>
      </div>
      <div className="stack approval-workflow">
        {state.pendingConnections.map((request) => (
          <DappConnectionRequestCard
            key={`${request.walletId}-${request.origin}`}
            request={request}
            accounts={state.accounts}
            busy={busy}
            onApprove={(accountIndexes) => onApproveConnection(request.origin, accountIndexes)}
            onReject={() => onRejectConnection(request.origin)}
          />
        ))}
        {state.pendingSignatures.map((request) => (
          <SignatureRequestCard
            key={request.id}
            request={request}
            busy={busy}
            onApprove={() => onSignature("APPROVE_SIGNATURE", request.id)}
            onReject={() => onSignature("REJECT_SIGNATURE", request.id)}
          />
        ))}
        {state.pendingTransactions.map((request) => (
          <DappTransactionRequestCard
            key={request.id}
            request={request}
            busy={busy}
            onApprove={() => onTransaction("APPROVE_DAPP_TRANSACTION", request.id)}
            onReject={() => onTransaction("REJECT_DAPP_TRANSACTION", request.id)}
          />
        ))}
      </div>
    </main>
  );
}
