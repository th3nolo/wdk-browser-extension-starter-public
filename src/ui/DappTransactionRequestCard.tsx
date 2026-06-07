import {
  CHAIN_BY_ID,
  EVM_TRANSFER_MAX_FEE_WEI,
  formatDappTransactionValue,
  type DappTransactionRequest,
  type DappTransactionReview
} from "../sdk/view-types";
import { Banner } from "./common";
import { Icon } from "./Icon";
import { VerificationEvidenceBlock } from "./VerificationEvidenceBlock";

function formatValue(value: string): string {
  try {
    return formatDappTransactionValue(BigInt(value));
  } catch {
    return value;
  }
}

export function DappTransactionRequestCard({
  request,
  busy,
  onApprove,
  onReject
}: {
  request: DappTransactionRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const chain = CHAIN_BY_ID[request.chain];
  const review = request.review;

  return (
    <article key={request.id} className="approval approval-card signature-request-card">
      <div className="approval-head approval-card-header">
        <span className="approval-kind">Transaction request</span>
        <span className="origin-pill">{hostFromOrigin(request.origin)}</span>
      </div>
      <div className="signature-request-body">
        <h2 className="approval-title">{review.title}</h2>
        <p className="signature-origin-banner" role="status">
          Transaction request from <strong>{request.origin}</strong>
        </p>
        <p className="signature-phishing-warning">
          Only approve if you trust this site. Unknown contract calldata and custom dApp gas settings are blocked;
          decoded contract requests must pass RPC gas estimation and simulation first.
        </p>
        <p className="muted signature-request-meta">
          Account {request.accountIndex + 1} · Requested {new Date(request.requestedAt).toLocaleString()}
        </p>
        <dl className="dl send-confirm-list">
          <div className="dl-row"><dt>Network</dt><dd className="mono">{chain.label}</dd></div>
          {reviewRows(review, chain.nativeAsset).map((row) => (
            <div className="dl-row" key={row.label}><dt>{row.label}</dt><dd className="mono">{row.value}</dd></div>
          ))}
          {request.data ? <div className="dl-row"><dt>Calldata</dt><dd className="mono">{request.data}</dd></div> : null}
          {request.gasLimit ? <div className="dl-row"><dt>Gas estimate</dt><dd className="mono">{request.gasLimit}</dd></div> : null}
          {feeEstimateRows(review, chain.nativeAsset).map((row) => (
            <div className="dl-row" key={row.label}><dt>{row.label}</dt><dd className="mono">{row.value}</dd></div>
          ))}
          <div className="dl-row"><dt>Fee reserve</dt><dd className="mono">{formatDappTransactionValue(EVM_TRANSFER_MAX_FEE_WEI)} {chain.nativeAsset}</dd></div>
          <div className="dl-row"><dt>Simulation</dt><dd className="mono">{simulationText(review)}</dd></div>
          {review.simulation.rpcEvidence ? <div className="dl-row"><dt>RPC data</dt><dd className="mono">{simulationEvidenceText(review)}</dd></div> : null}
          {review.simulation.warning ? <div className="dl-row"><dt>Simulation warning</dt><dd className="mono">{review.simulation.warning}</dd></div> : null}
        </dl>
        {review.simulation.status === "passed" && (
          <Banner kind="good" icon="checkCircle"><strong>RPC preflight passed</strong> — gas estimate and simulation succeeded.</Banner>
        )}
        <VerificationEvidenceBlock evidence={request.verification} />
      </div>
      <div className="approval-actions approval-action-row">
        <button className="secondary" disabled={busy} onClick={onReject} title="Reject transaction">
          <Icon name="x" size={16} />
          Reject
        </button>
        <button disabled={busy} onClick={onApprove} title="Approve transaction">
          <Icon name="shield" size={16} />
          Send
        </button>
      </div>
    </article>
  );
}

function reviewRows(review: DappTransactionReview, nativeAsset: string): Array<{ label: string; value: string }> {
  switch (review.kind) {
    case "native-transfer":
      return [
        { label: "To", value: review.to },
        { label: "Amount", value: `${formatValue(review.value)} ${nativeAsset}` },
        { label: "Recipient", value: "Externally owned account verified by RPC" }
      ];
    case "erc20-transfer":
      return compactRows([
        { label: "Token contract", value: review.token },
        ...tokenMetadataRows(review.tokenMetadata),
        { label: "Recipient", value: review.recipient },
        { label: "Amount", value: `${review.amount} raw token units` },
        ...warningRows(review.warnings)
      ]);
    case "erc20-approval":
      return compactRows([
        { label: "Token contract", value: review.token },
        ...tokenMetadataRows(review.tokenMetadata),
        { label: "Spender", value: review.spender },
        { label: "Current allowance", value: review.currentAllowance ? `${review.currentAllowance} raw token units` : undefined },
        { label: "Allowance change", value: review.allowanceDelta ? formatAllowanceDelta(review.allowanceDelta) : undefined },
        { label: "Allowance", value: review.unlimited ? "Unlimited approval" : `${review.amount} raw token units` },
        ...warningRows(review.warnings)
      ]);
    case "swap":
      return compactRows([
        { label: "Protocol", value: review.protocol },
        { label: "Router", value: review.router },
        { label: "Token in", value: review.tokenIn },
        { label: "Token out", value: review.tokenOut },
        { label: "Amount in", value: review.amountIn ? `${review.amountIn} raw token units` : undefined },
        { label: "Amount out", value: review.amountOut ? `${review.amountOut} raw token units` : undefined },
        { label: "Min output", value: review.minAmountOut ? `${review.minAmountOut} raw token units` : undefined },
        { label: "Max input", value: review.maxAmountIn ? `${review.maxAmountIn} raw token units` : undefined },
        { label: "Recipient", value: review.recipient },
        { label: "Native value", value: `${formatValue(review.nativeValue)} ${nativeAsset}` }
      ]);
    case "aave-action":
      return compactRows([
        { label: "Action", value: review.action },
        { label: "Pool", value: review.pool },
        { label: "Asset", value: review.asset },
        { label: "Amount", value: `${review.amount} raw token units` },
        { label: review.action === "withdraw" ? "Recipient" : "Beneficiary", value: review.beneficiary },
        { label: "Interest mode", value: review.interestRateMode }
      ]);
    case "bridge":
      return [
        { label: "Protocol", value: review.protocol },
        { label: "Bridge", value: review.bridge },
        { label: "Target chain", value: review.targetChain },
        { label: "Recipient", value: review.recipient },
        { label: "Amount", value: `${review.amount} raw token units` },
        { label: "Min amount", value: `${review.minAmount} raw token units` },
        { label: "Native fee", value: `${formatValue(review.nativeValue)} ${nativeAsset}` }
      ];
    case "safe-execution":
      return [
        { label: "Safe", value: review.safe },
        { label: "Target", value: review.target },
        { label: "Value", value: `${formatValue(review.value)} ${nativeAsset}` },
        { label: "Operation", value: review.operation },
        { label: "Payload", value: `${review.payloadBytes} bytes` }
      ];
  }
}

function compactRows(rows: Array<{ label: string; value?: string }>): Array<{ label: string; value: string }> {
  return rows.flatMap((row) => row.value ? [{ label: row.label, value: row.value }] : []);
}

function tokenMetadataRows(metadata: Extract<DappTransactionReview, { kind: "erc20-transfer" }>["tokenMetadata"]): Array<{ label: string; value?: string }> {
  if (!metadata) return [];
  return [
    { label: "Token symbol", value: metadata.symbol },
    { label: "Token name", value: metadata.name },
    { label: "Token decimals", value: metadata.decimals === undefined ? undefined : String(metadata.decimals) }
  ];
}

function warningRows(warnings: string[] | undefined): Array<{ label: string; value?: string }> {
  return warnings?.length ? [{ label: "Warnings", value: warnings.join("; ") }] : [];
}

function formatAllowanceDelta(value: string): string {
  if (value === "0") return "No change";
  if (value.startsWith("-")) return `${value} raw token units`;
  return `+${value} raw token units`;
}

function feeEstimateRows(review: DappTransactionReview, nativeAsset: string): Array<{ label: string; value: string }> {
  const estimate = review.feeEstimate;
  if (!estimate) return [];
  return compactRows([
    { label: "Max fee estimate", value: `${formatValue(estimate.maxNativeFee)} ${nativeAsset}` },
    { label: "Fee pricing", value: feePricingText(estimate) },
    { label: "Fee source", value: estimate.source },
    { label: "Fee warning", value: estimate.warning }
  ]);
}

function feePricingText(estimate: NonNullable<DappTransactionReview["feeEstimate"]>): string {
  if (estimate.type === "eip1559") {
    return `max ${formatGwei(estimate.maxFeePerGas)} gwei; priority ${formatGwei(estimate.maxPriorityFeePerGas)} gwei`;
  }
  return `${formatGwei(estimate.gasPrice)} gwei`;
}

function formatGwei(value: string | undefined): string {
  if (!value) return "unknown";
  try {
    const wei = BigInt(value);
    const whole = wei / 1_000_000_000n;
    const fraction = wei % 1_000_000_000n;
    if (fraction === 0n) return whole.toString();
    return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
  } catch {
    return value;
  }
}

function simulationText(review: DappTransactionReview): string {
  if (review.simulation.status === "passed") return "RPC preflight passed";
  if (review.simulation.status === "failed") return review.simulation.message ?? "RPC preflight failed";
  return review.simulation.message ?? "Not available";
}

function simulationEvidenceText(review: DappTransactionReview): string {
  const evidence = review.simulation.rpcEvidence;
  if (!evidence) return "";
  return `${evidence.gasEstimateMethod} + ${evidence.simulationMethod} at ${evidence.blockTag}`;
}

function hostFromOrigin(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
