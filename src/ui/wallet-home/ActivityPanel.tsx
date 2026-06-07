import { useMemo, useState } from "react";
import { CHAINS, type ChainId, type PopupState, type TransactionStatus } from "../../sdk/view-types";
import { StatusPill, chainLabel, shortAddress } from "../common";
import { Icon } from "../Icon";

function statusKind(status: string): "ok" | "pending" | "fail" {
  if (status === "confirmed") return "ok";
  if (status === "failed" || status === "dropped") return "fail";
  return "pending";
}

function directionIcon(status: string): string {
  if (status === "confirmed") return "receive";
  if (status === "failed" || status === "dropped") return "x";
  return "send";
}

export function ActivityPanel({ state }: { state: PopupState }) {
  const [status, setStatus] = useState<"all" | TransactionStatus>("all");
  const [chain, setChain] = useState<"all" | ChainId>("all");
  const [query, setQuery] = useState("");
  const transactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return state.transactions.filter((tx) => {
      if (status !== "all" && tx.status !== status) return false;
      if (chain !== "all" && tx.chain !== chain) return false;
      if (!normalizedQuery) return true;
      return [tx.asset, tx.status, tx.txHash, tx.from, tx.to, tx.amount]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [chain, query, state.transactions, status]);

  if (!state.transactions.length) return <p className="muted">No transactions yet.</p>;

  return (
    <section className="stack">
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as "all" | TransactionStatus)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
            <option value="dropped">Dropped</option>
          </select>
        </label>
        <label>
          Network
          <select value={chain} onChange={(event) => setChain(event.target.value as "all" | ChainId)}>
            <option value="all">All</option>
            {CHAINS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
      </div>
      <label>
        Search
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hash, address, asset" />
      </label>
      {!transactions.length && <p className="muted">No transactions match the current filters.</p>}
      {transactions.map((tx) => (
        <article key={tx.id} className="row-card">
          <div className="row-lead">
            <span className="quick-ico" aria-hidden="true"><Icon name={directionIcon(tx.status)} size={16} /></span>
            <div className="row-id">
              <strong>{tx.asset} on {chainLabel(tx.chain)}</strong>
              <p>{tx.status} - {new Date(tx.updatedAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="row-amt">
            <code className="mono">{tx.txHash ? shortAddress(tx.txHash) : shortAddress(tx.to)}</code>
            <div><StatusPill status={statusKind(tx.status)} /></div>
          </div>
        </article>
      ))}
    </section>
  );
}
