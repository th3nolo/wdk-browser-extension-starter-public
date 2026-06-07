import { exposedAccountIndexes, type PopupState } from "../../sdk/view-types";
import { DappConnectionRequestCard } from "../DappConnectionRequestCard";
import { DappTransactionRequestCard } from "../DappTransactionRequestCard";
import { Icon } from "../Icon";
import { SignatureRequestCard } from "../SignatureRequestCard";

export function ConnectedSitesPanel({ state, busy, onApproveConnection, onRejectConnection, onRevokeConnection, onSignature, onTransaction }: {
  state: PopupState;
  busy: boolean;
  onApproveConnection: (origin: string, accountIndexes: number[]) => Promise<void>;
  onRejectConnection: (origin: string) => Promise<void>;
  onRevokeConnection: (origin: string) => Promise<void>;
  onSignature: (type: "APPROVE_SIGNATURE" | "REJECT_SIGNATURE", id: string) => Promise<void>;
  onTransaction: (type: "APPROVE_DAPP_TRANSACTION" | "REJECT_DAPP_TRANSACTION", id: string) => Promise<void>;
}) {
  const pendingRequestCount = state.pendingConnections.length + state.pendingSignatures.length + state.pendingTransactions.length;

  return (
    <section className={`stack${pendingRequestCount > 0 ? " approval-workflow" : ""}`}>
      {pendingRequestCount > 0 && (
        <div className="approval-hero">
          <span className="approval-kind">Wallet confirmation</span>
          <h2>Review this request carefully</h2>
          <p>Only approve requests from sites you trust. The dApp can continue after this popup sends your decision.</p>
        </div>
      )}
      {pendingRequestCount > 0 ? (
        <>
          {state.pendingConnections.map((request) => (
            <DappConnectionRequestCard
              key={`${request.walletId}-${request.origin}`}
              request={request}
              accounts={state.accounts}
              busy={busy}
              onApprove={(accountIndexes) => onApproveConnection(request.origin, accountIndexes)}
              onReject={() => onRejectConnection(request.origin)}
            />
          ))}
          {state.pendingSignatures.map((request) => (
            <SignatureRequestCard
              key={request.id}
              request={request}
              busy={busy}
              onApprove={() => onSignature("APPROVE_SIGNATURE", request.id)}
              onReject={() => onSignature("REJECT_SIGNATURE", request.id)}
            />
          ))}
          {state.pendingTransactions.map((request) => (
            <DappTransactionRequestCard
              key={request.id}
              request={request}
              busy={busy}
              onApprove={() => onTransaction("APPROVE_DAPP_TRANSACTION", request.id)}
              onReject={() => onTransaction("REJECT_DAPP_TRANSACTION", request.id)}
            />
          ))}
        </>
      ) : (
        <>
          <div className="section-title"><h2>Pending requests</h2></div>
          <p className="muted">No pending site requests.</p>
          <div className="section-title"><h2>Signature requests</h2></div>
          <p className="muted">No pending signature requests.</p>
          <div className="section-title"><h2>Transaction requests</h2></div>
          <p className="muted">No pending transaction requests.</p>
          <div className="section-title"><h2>Connected sites</h2></div>
          {!state.connectedSites.length && (
            <div className="empty empty-state">
              <Icon name="globe" size={20} style={{ color: "var(--muted)" }} />
              <p className="muted">No connected sites.</p>
            </div>
          )}
          {state.connectedSites.map((site) => {
            const indexes = exposedAccountIndexes(site);
            const accountsLabel = indexes.map((index) => `Account ${index + 1}`).join(", ");
            return (
              <article key={`${site.walletId}-${site.origin}`} className="row-card site-card">
                <div className="row-lead">
                  <span className="coin" aria-hidden="true" style={{ background: "var(--surface-strong)", color: "var(--muted)" }}><Icon name="globe" size={16} /></span>
                  <div className="row-id">
                    <strong>{site.origin}</strong>
                    <p>{accountsLabel} - Chain {site.evmChainId} - Last used {new Date(site.lastUsedAt).toLocaleString()}</p>
                  </div>
                </div>
                <button className="icon sm danger" disabled={busy} onClick={() => onRevokeConnection(site.origin)} title="Disconnect site"><Icon name="trash" size={16} /></button>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
