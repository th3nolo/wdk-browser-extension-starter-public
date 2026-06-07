import { useEffect, useState } from "react";
import type { PopupState, PopupSummaryState, WalletRecord } from "../sdk/view-types";
import { Avatar, Banner, Sheet, WalletForm } from "./common";
import { Icon } from "./Icon";
import type { PopupActionRunner } from "./usePopupState";

type Mode = "list" | "switch" | "add" | "delete";

export function WalletSwitcherSheet({
  state,
  activeWallet,
  busy,
  onClose,
  onState,
  onSwitch,
  onDelete,
  run
}: {
  state: PopupState;
  activeWallet: WalletRecord | undefined;
  busy: boolean;
  onClose: () => void;
  onState: (state: PopupSummaryState | PopupState) => void;
  onSwitch: (walletId: string, password: string) => Promise<boolean>;
  onDelete: (walletId: string, password: string) => Promise<boolean>;
  run: PopupActionRunner;
}) {
  const [mode, setMode] = useState<Mode>("list");
  const [targetWalletId, setTargetWalletId] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setPassword("");
  }, [mode, targetWalletId]);

  function beginSwitch(walletId: string) {
    if (walletId === activeWallet?.id) {
      onClose();
      return;
    }
    setTargetWalletId(walletId);
    setMode("switch");
  }

  function beginDelete(walletId: string) {
    setTargetWalletId(walletId);
    setMode("delete");
  }

  const targetWallet = state.wallets.find((wallet) => wallet.id === targetWalletId);

  async function confirmSwitch() {
    if (!targetWalletId || !password) return;
    const ok = await onSwitch(targetWalletId, password);
    if (ok) onClose();
  }

  async function confirmDelete() {
    if (!targetWalletId || !password) return;
    const ok = await onDelete(targetWalletId, password);
    if (ok) onClose();
  }

  const title = mode === "add"
    ? "Add wallet"
    : mode === "delete"
      ? "Delete wallet"
      : mode === "switch"
        ? "Switch wallet"
        : "Wallets";

  return (
    <Sheet title={title} onClose={onClose}>
      {mode === "list" && (
        <div className="wallet-switch-list">
          {state.wallets.map((wallet) => {
            const isActive = wallet.id === activeWallet?.id;
            return (
              <div key={wallet.id} className={`wallet-switch-row${isActive ? " active" : ""}`}>
                <button
                  type="button"
                  className="wallet-switch-main"
                  onClick={() => beginSwitch(wallet.id)}
                  disabled={busy}
                  title={isActive ? "Active wallet" : `Switch to ${wallet.name}`}
                >
                  <Avatar seed={wallet.id} label={wallet.name.slice(0, 1).toUpperCase()} />
                  <span className="wallet-switch-text">
                    <strong>{wallet.name}</strong>
                    <span className="muted">{wallet.accountCount} account{wallet.accountCount === 1 ? "" : "s"}</span>
                  </span>
                  {isActive
                    ? <span className="wallet-switch-check"><Icon name="checkCircle" size={16} /></span>
                    : <Icon name="chevronRight" size={16} style={{ color: "var(--muted)", flex: "0 0 auto" }} />}
                </button>
                {state.wallets.length > 1 && (
                  <button
                    type="button"
                    className="icon sm danger"
                    onClick={() => beginDelete(wallet.id)}
                    disabled={busy}
                    title="Delete wallet"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="secondary btn-block add-wallet-button" onClick={() => setMode("add")} disabled={busy}>
            <Icon name="plus" size={16} />
            Add wallet
          </button>
        </div>
      )}

      {mode === "switch" && targetWallet && (
        <div className="stack">
          <p className="muted">Enter the password for <strong>{targetWallet.name}</strong> to switch.</p>
          <label>
            Wallet password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="actions split-actions">
            <button className="secondary" type="button" onClick={() => setMode("list")} disabled={busy}>Cancel</button>
            <button type="button" disabled={busy || !password} onClick={confirmSwitch}>Switch</button>
          </div>
        </div>
      )}

      {mode === "delete" && targetWallet && (
        <div className="stack">
          <Banner kind="danger">
            Permanently remove <strong>{targetWallet.name}</strong> from this browser. Connected sites for this wallet
            will be disconnected. This cannot be undone without your recovery phrase.
          </Banner>
          <label>
            Wallet password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="actions split-actions">
            <button className="secondary" type="button" onClick={() => setMode("list")} disabled={busy}>Cancel</button>
            <button className="danger-button" type="button" disabled={busy || !password} onClick={confirmDelete}>
              <Icon name="trash" size={16} />
              Delete vault
            </button>
          </div>
        </div>
      )}

      {mode === "add" && (
        <WalletForm
          title="Add wallet"
          subtitle="Create or import another encrypted wallet vault."
          defaultName={`Wallet ${state.wallets.length + 1}`}
          busy={busy}
          onState={onState}
          onDone={onClose}
          run={run}
        />
      )}
    </Sheet>
  );
}
