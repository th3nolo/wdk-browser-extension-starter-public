import type {
  ChainId,
  DappFeeEstimate,
  DappSignatureRequest,
  DappTransactionRequest,
  DappTransactionReview,
  Eip712TypedDataPayload,
  Erc20TokenMetadata,
  SimulationResult
} from "../types";
import type {
  DappApprovalOutcome,
  StoredDappApproval,
  StoredPendingApproval,
  StoredPendingDappTransaction,
  StoredPendingSignature
} from "./pending-dapp-approval-types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pruneExpired<TApproval extends StoredDappApproval>(approvals: TApproval[], now = Date.now()): TApproval[] {
  return approvals.filter((approval) => approval.expiresAt > now);
}

function parseStoredDappApprovalBase(input: unknown): StoredDappApproval | undefined {
  if (!isRecord(input)) return undefined;
  if (
    typeof input.id !== "string"
    || (input.approvalKind !== "signature" && input.approvalKind !== "transaction")
    || typeof input.walletId !== "string"
    || typeof input.dedupeKey !== "string"
    || typeof input.expiresAt !== "number"
  ) return undefined;
  return input as StoredDappApproval;
}

export function parseStoredApproval(input: unknown): StoredPendingApproval | undefined {
  const base = parseStoredDappApprovalBase(input);
  if (!base) return undefined;
  if (base.approvalKind === "signature") return parseStoredSignatureApproval(input);
  return parseStoredTransactionApproval(input);
}

export function parseStoredOutcome(input: unknown): DappApprovalOutcome | undefined {
  if (!isRecord(input) || typeof input.status !== "string") return undefined;
  if (input.status === "rejected") {
    return typeof input.message === "string" ? { status: "rejected", message: input.message } : undefined;
  }
  if (input.status !== "resolved") return undefined;
  if (input.approvalKind === "signature" && typeof input.signature === "string") {
    return { status: "resolved", approvalKind: "signature", signature: input.signature };
  }
  if (input.approvalKind === "transaction" && typeof input.txHash === "string") {
    return { status: "resolved", approvalKind: "transaction", txHash: input.txHash };
  }
  return undefined;
}

function isStoredEip712TypedData(value: unknown): value is Eip712TypedDataPayload {
  return isRecord(value)
    && isRecord(value.domain)
    && isRecord(value.types)
    && typeof value.primaryType === "string"
    && isRecord(value.message);
}

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

type StoredVerificationBase = Record<string, unknown> & {
  requestDigest: `0x${string}`;
  requestByteLength: number;
  source: "raw-dapp-request";
  verifiedByVectors: boolean;
  vectorSet: "wysiwys-v1";
};

function isVerificationBase(value: Record<string, unknown>): value is StoredVerificationBase {
  return isHex32(value.requestDigest)
    && typeof value.requestByteLength === "number"
    && Number.isInteger(value.requestByteLength)
    && value.requestByteLength >= 0
    && value.source === "raw-dapp-request"
    && typeof value.verifiedByVectors === "boolean"
    && value.vectorSet === "wysiwys-v1";
}

function parseStoredSignatureVerification(value: unknown): DappSignatureRequest["verification"] | undefined {
  if (!isRecord(value) || !isVerificationBase(value)) return undefined;
  if (value.kind === "personal_sign") {
    if (
      value.algorithm !== "eip191-personal-sign"
      || !isHex32(value.messageDigest)
      || typeof value.messageByteLength !== "number"
      || !Number.isInteger(value.messageByteLength)
      || value.messageByteLength < 0
      || (value.messageEncoding !== "utf8" && value.messageEncoding !== "hex")
    ) return undefined;
    return {
      kind: "personal_sign",
      requestDigest: value.requestDigest,
      requestByteLength: value.requestByteLength,
      messageDigest: value.messageDigest,
      messageByteLength: value.messageByteLength,
      messageEncoding: value.messageEncoding,
      source: "raw-dapp-request",
      algorithm: "eip191-personal-sign",
      verifiedByVectors: value.verifiedByVectors,
      vectorSet: "wysiwys-v1"
    };
  }
  if (value.kind === "eth_signTypedData_v3" || value.kind === "eth_signTypedData_v4") {
    if (
      value.algorithm !== "eip712"
      || !isHex32(value.finalDigest)
      || !isHex32(value.domainSeparator)
      || !isHex32(value.messageHash)
      || typeof value.primaryType !== "string"
    ) return undefined;
    return {
      kind: value.kind,
      requestDigest: value.requestDigest,
      requestByteLength: value.requestByteLength,
      finalDigest: value.finalDigest,
      domainSeparator: value.domainSeparator,
      messageHash: value.messageHash,
      primaryType: value.primaryType,
      source: "raw-dapp-request",
      algorithm: "eip712",
      verifiedByVectors: value.verifiedByVectors,
      vectorSet: "wysiwys-v1"
    };
  }
  return undefined;
}

