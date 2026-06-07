import { Interface } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDappTransactionValue,
  parseEthSendTransactionParams,
  prepareDappEvmTransactionForApproval,
  serializeDappTransactionForDedup
} from "./dapp-transaction";

const connectedAddress = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const tokenAddress = "0x0000000000000000000000000000000000000003";
const spenderAddress = "0x0000000000000000000000000000000000000004";
const routerAddress = "0x0000000000000000000000000000000000000005";
const aavePoolAddress = "0x0000000000000000000000000000000000000006";
const bridgeAddress = "0x0000000000000000000000000000000000000007";
const safeAddress = "0x0000000000000000000000000000000000000008";
const targetAddress = "0x0000000000000000000000000000000000000009";
const swapInterface = new Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline)"
]);
const aaveInterface = new Interface([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)"
]);
const layerZeroOftInterface = new Interface([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress) payable"
]);
const safeInterface = new Interface([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)"
]);
const erc20InfoInterface = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);
const expectedPassedSimulation = {
  status: "passed",
  gasEstimate: "21000",
  rpcEvidence: {
    gasEstimateMethod: "eth_estimateGas",
    simulationMethod: "eth_call",
    blockTag: "latest",
    gasEstimateHex: "0x5208",
    simulationResult: "0x"
  }
};
const expectedFeeEstimate = {
  type: "eip1559",
  gasLimit: "21000",
  maxFeePerGas: "3000000000",
  maxPriorityFeePerGas: "1000000000",
  maxNativeFee: "63000000000000",
  source: "eth_feeHistory"
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params?: Array<Record<string, unknown>> };
    const data = typeof body.params?.[0]?.data === "string" ? body.params[0].data.toLowerCase() : undefined;
    const erc20CallResult = erc20ResultForData(data);
    const results: Record<string, unknown> = {
      eth_getCode: "0x",
      eth_estimateGas: "0x5208",
      eth_feeHistory: {
        oldestBlock: "0x1",
        baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
        gasUsedRatio: [0.5],
        reward: [["0x3b9aca00"]]
      },
      eth_gasPrice: "0x3b9aca00",
      eth_call: erc20CallResult ?? "0x"
    };
    return { ok: true, json: async () => ({ result: results[body.method] }) } as Response;
  }));
});

