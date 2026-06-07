import {
  PERSONAL_SIGN_HEX_NOTICE,
  SIGNATURE_PHISHING_WARNING,
  formatMessageByteCount,
  formatTypedDataDomain,
  formatTypedDataMessagePreview,
  isTypedDataSignatureKind,
  looksLikeEip712PersonalSign,
  personalSignEncodingLabel,
  signatureMessageScrollHint,
  typedDataEncodingLabel,
  type DappSignatureRequest
} from "../sdk/view-types";
import { Icon } from "./Icon";
import { VerificationEvidenceBlock } from "./VerificationEvidenceBlock";

export function SignatureRequestCard({
  request,
  busy,
  onApprove,
  onReject
}: {
  request: DappSignatureRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isTypedData = isTypedDataSignatureKind(request.kind) && request.typedData;
  const displayText = request.displayMessage ?? request.message;
  const eip712Like = !isTypedData && looksLikeEip712PersonalSign(displayText);
  const scrollHint = signatureMessageScrollHint(request.messageByteLength);
  const preview = isTypedData && request.typedData
    ? formatTypedDataMessagePreview(request.typedData)
    : displayText;

  return (
    <article key={request.id} className="approval approval-card signature-request-card">
      <div className="approval-head approval-card-header">
        <span className="approval-kind">{isTypedData ? "Typed-data signature" : "Signature request"}</span>
        <span className="origin-pill">{hostFromOrigin(request.origin)}</span>
      </div>
      <div className="signature-request-body">
        <h2 className="approval-title">{isTypedData ? "Review typed data" : "Review signature"}</h2>
        <p className="signature-origin-banner" role="status">
          You are signing on <strong>{request.origin}</strong>
        </p>
        <p className="signature-phishing-warning">{SIGNATURE_PHISHING_WARNING}</p>
        <p className="muted signature-request-meta">
          Account {request.accountIndex + 1} · Requested {new Date(request.requestedAt).toLocaleString()}
        </p>
        <div className="signature-message-header">
          <span className="signature-encoding-badge">
            {isTypedData ? typedDataEncodingLabel() : personalSignEncodingLabel(request.messageEncoding)}
          </span>
          <span className="muted signature-byte-count">{formatMessageByteCount(request.messageByteLength)}</span>
        </div>
        {isTypedData && request.typedData && (
          <>
            <p className="signature-typed-domain" role="note">
              <strong>{request.typedData.primaryType}</strong> · {formatTypedDataDomain(request.typedData)}
            </p>
            <p className="muted signature-scroll-hint">Review every field below before approving typed data.</p>
          </>
        )}
        {!isTypedData && request.messageEncoding === "hex" && (
          <p className="signature-hex-notice" role="note">
            {PERSONAL_SIGN_HEX_NOTICE}
          </p>
        )}
        {!isTypedData && eip712Like && (
          <p className="signature-eip712-notice" role="note">
            This payload looks like EIP-712 typed data sent through personal_sign. Prefer eth_signTypedData when the
            dApp supports it, and read the JSON below carefully before approving.
          </p>
        )}
        {scrollHint && <p className="muted signature-scroll-hint">{scrollHint}</p>}
        <pre className="message-preview signature-message-preview">{preview}</pre>
        <VerificationEvidenceBlock evidence={request.verification} />
      </div>
      <div className="approval-actions approval-action-row">
        <button className="secondary" disabled={busy} onClick={onReject} title="Reject signature">
          <Icon name="x" size={16} />
          Reject
        </button>
        <button disabled={busy} onClick={onApprove} title="Approve signature">
          <Icon name="shield" size={16} />
          Sign
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
