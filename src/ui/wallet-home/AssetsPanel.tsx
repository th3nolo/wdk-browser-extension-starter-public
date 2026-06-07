import { useState } from "react";
import {
  formatBaseUnitsForDisplay,
  groupBalancesByAsset,
  isMultiChainAsset,
  type PopupState
} from "../../sdk/view-types";
import { Avatar, Coin, chainLabel, isNonZeroAmount, shortAddress } from "../common";
import { Icon } from "../Icon";

export function AssetsPanel({ state, balancesLoading }: {
  state: PopupState;
  balancesLoading: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const groups = groupBalancesByAsset(state.balances);
  const heldGroups = groups.filter((group) => isNonZeroAmount(group.totalAmount));
  const hasZeroGroups = heldGroups.length !== groups.length;
  // Default to held tokens only; a brand-new (all-zero) wallet still shows everything.
  const visibleGroups = showAllTokens || heldGroups.length === 0 ? groups : heldGroups;
  const toggle = (asset: string) => setExpanded((current) => ({ ...current, [asset]: !current[asset] }));

  return (
    <div className="stack">
      {balancesLoading && !groups.length && <p className="muted">Loading balances...</p>}
      {!balancesLoading && !groups.length && (
        <div className="empty-state">
          <p className="muted">No token balances yet. They appear here once your accounts receive funds.</p>
        </div>
      )}
      {visibleGroups.map((group) => {
        const multiChain = isMultiChainAsset(group);
        const open = Boolean(expanded[group.asset]);
        return (
          <div key={group.asset} className={`asset-group${open ? " open" : ""}`}>
            <button
              type="button"
              className="asset-head asset-group-row"
              onClick={() => multiChain && toggle(group.asset)}
              disabled={!multiChain}
              aria-expanded={multiChain ? open : undefined}
            >
              <span className="row-lead asset-group-lead">
                <Coin sym={group.symbol} size={32} />
                <span className="row-id asset-group-id">
                  <strong>{group.symbol}</strong>
                  <span className="faint asset-group-chains">
                    {multiChain ? `${group.chains.length} networks` : chainLabel(group.chains[0].chain)}
                  </span>
                </span>
              </span>
              <span className="row-amt asset-group-amount">
                <strong>{formatBaseUnitsForDisplay(group.totalAmount, group.decimals)}</strong>
                {multiChain && <Icon name={open ? "chevronDown" : "chevronRight"} size={15} />}
              </span>
            </button>
            {multiChain && open && (
              <div className="asset-break asset-group-breakdown">
                {group.chains.map((entry) => (
                  <div key={entry.chain} className="break-row asset-breakdown-row">
                    <span>{chainLabel(entry.chain)}</span>
                    <span className="num">{formatBaseUnitsForDisplay(entry.amount, group.decimals)} {group.symbol}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {hasZeroGroups && heldGroups.length > 0 && (
        <button type="button" className="list-toggle" onClick={() => setShowAllTokens((open) => !open)}>
          {showAllTokens ? "Hide zero balances" : `Show all ${groups.length} tokens`}
        </button>
      )}

      <div className="section-title">
        <h2>Accounts</h2>
        <button
          type="button"
          className="icon sm"
          onClick={() => setAccountsOpen((open) => !open)}
          aria-expanded={accountsOpen}
          title={accountsOpen ? "Hide accounts" : "Show accounts"}
        >
          <Icon name={accountsOpen ? "chevronDown" : "chevronRight"} size={16} />
        </button>
      </div>
      <div className="account-grid" hidden={!accountsOpen}>
        {state.accounts.map((account) => (
          <article key={`${account.walletId}-${account.chain}-${account.index}`} className="row-card account-row">
            <span className="row-lead account-row-lead">
              <Avatar seed={account.address} label={String(account.index + 1)} size={30} />
              <span className="row-id"><strong>{chainLabel(account.chain)} #{account.index + 1}</strong></span>
            </span>
            <code className="mono">{shortAddress(account.address)}</code>
          </article>
        ))}
      </div>
    </div>
  );
}
