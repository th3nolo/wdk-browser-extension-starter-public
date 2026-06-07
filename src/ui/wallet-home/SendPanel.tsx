import { useEffect, useMemo, useState } from "react";
import {
  CHAINS,
  previewSendRequest,
  supportedAssetsForChain,
  type AssetId,
  type ChainId,
  type PopupState,
  type PopupSummaryState
} from "../../sdk/view-types";
import { walletClient } from "../api";
import { Banner, chainLabel, shortAddress } from "../common";
import { Icon } from "../Icon";
import type { PopupActionRunner } from "../usePopupState";

export function SendPanel({ state, busy, run, onState }: {
  state: PopupState;
  busy: boolean;
  run: PopupActionRunner;
  onState: (state: PopupSummaryState | PopupState) => void;
}) {
  const [chain, setChain] = useState<ChainId>("ethereum");
  const [asset, setAsset] = useState<AssetId>("ETH");
  const [accountIndex, setAccountIndex] = useState(0);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const activeWalletId = state.activeWalletId ?? state.wallets[0]?.id;
  const supportedAssets = useMemo(() => supportedAssetsForChain(chain), [chain]);
  const selectedAccount = state.accounts.find((account) => account.chain === chain && account.index === accountIndex);
  const preview = previewSendRequest({ walletId: activeWalletId, account: selectedAccount, chain, asset, accountIndex, to, amount });
  const assetSupported = preview.assetSupported;
  const valid = preview.canReview;

  useEffect(() => {
    if (!supportedAssets.includes(asset)) setAsset(supportedAssets[0]);
  }, [asset, supportedAssets]);

  useEffect(() => {
    setReviewing(false);
  }, [accountIndex, amount, asset, chain, to]);

  // Pick up an address scanned in the standalone scanner window.
  useEffect(() => {
    let cancelled = false;
    void walletClient.takePendingScan().then((value) => {
      if (!cancelled && value) setTo(extractAddress(value));
    });
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    const request = preview.request;
    if (!request || !valid) return;
    const next = await run(() => walletClient.send(request));
    if (next) {
      setReviewing(false);
      setTo("");
      setAmount("");
      onState(next);
    }
  }

  return (
    <section className="stack">
      <label>
        Network
        <select value={chain} onChange={(event) => setChain(event.target.value as ChainId)}>
          {CHAINS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
      </label>
      <label>
        Asset
        <select value={asset} onChange={(event) => setAsset(event.target.value as AssetId)}>
          {supportedAssets.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </label>
      <label>
        Account
        <select value={accountIndex} onChange={(event) => setAccountIndex(Number(event.target.value))}>
          {[...new Set(state.accounts.filter((account) => account.chain === chain).map((account) => account.index))].map((index) => (
            <option key={index} value={index}>Account {index + 1}</option>
          ))}
        </select>
      </label>
      <label>
        Recipient
        <div className="input-wrap input-action">
          <input className="mono" value={to} onChange={(event) => setTo(event.target.value.trim())} placeholder="Paste address" />
          <button className="icon sm" type="button" onClick={() => { void walletClient.openScanner(); }} title="Scan QR code"><Icon name="scan" size={16} /></button>
        </div>
      </label>
      <label>
        Amount
        <input className="num" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
      </label>
      {!assetSupported && <p className="error">{asset} is not configured for {chainLabel(chain)}.</p>}
      {!reviewing && (
        <button className="btn-block" disabled={busy || !valid} onClick={() => setReviewing(true)}>
          <Icon name="shield" size={16} />
          Review send
        </button>
      )}
      {reviewing && selectedAccount && (
        <div className="review-panel">
          <div className="approval-head">
            <span className="approval-kind">Confirm send</span>
            <span className="chip">{chainLabel(chain)}</span>
          </div>
          <dl>
            <div><dt>Network</dt><dd>{chainLabel(chain)}</dd></div>
            <div><dt>Asset</dt><dd>{asset}</dd></div>
            <div><dt>From</dt><dd>{shortAddress(selectedAccount.address)}</dd></div>
            <div><dt>To</dt><dd>{shortAddress(to)}</dd></div>
            <div><dt>Amount</dt><dd>{amount}</dd></div>
          </dl>
          <Banner kind="warn">Review the destination and amount carefully. Submitted transactions cannot be reversed.</Banner>
          <div className="actions split-actions approval-actions">
            <button className="secondary" type="button" onClick={() => setReviewing(false)} disabled={busy}>Cancel</button>
            <button type="button" disabled={busy || !valid} onClick={submit}>
              <Icon name="send" size={16} />
              Confirm send
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function extractAddress(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "ethereum:" || parsed.protocol === "bitcoin:" || parsed.protocol === "solana:") {
      return parsed.pathname || parsed.host;
    }
  } catch {
    // Plain addresses are expected for most QR wallet flows.
  }
  return trimmed;
}
