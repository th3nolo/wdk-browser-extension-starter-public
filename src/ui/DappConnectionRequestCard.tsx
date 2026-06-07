import { useEffect, useMemo, useState } from "react";
import type { AccountRecord, DappConnectionRequest } from "../sdk/view-types";
import { Banner, shortAddress } from "./common";
import { Icon } from "./Icon";

export function DappConnectionRequestCard({
  request,
  accounts,
  busy,
  onApprove,
  onReject
}: {
  request: DappConnectionRequest;
  accounts: AccountRecord[];
  busy: boolean;
  onApprove: (accountIndexes: number[]) => void;
  onReject: () => void;
}) {
  const ethAccounts = useMemo(
    () => accounts
      .filter((account) => account.walletId === request.walletId && account.chain === "ethereum")
      .sort((left, right) => left.index - right.index),
    [accounts, request.walletId]
  );
  const accountIndices = useMemo(
    () => [...new Set(ethAccounts.map((account) => account.index))],
    [ethAccounts]
  );
  const addressByIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const account of ethAccounts) {
      if (!map.has(account.index)) map.set(account.index, account.address);
    }
    return map;
  }, [ethAccounts]);

  // Default the first/active account checked. Keep selection in sync as the
  // available accounts change (e.g. when switching wallets behind the request).
  const [selected, setSelected] = useState<number[]>(() =>
    accountIndices.length ? [accountIndices[0]] : []
  );
  useEffect(() => {
    setSelected((current) => {
      const filtered = current.filter((index) => accountIndices.includes(index));
      if (filtered.length) return filtered;
      return accountIndices.length ? [accountIndices[0]] : [];
    });
  }, [accountIndices]);

  function toggle(index: number) {
    setSelected((current) =>
      current.includes(index)
        ? current.filter((entry) => entry !== index)
        : [...current, index].sort((left, right) => left - right)
    );
  }

  const orderedSelection = useMemo(
    () => accountIndices.filter((index) => selected.includes(index)),
    [accountIndices, selected]
  );
  const canApprove = orderedSelection.length > 0;

  return (
    <article className="approval approval-card connection-request-card">
      <div className="approval-head approval-card-header">
        <span className="approval-kind">Connection request</span>
        <span className="origin-pill">{hostFromOrigin(request.origin)}</span>
      </div>
      <div className="connection-request-body">
        <h2 className="approval-title">Connect this site?</h2>
        <p className="muted approval-subtitle">{request.origin}</p>
        <Banner kind="warn">
          This site will be able to view the selected account addresses, request signatures and transaction
          approvals, and suggest supported EVM network switches.
        </Banner>
        <p className="muted">Requested {new Date(request.requestedAt).toLocaleString()}</p>
        <fieldset className="account-checklist" aria-label="Accounts to share">
          <legend>Accounts to share</legend>
          {accountIndices.length === 0 && <p className="muted">No Ethereum accounts available.</p>}
          {accountIndices.map((index) => {
            const checked = selected.includes(index);
            const address = addressByIndex.get(index);
            return (
              <label key={index} className={`account-check-row${checked ? " checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => toggle(index)}
                />
                <span className="account-check-avatar" aria-hidden="true">{index + 1}</span>
                <span className="account-check-text">
                  <strong>Account {index + 1}</strong>
                  {address && <code className="mono">{shortAddress(address)}</code>}
                </span>
              </label>
            );
          })}
        </fieldset>
      </div>
      <div className="approval-actions approval-action-row">
        <button className="secondary" disabled={busy} onClick={onReject} title="Reject site">
          <Icon name="x" size={16} />
          Reject
        </button>
        <button
          disabled={busy || !canApprove}
          onClick={() => canApprove && onApprove(orderedSelection)}
          title="Approve site"
        >
          <Icon name="shield" size={16} />
          Connect
        </button>
      </div>
    </article>
  );
}

function hostFromOrigin(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
