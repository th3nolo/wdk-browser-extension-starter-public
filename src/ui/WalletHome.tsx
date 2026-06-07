import { useCallback, useEffect, useState } from "react";
import type { BalanceRecord, PopupState, PopupSummaryState } from "../sdk/view-types";
import { walletClient } from "./api";
import { BottomNav, type NavDestination } from "./BottomNav";
import { Avatar, Sheet } from "./common";
import { Icon } from "./Icon";
import type { PopupActionRunner } from "./usePopupState";
import { WalletSwitcherSheet } from "./WalletSwitcherSheet";
import { AppearancePanel } from "./wallet-home/AppearancePanel";
import { ActivityPanel } from "./wallet-home/ActivityPanel";
import { ConnectedSitesPanel } from "./wallet-home/ConnectedSitesPanel";
import { ReceivePanel } from "./wallet-home/ReceivePanel";
import { RpcOverridesPanel } from "./wallet-home/RpcOverridesPanel";
import { SendPanel } from "./wallet-home/SendPanel";
import { TokensPanel } from "./wallet-home/TokensPanel";

type TokensView = "overview" | "send" | "receive";

export function WalletHome({ state, busy, error, onState, updateBalances, refresh, run }: {
  state: PopupState;
  busy: boolean;
  error: string;
  onState: (state: PopupSummaryState | PopupState) => void;
  updateBalances: (balances: BalanceRecord[]) => void;
  refresh: () => Promise<void>;
  run: PopupActionRunner;
}) {
  const [nav, setNav] = useState<NavDestination>("tokens");
  const [tokensView, setTokensView] = useState<TokensView>("overview");
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [confirmAddOpen, setConfirmAddOpen] = useState(false);
  const [heroAccountIndex, setHeroAccountIndex] = useState(0);
  const [accountNotice, setAccountNotice] = useState("");
  const activeWallet = state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? state.wallets[0];
  const pendingRequestCount = state.pendingConnections.length + state.pendingSignatures.length + state.pendingTransactions.length;

  useEffect(() => {
    if (pendingRequestCount > 0) setNav("sites");
  }, [pendingRequestCount]);

  // Reset the displayed account when switching wallets.
  useEffect(() => {
    setHeroAccountIndex(0);
    setAccountNotice("");
  }, [activeWallet?.id]);

  const loadBalances = useCallback(async function loadBalances() {
    setBalancesLoading(true);
    const balances = await run(() => walletClient.getBalances());
    if (balances) updateBalances(balances);
    setBalancesLoading(false);
  }, [run, updateBalances]);

  useEffect(() => {
    if (nav === "tokens" && !state.locked) void loadBalances();
  }, [loadBalances, nav, state.activeWalletId, state.accounts.length, state.locked]);

  async function refreshAll() {
    await refresh();
    if (nav === "tokens") await loadBalances();
  }

  async function lock() {
    const next = await run(() => walletClient.lock());
    if (next) onState(next);
  }

  async function addAccount() {
    if (!activeWallet) return;
    setConfirmAddOpen(false);
    const newIndex = activeWallet.accountCount; // the new account's 0-based index
    const next = await run(() => walletClient.addAccount(activeWallet.id));
    if (next) {
      onState(next);
      setHeroAccountIndex(newIndex);
      setAccountNotice(`Account ${newIndex + 1} added`);
      window.setTimeout(() => setAccountNotice((current) => (current === `Account ${newIndex + 1} added` ? "" : current)), 2600);
    }
  }

  async function switchWallet(walletId: string, password: string): Promise<boolean> {
    const next = await run(() => walletClient.switchWallet(walletId, password));
    if (next) {
      onState(next);
      return true;
    }
    return false;
  }

  async function deleteWallet(walletId: string, password: string): Promise<boolean> {
    const next = await run(() => walletClient.deleteWallet(walletId, password));
    if (next) {
      onState(next);
      return true;
    }
    return false;
  }

  async function onApproveConnection(origin: string, accountIndexes: number[]) {
    const next = await run(() => walletClient.connectApprove(origin, accountIndexes));
    if (next) onState(next);
  }

  async function onRejectConnection(origin: string) {
    const next = await run(() => walletClient.connectReject(origin));
    if (next) onState(next);
  }

  async function onRevokeConnection(origin: string) {
    const next = await run(() => walletClient.revoke(origin));
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

  function goToTokens(view: TokensView) {
    setTokensView(view);
    setNav("tokens");
  }

  const tokensSubtitle = tokensView === "send" ? "Send" : tokensView === "receive" ? "Receive" : undefined;

  return (
    <main className={`shell wlt${pendingRequestCount > 0 ? " approval-active" : ""}`}>
      <div className="topbar">
        <button type="button" className="wallet-pill" onClick={() => setSwitcherOpen(true)} title="Switch wallet">
          <Avatar seed={activeWallet?.id ?? "wallet"} label={(activeWallet?.name ?? "W").slice(0, 1).toUpperCase()} size={32} />
          <span className="wallet-pill-text">
            <strong>{activeWallet?.name ?? "WDK Wallet"}</strong>
            <span className="muted">{state.sessionExpiresAt ? `Unlocked until ${new Date(state.sessionExpiresAt).toLocaleTimeString()}` : "Unlocked"}</span>
          </span>
          <Icon name="chevronDown" size={16} style={{ color: "var(--muted)", flex: "0 0 auto" }} />
        </button>
        <div className="actions">
          <button className="icon sm" onClick={refreshAll} disabled={busy} title="Refresh"><Icon name="refresh" size={16} /></button>
          <button className="icon sm" onClick={() => setNav("settings")} title="Settings"><Icon name="settings" size={16} /></button>
          <button className="icon sm" onClick={lock} disabled={busy} title="Lock"><Icon name="lock" size={16} /></button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="shell-body">
        {nav === "tokens" && tokensView === "overview" && (
          <TokensPanel
            state={state}
            balancesLoading={balancesLoading}
            walletName={activeWallet?.name ?? "WDK Wallet"}
            heroAccountIndex={heroAccountIndex}
            notice={accountNotice}
            onSend={() => goToTokens("send")}
            onReceive={() => goToTokens("receive")}
            onAddAccount={() => setConfirmAddOpen(true)}
            onRefreshBalances={loadBalances}
          />
        )}
        {nav === "tokens" && tokensView !== "overview" && (
          <div className="stack subview">
            <div className="subbar subview-bar">
              <button type="button" className="icon sm" onClick={() => setTokensView("overview")} title="Back"><Icon name="arrowLeft" size={16} /></button>
              <h2 className="grow">{tokensSubtitle}</h2>
            </div>
            {tokensView === "send" && <SendPanel state={state} busy={busy} run={run} onState={onState} />}
            {tokensView === "receive" && <ReceivePanel accounts={state.accounts} />}
          </div>
        )}
        {nav === "activity" && <ActivityPanel state={state} />}
        {nav === "sites" && (
          <ConnectedSitesPanel
            state={state}
            busy={busy}
            onApproveConnection={onApproveConnection}
            onRejectConnection={onRejectConnection}
            onRevokeConnection={onRevokeConnection}
            onSignature={onSignature}
            onTransaction={onTransaction}
          />
        )}
        {nav === "settings" && (
          <div className="stack">
            <div className="section-title"><h2>Settings</h2></div>
            <AppearancePanel />
            <div className="section-title"><h2>Network / RPC</h2></div>
            <RpcOverridesPanel state={state} busy={busy} run={run} onState={onState} />
          </div>
        )}
      </div>

      <BottomNav
        value={nav}
        onChange={(next) => { setNav(next); if (next === "tokens") setTokensView("overview"); }}
        badge={{ sites: pendingRequestCount }}
      />

      {switcherOpen && (
        <WalletSwitcherSheet
          state={state}
          activeWallet={activeWallet}
          busy={busy}
          onClose={() => setSwitcherOpen(false)}
          onState={onState}
          onSwitch={switchWallet}
          onDelete={deleteWallet}
          run={run}
        />
      )}

      {confirmAddOpen && (
        <Sheet title="Add account" onClose={() => setConfirmAddOpen(false)}>
          <p className="muted">
            Create <strong>Account {(activeWallet?.accountCount ?? 0) + 1}</strong> in {activeWallet?.name ?? "this wallet"}?
            It derives a fresh address on every network. You can switch between accounts anytime.
          </p>
          <div className="actions split-actions">
            <button type="button" className="secondary" onClick={() => setConfirmAddOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" onClick={addAccount} disabled={busy}>Create account</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
