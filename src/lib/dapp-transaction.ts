import { getAddress, Interface, isAddress as isEvmAddress } from "ethers";
import { isEvmAddress as isEvmAddressShape } from "./personal-sign";
import { rpcFetchForChain } from "./rpc-fetch";
import type { RpcOverrides } from "./rpc-overrides";
import type { ChainId, DappFeeEstimate, DappTransactionReview, SimulationResult } from "./types";

export type ParsedDappEvmTransaction = {
  from?: string;
  to: string;
  value: bigint;
  data?: string;
  gasLimit?: bigint;
  review?: DappTransactionReview;
};

const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const UINT256_MAX = (1n << 256n) - 1n;
const ERC20_INFO_INTERFACE = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);
const UNISWAP_V2_ROUTER_INTERFACE = new Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)",
  "function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)"
]);
const AAVE_POOL_INTERFACE = new Interface([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
  "function withdraw(address asset,uint256 amount,address to)",
  "function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)",
  "function repay(address asset,uint256 amount,uint256 interestRateMode,address onBehalfOf)"
]);
const LAYERZERO_OFT_INTERFACE = new Interface([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress) payable"
]);
const SAFE_EXECUTION_INTERFACE = new Interface([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)"
]);

type ReviewWithoutSimulation<TKind extends DappTransactionReview["kind"]> =
  Omit<Extract<DappTransactionReview, { kind: TKind }>, "simulation" | "feeEstimate">;
type AnyReviewWithoutSimulation = {
  [TKind in DappTransactionReview["kind"]]: ReviewWithoutSimulation<TKind>
}[DappTransactionReview["kind"]];

type DecodedKnownErc20Calldata =
  | ReviewWithoutSimulation<"erc20-transfer">
  | ReviewWithoutSimulation<"erc20-approval">;

type DecodedKnownDappCalldata = {
  review: AnyReviewWithoutSimulation;
  allowNativeValue?: boolean;
};

type GasEstimateResult = {
  gasLimit: bigint;
  gasEstimateHex: string;
};

function parseHexQuantity(value: unknown, field: string): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid ${field} in transaction request`);
  }
  return BigInt(value);
}

function normalizeCalldata(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error("Invalid data in transaction request");
  }
  const normalized = value.toLowerCase();
  return normalized === "0x" ? undefined : normalized;
}

function rejectUnsupportedFields(record: Record<string, unknown>): void {
  const unsupported = ["gas", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type", "accessList"];
  const provided = unsupported.find((field) => record[field] !== undefined && record[field] !== null && record[field] !== "");
  if (provided) throw new Error(`Unsupported ${provided} in dApp transaction request`);
}

function normalizeAddress(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !isEvmAddressShape(value.trim())) {
    throw new Error(`Invalid ${field} in transaction request`);
  }
  const trimmed = value.trim();
  if (!isEvmAddress(trimmed)) throw new Error(`Invalid ${field} checksum in transaction request`);
  return trimmed;
}

export function parseEthSendTransactionParams(params: unknown, connectedAddress: string): ParsedDappEvmTransaction {
  const list = Array.isArray(params) ? params : [];
  const tx = list[0];
  if (!tx || typeof tx !== "object" || Array.isArray(tx)) {
    throw new Error("Invalid eth_sendTransaction params");
  }
  const record = tx as Record<string, unknown>;
  const from = normalizeAddress(record.from, "from");
  if (from && from.toLowerCase() !== connectedAddress.toLowerCase()) {
    throw new Error("Transaction sender does not match connected account");
  }
  const to = normalizeAddress(record.to, "to");
  if (!to) throw new Error("Transaction recipient is required");
  const value = parseHexQuantity(record.value ?? "0x0", "value") ?? 0n;
  const data = normalizeCalldata(record.data);
  rejectUnsupportedFields(record);
  return {
    from: from ?? connectedAddress,
    to,
    value,
    data
  };
}

export function serializeDappTransactionForDedup(tx: ParsedDappEvmTransaction): string {
  return JSON.stringify({
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data ?? ""
  });
}

export function formatDappTransactionValue(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = value % 10n ** 18n;
  if (fraction === 0n) return whole.toString();
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fractionText}`;
}