function parseStoredTransactionVerification(value: unknown): DappTransactionRequest["verification"] | undefined {
  if (!isRecord(value) || !isVerificationBase(value)) return undefined;
  const calldataDigest = value.calldataDigest;
  if (
    value.kind !== "eth_sendTransaction"
    || value.algorithm !== "erc8213-calldata-digest"
    || (calldataDigest !== null && !isHex32(calldataDigest))
    || typeof value.target !== "string"
    || typeof value.value !== "string"
    || typeof value.dataByteLength !== "number"
    || !Number.isInteger(value.dataByteLength)
    || value.dataByteLength < 0
  ) return undefined;
  return {
    kind: "eth_sendTransaction",
    requestDigest: value.requestDigest,
    requestByteLength: value.requestByteLength,
    calldataDigest,
    target: value.target,
    value: value.value,
    dataByteLength: value.dataByteLength,
    source: "raw-dapp-request",
    algorithm: "erc8213-calldata-digest",
    verifiedByVectors: value.verifiedByVectors,
    vectorSet: "wysiwys-v1"
  };
}

function parseStoredSignatureApproval(input: unknown): StoredPendingSignature | undefined {
  const base = parseStoredDappApprovalBase(input);
  if (!base || base.approvalKind !== "signature" || !isRecord(input)) return undefined;
  const signatureKind = input.signatureKind;
  if (
    typeof input.origin !== "string"
    || typeof input.accountIndex !== "number"
    || (signatureKind !== "personal_sign" && signatureKind !== "eth_signTypedData_v3" && signatureKind !== "eth_signTypedData_v4")
    || typeof input.message !== "string"
    || typeof input.displayMessage !== "string"
    || (input.messageEncoding !== "utf8" && input.messageEncoding !== "hex")
    || typeof input.messageByteLength !== "number"
    || typeof input.requestedAt !== "string"
    || (input.typedData !== undefined && !isStoredEip712TypedData(input.typedData))
    || (input.verification !== undefined && !parseStoredSignatureVerification(input.verification))
  ) return undefined;
  const verification = input.verification === undefined ? undefined : parseStoredSignatureVerification(input.verification);
  return {
    ...base,
    approvalKind: "signature",
    origin: input.origin,
    accountIndex: input.accountIndex,
    signatureKind,
    message: input.message,
    displayMessage: input.displayMessage,
    messageEncoding: input.messageEncoding,
    messageByteLength: input.messageByteLength,
    typedData: input.typedData,
    verification,
    requestedAt: input.requestedAt
  };
}

function isStoredSimulationResult(value: unknown): value is SimulationResult {
  return isRecord(value)
    && (value.status === "passed" || value.status === "failed" || value.status === "unavailable")
    && (value.gasEstimate === undefined || typeof value.gasEstimate === "string")
    && (value.rpcEvidence === undefined || isStoredSimulationRpcEvidence(value.rpcEvidence))
    && (value.message === undefined || typeof value.message === "string")
    && (value.warning === undefined || typeof value.warning === "string");
}