describe("dApp EVM transaction parsing", () => {
  it("parses native transfer requests and serializes stable dedupe keys", () => {
    const parsed = parseEthSendTransactionParams([{
      from: connectedAddress,
      to: "0x0000000000000000000000000000000000000001",
      value: "0xde0b6b3a7640000"
    }], connectedAddress);

    expect(parsed).toEqual({
      from: connectedAddress,
      to: "0x0000000000000000000000000000000000000001",
      value: 1000000000000000000n,
      data: undefined
    });
    expect(serializeDappTransactionForDedup(parsed)).toBe(JSON.stringify({
      to: "0x0000000000000000000000000000000000000001",
      value: "1000000000000000000",
      data: ""
    }));
  });

  it("rejects dapp-supplied gas controls", () => {
    const parsed = parseEthSendTransactionParams([{
      to: "0x0000000000000000000000000000000000000001",
      data: "0x"
    }], connectedAddress);
    expect(parsed.data).toBeUndefined();
    expect(() => parseEthSendTransactionParams([{
      to: "0x0000000000000000000000000000000000000001",
      gas: "0x5208"
    }], connectedAddress)).toThrow("Unsupported gas in dApp transaction request");
    expect(() => parseEthSendTransactionParams([{
      to: "0x0000000000000000000000000000000000000001",
      maxFeePerGas: "0x3b9aca00"
    }], connectedAddress)).toThrow("Unsupported maxFeePerGas in dApp transaction request");
  });

  it("prepares native transfers with EOA verification and gas estimation", async () => {
    const parsed = parseEthSendTransactionParams([{
      to: "0x0000000000000000000000000000000000000001",
      value: "0xde0b6b3a7640000"
    }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed, { ethereum: "https://rpc.example" });

    expect(prepared).toMatchObject({
      gasLimit: 21000n,
      review: {
        kind: "native-transfer",
        title: "Native transfer",
        to: "0x0000000000000000000000000000000000000001",
        value: "1000000000000000000",
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
    const methods = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method);
    expect(methods).toEqual(["eth_getCode", "eth_estimateGas", "eth_feeHistory", "eth_call"]);
    expect(fetch).toHaveBeenCalledWith("https://rpc.example", expect.objectContaining({ method: "POST" }));
  });

  it("decodes, estimates, and simulates ERC-20 approvals", async () => {
    const data = `0x095ea7b3${abiAddress(spenderAddress)}${abiUint(1000n)}`;
    const parsed = parseEthSendTransactionParams([{ to: tokenAddress, data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared).toMatchObject({
      to: tokenAddress,
      value: 0n,
      data,
      gasLimit: 21000n,
      review: {
        kind: "erc20-approval",
        title: "ERC-20 approval",
        token: tokenAddress,
        tokenMetadata: {
          name: "Tether USD",
          symbol: "USDt",
          decimals: 6
        },
        spender: spenderAddress,
        amount: "1000",
        currentAllowance: "250",
        allowanceDelta: "750",
        unlimited: false,
        rawData: data,
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
    const methods = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method);
    expect(methods.slice(0, 3)).toEqual(["eth_estimateGas", "eth_feeHistory", "eth_call"]);
    expect(methods.filter((method) => method === "eth_call")).toHaveLength(5);
  });

  it("falls back to legacy gas price when EIP-1559 fee history is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      const results: Record<string, unknown> = {
        eth_getCode: "0x",
        eth_estimateGas: "0x5208",
        eth_feeHistory: undefined,
        eth_gasPrice: "0x3b9aca00",
        eth_call: "0x"
      };
      return { ok: true, json: async () => ({ result: results[body.method] }) } as Response;
    }));
    const parsed = parseEthSendTransactionParams([{
      to: "0x0000000000000000000000000000000000000001",
      value: "0x1"
    }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared.review).toMatchObject({
      kind: "native-transfer",
      feeEstimate: {
        type: "legacy",
        gasLimit: "21000",
        gasPrice: "1000000000",
        maxNativeFee: "21000000000000",
        source: "eth_gasPrice",
        warning: "EIP-1559 fee history unavailable; using legacy gas price."
      }
    });
  });

  it("adds explicit warnings when ERC-20 context cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      const results: Record<string, unknown> = {
        eth_estimateGas: "0x5208",
        eth_feeHistory: {
          oldestBlock: "0x1",
          baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
          gasUsedRatio: [0.5],
          reward: [["0x3b9aca00"]]
        },
        eth_call: "0x"
      };
      return { ok: true, json: async () => ({ result: results[body.method] }) } as Response;
    }));
    const data = `0x095ea7b3${abiAddress(spenderAddress)}${abiUint((1n << 256n) - 1n)}`;
    const parsed = parseEthSendTransactionParams([{ to: tokenAddress, data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared.review).toMatchObject({
      kind: "erc20-approval",
      unlimited: true,
      warnings: [
        "Token metadata unavailable from RPC",
        "Current allowance unavailable from RPC",
        "Unlimited approval lets this spender transfer this token until changed"
      ]
    });
  });

  it("decodes, estimates, and simulates Uniswap-compatible swap calldata", async () => {
    const data = swapInterface.encodeFunctionData("swapExactTokensForTokens", [
      1000n,
      990n,
      [tokenAddress, spenderAddress],
      connectedAddress,
      999999n
    ]).toLowerCase();
    const parsed = parseEthSendTransactionParams([{ to: routerAddress, data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared).toMatchObject({
      to: routerAddress,
      gasLimit: 21000n,
      review: {
        kind: "swap",
        title: "Swap",
        protocol: "Uniswap V2-compatible router",
        router: routerAddress,
        tokenIn: tokenAddress,
        tokenOut: spenderAddress,
        amountIn: "1000",
        minAmountOut: "990",
        recipient: connectedAddress,
        nativeValue: "0",
        rawData: data,
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
  });

  it("decodes, estimates, and simulates Aave pool action calldata", async () => {
    const data = aaveInterface.encodeFunctionData("supply", [
      tokenAddress,
      1000n,
      connectedAddress,
      0
    ]).toLowerCase();
    const parsed = parseEthSendTransactionParams([{ to: aavePoolAddress, data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared).toMatchObject({
      to: aavePoolAddress,
      gasLimit: 21000n,
      review: {
        kind: "aave-action",
        title: "Aave action",
        action: "supply",
        pool: aavePoolAddress,
        asset: tokenAddress,
        amount: "1000",
        beneficiary: connectedAddress,
        rawData: data,
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
  });

  it("decodes, estimates, and simulates LayerZero OFT bridge calldata with native fee", async () => {
    const bytes32Recipient = `0x${"0".repeat(24)}${connectedAddress.slice(2).toLowerCase()}`;
    const data = layerZeroOftInterface.encodeFunctionData("send", [
      [30110, bytes32Recipient, 1000n, 990n, "0x", "0x", "0x"],
      [1n, 0n],
      connectedAddress
    ]).toLowerCase();
    const parsed = parseEthSendTransactionParams([{ to: bridgeAddress, value: "0x1", data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared).toMatchObject({
      to: bridgeAddress,
      value: 1n,
      gasLimit: 21000n,
      review: {
        kind: "bridge",
        title: "Bridge",
        protocol: "LayerZero OFT / USDT0-compatible bridge",
        bridge: bridgeAddress,
        targetChain: "30110",
        recipient: bytes32Recipient,
        amount: "1000",
        minAmount: "990",
        nativeValue: "1",
        rawData: data,
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
  });

  it("decodes, estimates, and simulates Safe execution calldata", async () => {
    const data = safeInterface.encodeFunctionData("execTransaction", [
      targetAddress,
      100n,
      "0x1234",
      0,
      0n,
      0n,
      0n,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x"
    ]).toLowerCase();
    const parsed = parseEthSendTransactionParams([{ to: safeAddress, data }], connectedAddress);

    const prepared = await prepareDappEvmTransactionForApproval("ethereum", parsed);

    expect(prepared).toMatchObject({
      to: safeAddress,
      gasLimit: 21000n,
      review: {
        kind: "safe-execution",
        title: "Safe execution",
        safe: safeAddress,
        target: targetAddress,
        value: "100",
        operation: "call",
        payloadBytes: 2,
        rawData: data,
        feeEstimate: expectedFeeEstimate,
        simulation: expectedPassedSimulation
      }
    });
  });

  it("rejects unknown calldata before approval", async () => {
    const parsed = parseEthSendTransactionParams([{ to: tokenAddress, data: "0x12345678" }], connectedAddress);

    await expect(prepareDappEvmTransactionForApproval("ethereum", parsed))
      .rejects.toThrow("Contract dApp transactions are not supported until calldata decoding and simulation are available");
  });

  it("rejects simulated contract calls when RPC preflight fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      return {
        ok: true,
        json: async () => {
          if (body.method === "eth_estimateGas") return { result: "0x5208" };
          if (body.method === "eth_feeHistory") {
            return {
              result: {
                oldestBlock: "0x1",
                baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
                gasUsedRatio: [0.5],
                reward: [["0x3b9aca00"]]
              }
            };
          }
          return { error: { message: "execution reverted" } };
        }
      } as Response;
    }));
    const data = `0x095ea7b3${abiAddress(spenderAddress)}${abiUint(1000n)}`;
    const parsed = parseEthSendTransactionParams([{ to: tokenAddress, data }], connectedAddress);

    await expect(prepareDappEvmTransactionForApproval("ethereum", parsed))
      .rejects.toThrow("eth_call failed: execution reverted");
  });

  it("rejects mismatched from addresses", () => {
    expect(() => parseEthSendTransactionParams([{
      from: "0x0000000000000000000000000000000000000002",
      to: "0x0000000000000000000000000000000000000001"
    }], connectedAddress)).toThrow("Transaction sender does not match connected account");
  });

  it("formats wei values for persisted transaction history", () => {
    expect(formatDappTransactionValue(1000000000000000000n)).toBe("1");
    expect(formatDappTransactionValue(1234500000000000000n)).toBe("1.2345");
  });
});

function abiAddress(address: string): string {
  return `${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function abiUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function erc20ResultForData(data: string | undefined): string | undefined {
  if (data === erc20InfoInterface.encodeFunctionData("name").toLowerCase()) {
    return erc20InfoInterface.encodeFunctionResult("name", ["Tether USD"]);
  }
  if (data === erc20InfoInterface.encodeFunctionData("symbol").toLowerCase()) {
    return erc20InfoInterface.encodeFunctionResult("symbol", ["USDt"]);
  }
  if (data === erc20InfoInterface.encodeFunctionData("decimals").toLowerCase()) {
    return erc20InfoInterface.encodeFunctionResult("decimals", [6]);
  }
  if (data?.startsWith(erc20InfoInterface.getFunction("allowance")?.selector ?? "")) {
    return erc20InfoInterface.encodeFunctionResult("allowance", [250n]);
  }
  return undefined;
}
