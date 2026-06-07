import { useState } from "react";
import type { PopupState, PopupSummaryState } from "../sdk/view-types";
import { walletClient } from "./api";
import { Header } from "./common";
import { Icon } from "./Icon";
import type { PopupActionRunner } from "./usePopupState";

export function Unlock({ busy, error, onState, run }: {
  busy: boolean;
  error: string;
  onState: (state: PopupSummaryState | PopupState) => void;
  run: PopupActionRunner;
}) {
  const [password, setPassword] = useState("");

  async function unlock() {
    const next = await run(() => walletClient.unlock(password));
    if (next) onState(next);
  }

  return (
    <main className="shell compact wlt">
      <div className="shell-body auth-body auth-screen unlock-screen">
        <Header title="Wallet locked" subtitle="Unlock the selected local wallet vault." />
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-block" disabled={busy || !password} onClick={unlock}>
          <Icon name="unlock" size={16} />
          Unlock
        </button>
      </div>
    </main>
  );
}
