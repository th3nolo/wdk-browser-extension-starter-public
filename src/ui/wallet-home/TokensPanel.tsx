import { useMemo, useState } from "react";
import type { PopupState } from "../../sdk/view-types";
import { Avatar, chainLabel, isNonZeroAmount, shortAddress } from "../common";
import { Icon } from "../Icon";
import { AssetsPanel } from "./AssetsPanel";

export function TokensPanel({ state, balancesLoading, walletName, heroAccountIndex = 0, notice = "", onSend, onReceive, onAddAccount, onRefreshBalances }: {
  state: PopupState;
  balancesLoading: boolean;
  walletName: string;
  heroAccountIndex?: number;
  notice?: string;
  onSend: () => void;
  onReceive: () => void;
  onAddAccount: () => void;
  onRefreshBalances: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const primaryAccount = useMemo(
    () =>
      state.accounts.find((account) => account.chain === "ethereum" && account.index === heroAccountIndex) ??
      state.accounts.find((account) => account.chain === "ethereum" && account.index === 0) ??
      state.accounts[0],
    [state.accounts, heroAccountIndex]
  );
  const heldCount = useMemo(
    () => state.balances.filter((balance) => isNonZeroAmount(balance.amount)).length,
    [state.balances]
  );
  const balancesPending = balancesLoading && state.balances.length === 0;

  async function copyAddress() {
    if (!primaryAccount || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(primaryAccount.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <section className="stack tokens-panel">
      <div className="hero tokens-hero">
        <div className="tokens-hero-account">
          <Avatar seed={primaryAccount?.address ?? walletName} label={walletName.slice(0, 1).toUpperCase()} size={44} />
          <div className="tokens-hero-id">
            <strong>{primaryAccount ? `${chainLabel(primaryAccount.chain)} · Account ${primaryAccount.index + 1}` : walletName}</strong>
            {primaryAccount && (
              <button type="button" className="addr-chip tokens-hero-address" onClick={copyAddress} title="Copy address">
                <code>{shortAddress(primaryAccount.address)}</code>
                <Icon name="copy" size={13} />
              </button>
            )}
          </div>
        </div>
        <p className="tokens-hero-total">
          {balancesPending ? (
            <span className="muted">Loading balances…</span>
          ) : (
            <>
              <span className="hero-amount tokens-hero-count">{heldCount}</span>
              <span className="muted"> asset{heldCount === 1 ? "" : "s"} held</span>
            </>
          )}
        </p>
        {copied && <span className="tokens-hero-copied" role="status">Address copied</span>}
        {notice && !copied && <span className="tokens-hero-copied" role="status">{notice}</span>}
      </div>

      <div className="quick token-actions">
        <button type="button" className="quick-btn token-action" onClick={onSend} title="Send">
          <span className="quick-ico token-action-icon"><Icon name="send" size={18} /></span>
          Send
        </button>
        <button type="button" className="quick-btn token-action" onClick={onReceive} title="Receive">
          <span className="quick-ico token-action-icon"><Icon name="receive" size={18} /></span>
          Receive
        </button>
        <button type="button" className="quick-btn token-action" onClick={onAddAccount} title="Add account">
          <span className="quick-ico token-action-icon"><Icon name="plus" size={18} /></span>
          Add
        </button>
      </div>

      <div className="section-title">
        <h2>Tokens</h2>
        <button className="icon sm" onClick={onRefreshBalances} disabled={balancesLoading} title="Refresh balances"><Icon name="refresh" size={16} /></button>
      </div>
      <AssetsPanel state={state} balancesLoading={balancesLoading} />
    </section>
  );
}