export async function assertEoaDappRecipient(
  chainId: ChainId,
  address: string,
  rpcOverrides?: RpcOverrides
): Promise<void> {
  const response = await rpcFetchForChain(chainId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] })
  }, rpcOverrides?.[chainId]);
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || typeof payload.result !== "string") {
    throw new Error("Unable to verify dApp transaction recipient contract status");
  }
  if (payload.result.toLowerCase() !== "0x") {
    throw new Error("Contract dApp transactions are not supported until calldata decoding and simulation are available");
  }
}

export function nativeTransferReview(to: string, value: bigint, simulation: SimulationResult = { status: "unavailable" }): DappTransactionReview {
  return {
    kind: "native-transfer",
    title: "Native transfer",
    to,
    value: value.toString(),
    simulation
  };
}

export async function prepareDappEvmTransactionForApproval(
  chainId: ChainId,
  tx: ParsedDappEvmTransaction,
  rpcOverrides?: RpcOverrides
): Promise<ParsedDappEvmTransaction> {
  if (!tx.data) {
    await assertEoaDappRecipient(chainId, tx.to, rpcOverrides);
    const gasEstimate = await estimateDappTransactionGas(chainId, tx, rpcOverrides);
    const feeEstimate = await estimateDappTransactionFees(chainId, gasEstimate, rpcOverrides);
    const simulation = await simulateDappTransaction(chainId, tx, gasEstimate, rpcOverrides);
    return {
      ...tx,
      gasLimit: gasEstimate.gasLimit,
      review: {
        ...nativeTransferReview(tx.to, tx.value, simulation),
        feeEstimate
      }
    };
  }

  const decoded = decodeKnownDappCalldata(tx.to, tx.data, tx.value);
  if (!decoded) {
    throw new Error("Contract dApp transactions are not supported until calldata decoding and simulation are available");
  }
  if (tx.value !== 0n && !decoded.allowNativeValue) {
    throw new Error(`${decoded.review.title} dApp transactions with native value are not supported`);
  }

  const gasEstimate = await estimateDappTransactionGas(chainId, tx, rpcOverrides);
  const feeEstimate = await estimateDappTransactionFees(chainId, gasEstimate, rpcOverrides);
  const simulation = await simulateDappTransaction(chainId, tx, gasEstimate, rpcOverrides);
  const enrichedReview = await enrichDecodedReview(chainId, tx, decoded.review, rpcOverrides);
  const review: DappTransactionReview = {
    ...enrichedReview,
    feeEstimate,
    simulation
  } as DappTransactionReview;
  return {
    ...tx,
    gasLimit: gasEstimate.gasLimit,
    review
  };
}

async function enrichDecodedReview(
  chainId: ChainId,
  tx: ParsedDappEvmTransaction,
  review: AnyReviewWithoutSimulation,
  rpcOverrides?: RpcOverrides
): Promise<AnyReviewWithoutSimulation> {
  if (review.kind === "erc20-transfer") {
    const { tokenMetadata, warnings } = await readErc20ReviewContext(chainId, review.token, rpcOverrides);
    return {
      ...review,
      ...(tokenMetadata ? { tokenMetadata } : {}),
      ...(warnings.length ? { warnings } : {})
    };
  }
  if (review.kind === "erc20-approval") {
    const { tokenMetadata, warnings } = await readErc20ReviewContext(chainId, review.token, rpcOverrides);
    const approvalWarnings = [...warnings];
    const currentAllowance = tx.from
      ? await readErc20Allowance(chainId, review.token, tx.from, review.spender, rpcOverrides).catch(() => undefined)
      : undefined;
    if (currentAllowance === undefined) {
      approvalWarnings.push("Current allowance unavailable from RPC");
    }
    if (review.unlimited) {
      approvalWarnings.push("Unlimited approval lets this spender transfer this token until changed");
    }
    return {
      ...review,
      ...(tokenMetadata ? { tokenMetadata } : {}),
      ...(currentAllowance !== undefined ? {
        currentAllowance: currentAllowance.toString(),
        allowanceDelta: (BigInt(review.amount) - currentAllowance).toString()
      } : {}),
      ...(approvalWarnings.length ? { warnings: approvalWarnings } : {})
    };
  }
  return review;
}

