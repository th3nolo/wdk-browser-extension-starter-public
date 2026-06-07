import { useState } from "react";
import type {
  DappSignatureVerificationEvidence,
  DappTransactionVerificationEvidence
} from "../sdk/view-types";
import { Icon } from "./Icon";

type VerificationEvidence = DappSignatureVerificationEvidence | DappTransactionVerificationEvidence;

export function VerificationEvidenceBlock({ evidence }: { evidence?: VerificationEvidence }) {
  if (!evidence) return null;
  return (
    <section className="verification-evidence" aria-label="Verification details">
      <div className="verification-evidence-header">
        <h3>Verification details</h3>
        <span className={evidence.verifiedByVectors ? "verification-badge verified" : "verification-badge unverified"}>
          {evidence.verifiedByVectors ? "Vector verified" : "Unverified"}
        </span>
      </div>
      <p className="verification-note">
        Compare these digests on a second device before approving high-value requests.
      </p>
      <dl className="verification-digest-list">
        {evidenceRows(evidence).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              {row.digest ? (
                <DigestValue label={row.label} value={row.digest} />
              ) : (
                <span>{row.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DigestValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copyDigest() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <div className="verification-digest-value">
      <code title={value}>{middleTruncate(value)}</code>
      <button
        type="button"
        className="copy-digest-button"
        onClick={() => void copyDigest()}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        <Icon name="copy" size={14} />
      </button>
      <details>
        <summary>Full digest</summary>
        <code>{value}</code>
      </details>
      {copied ? <span className="copy-digest-status" role="status">Copied</span> : null}
    </div>
  );
}

function evidenceRows(evidence: VerificationEvidence): Array<{ label: string; digest?: string; value?: string }> {
  if (evidence.kind === "eth_sendTransaction") {
    return [
      { label: "Request digest", digest: evidence.requestDigest },
      evidence.calldataDigest
        ? { label: "Calldata digest", digest: evidence.calldataDigest }
        : { label: "Calldata digest", value: "No calldata" },
      { label: "Target", value: evidence.target },
      { label: "Data length", value: `${evidence.dataByteLength} bytes` }
    ];
  }
  if (evidence.kind === "personal_sign") {
    return [
      { label: "Message digest", digest: evidence.messageDigest },
      { label: "Request digest", digest: evidence.requestDigest },
      { label: "Message bytes", value: `${evidence.messageByteLength} bytes (${evidence.messageEncoding})` }
    ];
  }
  return [
    { label: "EIP-712 digest", digest: evidence.finalDigest },
    { label: "Domain separator", digest: evidence.domainSeparator },
    { label: "Message hash", digest: evidence.messageHash },
    { label: "Request digest", digest: evidence.requestDigest },
    { label: "Primary type", value: evidence.primaryType }
  ];
}

function middleTruncate(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}
