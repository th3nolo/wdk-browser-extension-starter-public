import type {
  DappSignatureVerificationEvidence,
  DappTransactionVerificationEvidence
} from "./verify/evidence";

export type ChainId = "bitcoin" | "spark" | "ethereum" | "polygon" | "arbitrum" | "plasma" | "solana";

export type AssetId = "BTC" | "SATS" | "ETH" | "POL" | "XPL" | "MATIC" | "SOL" | "USDt" | "XAUt";

export type WalletRecord = {
  id: string;
  name: string;
  createdAt: string;
  accountCount: number;
};

export type AccountRecord = {
  walletId: string;
  chain: ChainId;
  index: number;
  address: string;
  path: string;
};

export type BalanceRecord = {
  chain: ChainId;
  asset: AssetId;
  amount: string;
  symbol: string;
  decimals: number;
};

export type TransactionStatus = "draft" | "pending" | "confirmed" | "failed" | "dropped";

export type TransactionRecord = {
  id: string;
  walletId: string;
  chain: ChainId;
  asset: AssetId;
  from: string;
  to: string;
  amount: string;
  status: TransactionStatus;
  txHash?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type SendRequest = {
  walletId: string;
  chain: ChainId;
  asset: AssetId;
  accountIndex: number;
  to: string;
  amount: string;
};

export type DappConnection = {
  origin: string;
  walletId: string;
  /** Primary exposed account (kept for back-compat; equals accountIndexes[0]). */
  accountIndex: number;
  /** All account indexes exposed to this origin. Falls back to [accountIndex] when absent. */
  accountIndexes?: number[];
  /** EIP-155 numeric chain ID for this origin's EVM provider session. */
  evmChainId: number;
  connectedAt: string;
  lastUsedAt: string;
};

/** The account indexes a connection exposes to a dApp (defaults to the primary). */
export function exposedAccountIndexes(connection: Pick<DappConnection, "accountIndex" | "accountIndexes">): number[] {
  return connection.accountIndexes && connection.accountIndexes.length > 0
    ? [...connection.accountIndexes]
    : [connection.accountIndex];
}

export type DappConnectionRequest = {
  origin: string;
  walletId: string;
  requestedAt: string;
};

export type PersonalSignMessageEncoding = "utf8" | "hex";

export type SignatureRequestKind = "personal_sign" | "eth_signTypedData_v3" | "eth_signTypedData_v4";
export type TypedDataSignatureRequestKind = "eth_signTypedData_v3" | "eth_signTypedData_v4";

export function isTypedDataSignatureKind(kind: SignatureRequestKind): kind is TypedDataSignatureRequestKind {
  return kind === "eth_signTypedData_v3" || kind === "eth_signTypedData_v4";
}

export type Eip712TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type DappSignatureRequest = {
  id: string;
  origin: string;
  walletId: string;
  accountIndex: number;
  kind: SignatureRequestKind;
  message: string;
  displayMessage: string;
  messageEncoding: PersonalSignMessageEncoding;
  messageByteLength: number;
  typedData?: Eip712TypedDataPayload;
  verification?: DappSignatureVerificationEvidence;
  requestedAt: string;
};

export type DappTransactionRequest = {
  id: string;
  origin: string;
  walletId: string;
  accountIndex: number;
  chain: ChainId;
  to: string;
  value: string;
  data?: string;
  gasLimit?: string;
  review: DappTransactionReview;
  verification?: DappTransactionVerificationEvidence;
  requestedAt: string;
};

export type DappFeeEstimate = {
  type: "eip1559" | "legacy";
  gasLimit: string;
  maxNativeFee: string;
  source: "eth_feeHistory" | "eth_gasPrice";
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  warning?: string;
};

export type SimulationResult = {
  status: "passed" | "failed" | "unavailable";
  gasEstimate?: string;
  rpcEvidence?: {
    gasEstimateMethod: "eth_estimateGas";
    simulationMethod: "eth_call";
    blockTag: "latest";
    gasEstimateHex?: string;
    simulationResult?: string;
  };
  message?: string;
  warning?: string;
};

export type Erc20TokenMetadata = {
  name?: string;
  symbol?: string;
  decimals?: number;
};

export type DappTransactionReview =
  | {
    kind: "native-transfer";
    title: "Native transfer";
    to: string;
    value: string;
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "erc20-transfer";
    title: "ERC-20 transfer";
    token: string;
    tokenMetadata?: Erc20TokenMetadata;
    recipient: string;
    amount: string;
    rawData: string;
    warnings?: string[];
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "erc20-approval";
    title: "ERC-20 approval";
    token: string;
    tokenMetadata?: Erc20TokenMetadata;
    spender: string;
    amount: string;
    currentAllowance?: string;
    allowanceDelta?: string;
    unlimited: boolean;
    rawData: string;
    warnings?: string[];
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "swap";
    title: "Swap";
    protocol: string;
    router: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    amountOut?: string;
    minAmountOut?: string;
    maxAmountIn?: string;
    recipient: string;
    nativeValue: string;
    rawData: string;
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "aave-action";
    title: "Aave action";
    action: "supply" | "withdraw" | "borrow" | "repay";
    pool: string;
    asset: string;
    amount: string;
    beneficiary: string;
    interestRateMode?: string;
    rawData: string;
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "bridge";
    title: "Bridge";
    protocol: string;
    bridge: string;
    targetChain: string;
    recipient: string;
    amount: string;
    minAmount: string;
    nativeValue: string;
    rawData: string;
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  }
  | {
    kind: "safe-execution";
    title: "Safe execution";
    safe: string;
    target: string;
    value: string;
    operation: "call" | "delegatecall" | `unknown-${number}`;
    payloadBytes: number;
    rawData: string;
    feeEstimate?: DappFeeEstimate;
    simulation: SimulationResult;
  };

export type WalletSummary = {
  locked: boolean;
  hasVault: boolean;
  wallets: WalletRecord[];
  activeWalletId?: string;
  sessionExpiresAt?: string;
  rpcOverrides?: Partial<Record<ChainId, string>>;
  connectedSites: DappConnection[];
  pendingConnections: DappConnectionRequest[];
  pendingSignatures: DappSignatureRequest[];
  pendingTransactions: DappTransactionRequest[];
};

export type PopupSummaryState = WalletSummary & {
  accounts: AccountRecord[];
  transactions: TransactionRecord[];
};

export type PopupState = PopupSummaryState & {
  balances: BalanceRecord[];
};