async function readErc20ReviewContext(
  chainId: ChainId,
  token: string,
  rpcOverrides?: RpcOverrides
): Promise<{ tokenMetadata?: NonNullable<Extract<DappTransactionReview, { kind: "erc20-transfer" }>["tokenMetadata"]>; warnings: string[] }> {
  const [name, symbol, decimals] = await Promise.all([
    readErc20String(chainId, token, "name", rpcOverrides).catch(() => undefined),
    readErc20String(chainId, token, "symbol", rpcOverrides).catch(() => undefined),
    readErc20Decimals(chainId, token, rpcOverrides).catch(() => undefined)
  ]);
  const tokenMetadata = {
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(decimals !== undefined ? { decimals } : {})
  };
  if (Object.keys(tokenMetadata).length === 0) {
    return { warnings: ["Token metadata unavailable from RPC"] };
  }
  return { tokenMetadata, warnings: [] };
}

async function readErc20String(
  chainId: ChainId,
  token: string,
  functionName: "name" | "symbol",
  rpcOverrides?: RpcOverrides
): Promise<string | undefined> {
  const data = ERC20_INFO_INTERFACE.encodeFunctionData(functionName);
  const result = await callContract(chainId, token, data, rpcOverrides);
  const [value] = ERC20_INFO_INTERFACE.decodeFunctionResult(functionName, result);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readErc20Decimals(
  chainId: ChainId,
  token: string,
  rpcOverrides?: RpcOverrides
): Promise<number | undefined> {
  const result = await callContract(chainId, token, ERC20_INFO_INTERFACE.encodeFunctionData("decimals"), rpcOverrides);
  const [value] = ERC20_INFO_INTERFACE.decodeFunctionResult("decimals", result);
  if (typeof value !== "bigint" || value < 0n || value > 255n) return undefined;
  return Number(value);
}

async function readErc20Allowance(
  chainId: ChainId,
  token: string,
  owner: string,
  spender: string,
  rpcOverrides?: RpcOverrides
): Promise<bigint> {
  const data = ERC20_INFO_INTERFACE.encodeFunctionData("allowance", [owner, spender]);
  const result = await callContract(chainId, token, data, rpcOverrides);
  const [value] = ERC20_INFO_INTERFACE.decodeFunctionResult("allowance", result);
  if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid ERC-20 allowance result");
  return value;
}

function decodeKnownDappCalldata(target: string, data: string, value: bigint): DecodedKnownDappCalldata | undefined {
  const erc20 = decodeKnownErc20Calldata(target, data);
  if (erc20) return { review: erc20 };
  return decodeUniswapV2SwapCalldata(target, data, value)
    ?? decodeAavePoolCalldata(target, data)
    ?? decodeLayerZeroOftBridgeCalldata(target, data, value)
    ?? decodeSafeExecutionCalldata(target, data);
}

function decodeKnownErc20Calldata(token: string, data: string): DecodedKnownErc20Calldata | undefined {
  const selector = data.slice(0, 10);
  if (selector !== ERC20_TRANSFER_SELECTOR && selector !== ERC20_APPROVE_SELECTOR) return undefined;
  if (data.length !== 138) {
    throw new Error("Invalid ERC-20 calldata length in dApp transaction request");
  }
  const address = decodeAbiAddress(data.slice(10, 74));
  const amount = BigInt(`0x${data.slice(74, 138)}`);
  if (selector === ERC20_TRANSFER_SELECTOR) {
    return {
      kind: "erc20-transfer",
      title: "ERC-20 transfer",
      token,
      recipient: address,
      amount: amount.toString(),
      rawData: data
    };
  }
  return {
    kind: "erc20-approval",
    title: "ERC-20 approval",
    token,
    spender: address,
    amount: amount.toString(),
    unlimited: amount === UINT256_MAX,
    rawData: data
  };
}

function decodeUniswapV2SwapCalldata(router: string, data: string, nativeValue: bigint): DecodedKnownDappCalldata | undefined {
  const parsed = parseKnownCalldata(UNISWAP_V2_ROUTER_INTERFACE, data);
  if (!parsed) return undefined;

  if (parsed.name === "swapExactTokensForTokens") {
    const path = decodeAddressPath(parsed.args[2], "swap path");
    return {
      review: {
        kind: "swap",
        title: "Swap",
        protocol: "Uniswap V2-compatible router",
        router,
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: uintArgument(parsed.args[0], "swap amount in"),
        minAmountOut: uintArgument(parsed.args[1], "swap minimum output"),
        recipient: addressArgument(parsed.args[3], "swap recipient"),
        nativeValue: nativeValue.toString(),
        rawData: data
      }
    };
  }

  if (parsed.name === "swapTokensForExactTokens") {
    const path = decodeAddressPath(parsed.args[2], "swap path");
    return {
      review: {
        kind: "swap",
        title: "Swap",
        protocol: "Uniswap V2-compatible router",
        router,
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountOut: uintArgument(parsed.args[0], "swap amount out"),
        maxAmountIn: uintArgument(parsed.args[1], "swap maximum input"),
        recipient: addressArgument(parsed.args[3], "swap recipient"),
        nativeValue: nativeValue.toString(),
        rawData: data
      }
    };
  }

  if (parsed.name === "swapExactETHForTokens") {
    const path = decodeAddressPath(parsed.args[1], "swap path");
    return {
      allowNativeValue: true,
      review: {
        kind: "swap",
        title: "Swap",
        protocol: "Uniswap V2-compatible router",
        router,
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: nativeValue.toString(),
        minAmountOut: uintArgument(parsed.args[0], "swap minimum output"),
        recipient: addressArgument(parsed.args[2], "swap recipient"),
        nativeValue: nativeValue.toString(),
        rawData: data
      }
    };
  }

  if (parsed.name === "swapExactTokensForETH") {
    const path = decodeAddressPath(parsed.args[2], "swap path");
    return {
      review: {
        kind: "swap",
        title: "Swap",
        protocol: "Uniswap V2-compatible router",
        router,
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: uintArgument(parsed.args[0], "swap amount in"),
        minAmountOut: uintArgument(parsed.args[1], "swap minimum output"),
        recipient: addressArgument(parsed.args[3], "swap recipient"),
        nativeValue: nativeValue.toString(),
        rawData: data
      }
    };
  }

  return undefined;
}

function decodeAavePoolCalldata(pool: string, data: string): DecodedKnownDappCalldata | undefined {
  const parsed = parseKnownCalldata(AAVE_POOL_INTERFACE, data);
  if (!parsed) return undefined;
  if (parsed.name === "supply") {
    return {
      review: {
        kind: "aave-action",
        title: "Aave action",
        action: "supply",
        pool,
        asset: addressArgument(parsed.args[0], "Aave asset"),
        amount: uintArgument(parsed.args[1], "Aave amount"),
        beneficiary: addressArgument(parsed.args[2], "Aave beneficiary"),
        rawData: data
      }
    };
  }
  if (parsed.name === "withdraw") {
    return {
      review: {
        kind: "aave-action",
        title: "Aave action",
        action: "withdraw",
        pool,
        asset: addressArgument(parsed.args[0], "Aave asset"),
        amount: uintArgument(parsed.args[1], "Aave amount"),
        beneficiary: addressArgument(parsed.args[2], "Aave recipient"),
        rawData: data
      }
    };
  }
  if (parsed.name === "borrow") {
    return {
      review: {
        kind: "aave-action",
        title: "Aave action",
        action: "borrow",
        pool,
        asset: addressArgument(parsed.args[0], "Aave asset"),
        amount: uintArgument(parsed.args[1], "Aave amount"),
        interestRateMode: uintArgument(parsed.args[2], "Aave interest rate mode"),
        beneficiary: addressArgument(parsed.args[4], "Aave beneficiary"),
        rawData: data
      }
    };
  }
  if (parsed.name === "repay") {
    return {
      review: {
        kind: "aave-action",
        title: "Aave action",
        action: "repay",
        pool,
        asset: addressArgument(parsed.args[0], "Aave asset"),
        amount: uintArgument(parsed.args[1], "Aave amount"),
        interestRateMode: uintArgument(parsed.args[2], "Aave interest rate mode"),
        beneficiary: addressArgument(parsed.args[3], "Aave beneficiary"),
        rawData: data
      }
    };
  }
  return undefined;
}

function decodeLayerZeroOftBridgeCalldata(bridge: string, data: string, nativeValue: bigint): DecodedKnownDappCalldata | undefined {
  const parsed = parseKnownCalldata(LAYERZERO_OFT_INTERFACE, data);
  if (!parsed) return undefined;
  const sendParam = parsed.args[0];
  return {
    allowNativeValue: true,
    review: {
      kind: "bridge",
      title: "Bridge",
      protocol: "LayerZero OFT / USDT0-compatible bridge",
      bridge,
      targetChain: uintArgument(tupleArgument(sendParam, 0, "bridge target chain"), "bridge target chain"),
      recipient: bytesArgument(tupleArgument(sendParam, 1, "bridge recipient"), "bridge recipient"),
      amount: uintArgument(tupleArgument(sendParam, 2, "bridge amount"), "bridge amount"),
      minAmount: uintArgument(tupleArgument(sendParam, 3, "bridge minimum amount"), "bridge minimum amount"),
      nativeValue: nativeValue.toString(),
      rawData: data
    }
  };
}

function decodeSafeExecutionCalldata(safe: string, data: string): DecodedKnownDappCalldata | undefined {
  const parsed = parseKnownCalldata(SAFE_EXECUTION_INTERFACE, data);
  if (!parsed) return undefined;
  return {
    review: {
      kind: "safe-execution",
      title: "Safe execution",
      safe,
      target: addressArgument(parsed.args[0], "Safe target"),
      value: uintArgument(parsed.args[1], "Safe value"),
      operation: safeOperation(parsed.args[3]),
      payloadBytes: byteLengthArgument(parsed.args[2], "Safe payload"),
      rawData: data
    }
  };
}

function parseKnownCalldata(contractInterface: Interface, data: string) {
  try {
    return contractInterface.parseTransaction({ data });
  } catch {
    return null;
  }
}

function addressArgument(value: unknown, field: string): string {
  if (typeof value !== "string" || !isEvmAddress(value)) {
    throw new Error(`Invalid ${field} address argument in dApp transaction request`);
  }
  return getAddress(value);
}

function uintArgument(value: unknown, field: string): string {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`Invalid ${field} uint argument in dApp transaction request`);
  }
  return value.toString();
}