function isStoredSimulationRpcEvidence(value: unknown): value is NonNullable<SimulationResult["rpcEvidence"]> {
  return isRecord(value)
    && value.gasEstimateMethod === "eth_estimateGas"
    && value.simulationMethod === "eth_call"
    && value.blockTag === "latest"
    && (value.gasEstimateHex === undefined || typeof value.gasEstimateHex === "string")
    && (value.simulationResult === undefined || typeof value.simulationResult === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseStoredDappFeeEstimate(value: unknown): DappFeeEstimate | undefined {
  if (!isRecord(value)) return undefined;
  if (
    (value.type !== "eip1559" && value.type !== "legacy")
    || typeof value.gasLimit !== "string"
    || typeof value.maxNativeFee !== "string"
    || (value.source !== "eth_feeHistory" && value.source !== "eth_gasPrice")
    || (value.maxFeePerGas !== undefined && typeof value.maxFeePerGas !== "string")
    || (value.maxPriorityFeePerGas !== undefined && typeof value.maxPriorityFeePerGas !== "string")
    || (value.gasPrice !== undefined && typeof value.gasPrice !== "string")
    || (value.warning !== undefined && typeof value.warning !== "string")
  ) return undefined;
  try {
    BigInt(value.gasLimit);
    BigInt(value.maxNativeFee);
    if (value.maxFeePerGas !== undefined) BigInt(value.maxFeePerGas);
    if (value.maxPriorityFeePerGas !== undefined) BigInt(value.maxPriorityFeePerGas);
    if (value.gasPrice !== undefined) BigInt(value.gasPrice);
  } catch {
    return undefined;
  }
  return {
    type: value.type,
    gasLimit: value.gasLimit,
    maxNativeFee: value.maxNativeFee,
    source: value.source,
    maxFeePerGas: value.maxFeePerGas,
    maxPriorityFeePerGas: value.maxPriorityFeePerGas,
    gasPrice: value.gasPrice,
    warning: value.warning
  };
}

function parseStoredErc20TokenMetadata(value: unknown): Erc20TokenMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const decimals = value.decimals;
  if (
    (value.name !== undefined && typeof value.name !== "string")
    || (value.symbol !== undefined && typeof value.symbol !== "string")
    || (decimals !== undefined && (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255))
  ) return undefined;
  return {
    name: value.name,
    symbol: value.symbol,
    decimals
  };
}

function parseStoredTransactionReview(value: unknown, to: string, valueWei: string): DappTransactionReview | undefined {
  if (!isRecord(value)) {
    if (value !== undefined) return undefined;
    return {
      kind: "native-transfer",
      title: "Native transfer",
      to,
      value: valueWei,
      simulation: {
        status: "unavailable",
        message: "Restored from an older pending transaction record",
        warning: "RPC simulation data was not stored on this older pending request."
      }
    };
  }
  if (!isStoredSimulationResult(value.simulation)) return undefined;
  const feeEstimate = value.feeEstimate === undefined ? undefined : parseStoredDappFeeEstimate(value.feeEstimate);
  if (value.feeEstimate !== undefined && !feeEstimate) return undefined;
  if (value.kind === "native-transfer") {
    if (
      value.title !== "Native transfer"
      || typeof value.to !== "string"
      || typeof value.value !== "string"
    ) return undefined;
    return {
      kind: "native-transfer",
      title: "Native transfer",
      to: value.to,
      value: value.value,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "erc20-transfer") {
    if (
      value.title !== "ERC-20 transfer"
      || typeof value.token !== "string"
      || (value.tokenMetadata !== undefined && !parseStoredErc20TokenMetadata(value.tokenMetadata))
      || typeof value.recipient !== "string"
      || typeof value.amount !== "string"
      || typeof value.rawData !== "string"
      || (value.warnings !== undefined && !isStringArray(value.warnings))
    ) return undefined;
    const tokenMetadata = value.tokenMetadata === undefined ? undefined : parseStoredErc20TokenMetadata(value.tokenMetadata);
    return {
      kind: "erc20-transfer",
      title: "ERC-20 transfer",
      token: value.token,
      tokenMetadata,
      recipient: value.recipient,
      amount: value.amount,
      rawData: value.rawData,
      warnings: value.warnings,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "erc20-approval") {
    if (
      value.title !== "ERC-20 approval"
      || typeof value.token !== "string"
      || (value.tokenMetadata !== undefined && !parseStoredErc20TokenMetadata(value.tokenMetadata))
      || typeof value.spender !== "string"
      || typeof value.amount !== "string"
      || (value.currentAllowance !== undefined && typeof value.currentAllowance !== "string")
      || (value.allowanceDelta !== undefined && typeof value.allowanceDelta !== "string")
      || typeof value.unlimited !== "boolean"
      || typeof value.rawData !== "string"
      || (value.warnings !== undefined && !isStringArray(value.warnings))
    ) return undefined;
    const tokenMetadata = value.tokenMetadata === undefined ? undefined : parseStoredErc20TokenMetadata(value.tokenMetadata);
    return {
      kind: "erc20-approval",
      title: "ERC-20 approval",
      token: value.token,
      tokenMetadata,
      spender: value.spender,
      amount: value.amount,
      currentAllowance: value.currentAllowance,
      allowanceDelta: value.allowanceDelta,
      unlimited: value.unlimited,
      rawData: value.rawData,
      warnings: value.warnings,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "swap") {
    if (
      value.title !== "Swap"
      || typeof value.protocol !== "string"
      || typeof value.router !== "string"
      || (value.tokenIn !== undefined && typeof value.tokenIn !== "string")
      || (value.tokenOut !== undefined && typeof value.tokenOut !== "string")
      || (value.amountIn !== undefined && typeof value.amountIn !== "string")
      || (value.amountOut !== undefined && typeof value.amountOut !== "string")
      || (value.minAmountOut !== undefined && typeof value.minAmountOut !== "string")
      || (value.maxAmountIn !== undefined && typeof value.maxAmountIn !== "string")
      || typeof value.recipient !== "string"
      || typeof value.nativeValue !== "string"
      || typeof value.rawData !== "string"
    ) return undefined;
    return {
      kind: "swap",
      title: "Swap",
      protocol: value.protocol,
      router: value.router,
      tokenIn: value.tokenIn,
      tokenOut: value.tokenOut,
      amountIn: value.amountIn,
      amountOut: value.amountOut,
      minAmountOut: value.minAmountOut,
      maxAmountIn: value.maxAmountIn,
      recipient: value.recipient,
      nativeValue: value.nativeValue,
      rawData: value.rawData,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "aave-action") {
    if (
      value.title !== "Aave action"
      || (value.action !== "supply" && value.action !== "withdraw" && value.action !== "borrow" && value.action !== "repay")
      || typeof value.pool !== "string"
      || typeof value.asset !== "string"
      || typeof value.amount !== "string"
      || typeof value.beneficiary !== "string"
      || (value.interestRateMode !== undefined && typeof value.interestRateMode !== "string")
      || typeof value.rawData !== "string"
    ) return undefined;
    return {
      kind: "aave-action",
      title: "Aave action",
      action: value.action,
      pool: value.pool,
      asset: value.asset,
      amount: value.amount,
      beneficiary: value.beneficiary,
      interestRateMode: value.interestRateMode,
      rawData: value.rawData,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "bridge") {
    if (
      value.title !== "Bridge"
      || typeof value.protocol !== "string"
      || typeof value.bridge !== "string"
      || typeof value.targetChain !== "string"
      || typeof value.recipient !== "string"
      || typeof value.amount !== "string"
      || typeof value.minAmount !== "string"
      || typeof value.nativeValue !== "string"
      || typeof value.rawData !== "string"
    ) return undefined;
    return {
      kind: "bridge",
      title: "Bridge",
      protocol: value.protocol,
      bridge: value.bridge,
      targetChain: value.targetChain,
      recipient: value.recipient,
      amount: value.amount,
      minAmount: value.minAmount,
      nativeValue: value.nativeValue,
      rawData: value.rawData,
      feeEstimate,
      simulation: value.simulation
    };
  }
  if (value.kind === "safe-execution") {
    if (
      value.title !== "Safe execution"
      || typeof value.safe !== "string"
      || typeof value.target !== "string"
      || typeof value.value !== "string"
      || (value.operation !== "call" && value.operation !== "delegatecall" && !(typeof value.operation === "string" && /^unknown-\d+$/.test(value.operation)))
      || typeof value.payloadBytes !== "number"
      || typeof value.rawData !== "string"
    ) return undefined;
    return {
      kind: "safe-execution",
      title: "Safe execution",
      safe: value.safe,
      target: value.target,
      value: value.value,
      operation: value.operation as "call" | "delegatecall" | `unknown-${number}`,
      payloadBytes: value.payloadBytes,
      rawData: value.rawData,
      feeEstimate,
      simulation: value.simulation
    };
  }
  return undefined;
}

function parseStoredTransactionApproval(input: unknown): StoredPendingDappTransaction | undefined {
  const base = parseStoredDappApprovalBase(input);
  if (!base || base.approvalKind !== "transaction" || !isRecord(input)) return undefined;
  if (
    typeof input.origin !== "string"
    || typeof input.accountIndex !== "number"
    || typeof input.chain !== "string"
    || typeof input.to !== "string"
    || typeof input.value !== "string"
    || (input.data !== undefined && typeof input.data !== "string")
    || (input.gasLimit !== undefined && typeof input.gasLimit !== "string")
    || (input.from !== undefined && typeof input.from !== "string")
    || (input.verification !== undefined && !parseStoredTransactionVerification(input.verification))
    || typeof input.requestedAt !== "string"
  ) return undefined;
  try {
    BigInt(input.value);
    if (input.gasLimit !== undefined) BigInt(input.gasLimit);
  } catch {
    return undefined;
  }
  if (input.data !== undefined && input.review === undefined) return undefined;
  const review = parseStoredTransactionReview(input.review, input.to, input.value);
  if (!review) return undefined;
  const verification = input.verification === undefined ? undefined : parseStoredTransactionVerification(input.verification);
  return {
    ...base,
    approvalKind: "transaction",
    origin: input.origin,
    accountIndex: input.accountIndex,
    chain: input.chain as ChainId,
    to: input.to,
    value: input.value,
    data: input.data,
    gasLimit: input.gasLimit,
    review,
    verification,
    from: input.from,
    requestedAt: input.requestedAt
  };
}
