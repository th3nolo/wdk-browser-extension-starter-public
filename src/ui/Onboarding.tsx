import type { PopupState, PopupSummaryState } from "../sdk/view-types";
import { WalletForm } from "./common";
import type { PopupActionRunner } from "./usePopupState";

export function Onboarding({ busy, error, onState, run }: {
  busy: boolean;
  error: string;
  onState: (state: PopupSummaryState | PopupState) => void;
  run: PopupActionRunner;
}) {
  return (
    <main className="shell wlt">
      <div className="shell-body auth-body auth-screen">
        <WalletForm title="WDK Wallet" subtitle="Create or recover a local self-custodial vault." defaultName="Primary wallet" busy={busy} error={error} onState={onState} run={run} />
      </div>
    </main>
  );
}