function bytesArgument(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Invalid ${field} bytes argument in dApp transaction request`);
  }
  return value.toLowerCase();
}

function byteLengthArgument(value: unknown, field: string): number {
  return (bytesArgument(value, field).length - 2) / 2;
}

function tupleArgument(value: unknown, index: number, field: string): unknown {
  if (!value || typeof value !== "object" || !(index in value)) {
    throw new Error(`Invalid ${field} tuple argument in dApp transaction request`);
  }
  return (value as Record<number, unknown>)[index];
}

function decodeAddressPath(value: unknown, field: string): string[] {
  if (!value || typeof value === "string" || typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function") {
    throw new Error(`Invalid ${field} address array in dApp transaction request`);
  }
  const addresses = Array.from(value as Iterable<unknown>).map((entry) => addressArgument(entry, field));
  if (addresses.length < 2) throw new Error(`Invalid ${field} address array in dApp transaction request`);
  return addresses;
}

function safeOperation(value: unknown): "call" | "delegatecall" | `unknown-${number}` {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid Safe operation argument in dApp transaction request");
  }
  const operation = Number(value);
  if (operation === 0) return "call";
  if (operation === 1) return "delegatecall";
  return `unknown-${operation}`;
}

function decodeAbiAddress(word: string): string {
  if (!/^[0-9a-f]{64}$/.test(word)) throw new Error("Invalid ERC-20 address argument in dApp transaction request");
  const address = `0x${word.slice(24)}`;
  if (!isEvmAddress(address)) throw new Error("Invalid ERC-20 address argument in dApp transaction request");
  return getAddress(address);
}

async function estimateDappTransactionGas(
  chainId: ChainId,
  tx: ParsedDappEvmTransaction,
  rpcOverrides?: RpcOverrides
): Promise<GasEstimateResult> {
  const result = await dappRpc(chainId, "eth_estimateGas", [rpcTransaction(tx)], rpcOverrides);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new Error("Unable to estimate dApp transaction gas");
  }
  return { gasLimit: BigInt(result), gasEstimateHex: result };
}

async function estimateDappTransactionFees(
  chainId: ChainId,
  gasEstimate: GasEstimateResult,
  rpcOverrides?: RpcOverrides
): Promise<DappFeeEstimate> {
  try {
    const feeHistory = await dappRpc(chainId, "eth_feeHistory", ["0x1", "latest", [50]], rpcOverrides);
    const estimate = dappFeeEstimateFromFeeHistory(gasEstimate.gasLimit, feeHistory);
    if (estimate) return estimate;
  } catch {
    // Fall back to legacy pricing below.
  }

  const gasPriceResult = await dappRpc(chainId, "eth_gasPrice", [], rpcOverrides);
  const gasPrice = rpcHexQuantity(gasPriceResult, "eth_gasPrice");
  return {
    type: "legacy",
    gasLimit: gasEstimate.gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    maxNativeFee: (gasEstimate.gasLimit * gasPrice).toString(),
    source: "eth_gasPrice",
    warning: "EIP-1559 fee history unavailable; using legacy gas price."
  };
}

function dappFeeEstimateFromFeeHistory(gasLimit: bigint, value: unknown): DappFeeEstimate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.baseFeePerGas) || record.baseFeePerGas.length === 0) return undefined;
  const latestBaseFee = rpcHexQuantity(record.baseFeePerGas[record.baseFeePerGas.length - 1], "eth_feeHistory.baseFeePerGas");
  const priorityFee = priorityFeeFromHistory(record.reward) ?? 1_000_000_000n;
  const maxFeePerGas = latestBaseFee * 2n + priorityFee;
  return {
    type: "eip1559",
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: priorityFee.toString(),
    maxNativeFee: (gasLimit * maxFeePerGas).toString(),
    source: "eth_feeHistory"
  };
}

function priorityFeeFromHistory(value: unknown): bigint | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const latestRewards = value[value.length - 1];
  if (!Array.isArray(latestRewards) || latestRewards.length === 0) return undefined;
  try {
    return rpcHexQuantity(latestRewards[0], "eth_feeHistory.reward");
  } catch {
    return undefined;
  }
}

async function simulateDappTransaction(
  chainId: ChainId,
  tx: ParsedDappEvmTransaction,
  gasEstimate: GasEstimateResult,
  rpcOverrides?: RpcOverrides
): Promise<SimulationResult> {
  const result = await dappRpc(chainId, "eth_call", [rpcTransaction(tx), "latest"], rpcOverrides);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) {
    throw new Error("Unable to simulate dApp transaction");
  }
  return {
    status: "passed",
    gasEstimate: gasEstimate.gasLimit.toString(),
    rpcEvidence: {
      gasEstimateMethod: "eth_estimateGas",
      simulationMethod: "eth_call",
      blockTag: "latest",
      gasEstimateHex: gasEstimate.gasEstimateHex,
      simulationResult: result
    }
  };
}

async function callContract(
  chainId: ChainId,
  to: string,
  data: string,
  rpcOverrides?: RpcOverrides
): Promise<string> {
  const result = await dappRpc(chainId, "eth_call", [{ to, data }, "latest"], rpcOverrides);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) {
    throw new Error("Unable to read contract state");
  }
  return result;
}

function rpcHexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid ${field} result`);
  }
  return BigInt(value);
}

async function dappRpc(
  chainId: ChainId,
  method: string,
  params: unknown[],
  rpcOverrides?: RpcOverrides
): Promise<unknown> {
  const response = await rpcFetchForChain(chainId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }, rpcOverrides?.[chainId]);
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error) {
    throw new Error(`${method} failed: ${payload.error.message ?? "JSON-RPC error"}`);
  }
  return payload.result;
}

function rpcTransaction(tx: ParsedDappEvmTransaction): Record<string, string> {
  return {
    ...(tx.from ? { from: tx.from } : {}),
    to: tx.to,
    value: hexQuantity(tx.value),
    ...(tx.data ? { data: tx.data } : {})
  };
}

function hexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
