import { useEffect, useState } from "react";
import {
  CHAINS,
  isValidRpcOverrideUrl,
  type ChainId,
  type PopupState,
  type PopupSummaryState
} from "../../sdk/view-types";
import { walletClient } from "../api";
import { Banner } from "../common";
import { Icon } from "../Icon";
import type { PopupActionRunner } from "../usePopupState";

export function RpcOverridesPanel({ state, busy, run, onState }: {
  state: PopupState;
  busy: boolean;
  run: PopupActionRunner;
  onState: (state: PopupSummaryState | PopupState) => void;
}) {
  const [chain, setChain] = useState<ChainId>("ethereum");
  const [url, setUrl] = useState(state.rpcOverrides?.ethereum ?? "");
  const override = state.rpcOverrides?.[chain] ?? "";
  const chainLabel = CHAINS.find((entry) => entry.id === chain)?.label ?? chain;
  const valid = !url || isValidRpcOverrideUrl(url);

  useEffect(() => {
    setUrl(state.rpcOverrides?.[chain] ?? "");
  }, [chain, state.rpcOverrides]);

  async function saveOverride() {
    if (url && !valid) return;
    const next = await run(() => walletClient.setRpcOverride(chain, url || undefined));
    if (next) onState(next);
  }

  async function clearOverride() {
    setUrl("");
    const next = await run(() => walletClient.setRpcOverride(chain, undefined));
    if (next) onState(next);
  }

  return (
    <section className="stack">
      <div className="section-title">
        <h2>RPC overrides</h2>
      </div>
      <label>
        Network
        <select value={chain} onChange={(event) => setChain(event.target.value as ChainId)}>
          {CHAINS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
      </label>
      <label>
        RPC endpoint
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value.trim())}
          placeholder="https://rpc.example"
        />
      </label>
      {!valid && <p className="error">RPC URL must be a valid https endpoint or local dev URL</p>}
      <article className="row-card">
        <span>{chainLabel}</span>
        <code className="mono">{override || "Default RPC"}</code>
      </article>
      <Banner kind="info">Use only endpoints you trust. The chain ID must match the selected network or requests are rejected.</Banner>
      <div className="actions split-actions">
        <button className="secondary" type="button" disabled={busy || !override} onClick={clearOverride}>
          <Icon name="refresh" size={16} />
          Clear
        </button>
        <button type="button" disabled={busy || !valid} onClick={saveOverride}>
          <Icon name="download" size={16} />
          Save RPC
        </button>
      </div>
    </section>
  );
}
