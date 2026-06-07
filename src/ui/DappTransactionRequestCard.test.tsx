/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DappTransactionRequestCard } from "./DappTransactionRequestCard";
import type { DappTransactionRequest } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const passedSimulation = {
  status: "passed",
  gasEstimate: "21000",
  rpcEvidence: {
    gasEstimateMethod: "eth_estimateGas",
    simulationMethod: "eth_call",
    blockTag: "latest",
    gasEstimateHex: "0x5208",
    simulationResult: "0x"
  }
} as const;
const feeEstimate = {
  type: "eip1559",
  gasLimit: "21000",
  maxFeePerGas: "3000000000",
  maxPriorityFeePerGas: "1000000000",
  maxNativeFee: "63000000000000",
  source: "eth_feeHistory"
} as const;

const baseRequest: DappTransactionRequest = {
  id: "tx-1",
  origin: "https://dapp.example",
  walletId: "wallet-1",
  accountIndex: 0,
  chain: "ethereum",
  to: "0x0000000000000000000000000000000000000001",
  value: "1000000000000000000",
  gasLimit: "21000",
  verification: {
    kind: "eth_sendTransaction",
    requestDigest: `0x${"11".repeat(32)}`,
    requestByteLength: 120,
    calldataDigest: null,
    target: "0x0000000000000000000000000000000000000001",
    value: "1000000000000000000",
    dataByteLength: 0,
    source: "raw-dapp-request",
    algorithm: "erc8213-calldata-digest",
    verifiedByVectors: true,
    vectorSet: "wysiwys-v1"
  },
  review: {
    kind: "native-transfer",
    title: "Native transfer",
    to: "0x0000000000000000000000000000000000000001",
    value: "1000000000000000000",
    feeEstimate,
    simulation: passedSimulation
  },
  requestedAt: "2026-05-30T12:00:00.000Z"
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("DappTransactionRequestCard", () => {
  it("renders native transfer details without calldata warnings", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <DappTransactionRequestCard request={baseRequest} busy={false} onApprove={vi.fn()} onReject={vi.fn()} />
      );
    });

    expect(container.textContent).toContain("Transaction request from https://dapp.example");
    expect(container.textContent).toContain("Unknown contract calldata");
    expect(container.textContent).toContain("0x0000000000000000000000000000000000000001");
    expect(container.textContent).toContain("1 ETH");
    expect(container.textContent).toContain("Max fee estimate");
    expect(container.textContent).toContain("0.000063 ETH");
    expect(container.textContent).toContain("max 3 gwei; priority 1 gwei");
    expect(container.textContent).toContain("RPC preflight passed");
    expect(container.textContent).toContain("eth_estimateGas + eth_call at latest");
    expect(container.textContent).toContain("Verification details");
    expect(container.textContent).toContain("Vector verified");
    expect(container.textContent).toContain("Request digest");
    expect(container.textContent).toContain("No calldata");
    expect(container.textContent).not.toContain("Calldata0x");
  });

  it("renders decoded ERC-20 approval review details", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <DappTransactionRequestCard
          request={{
            ...baseRequest,
            value: "0",
            data: "0x095ea7b3",
            verification: {
              ...baseRequest.verification!,
              calldataDigest: `0x${"22".repeat(32)}`,
              dataByteLength: 4,
              value: "0"
            },
            review: {
              kind: "erc20-approval",
              title: "ERC-20 approval",
              token: "0x0000000000000000000000000000000000000003",
              tokenMetadata: {
                name: "Tether USD",
                symbol: "USDt",
                decimals: 6
              },
              spender: "0x0000000000000000000000000000000000000004",
              amount: "1000",
              currentAllowance: "250",
              allowanceDelta: "750",
              unlimited: false,
              rawData: "0x095ea7b3",
              feeEstimate,
              simulation: passedSimulation
            }
          }}
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("ERC-20 approval");
    expect(container.textContent).toContain("USDt");
    expect(container.textContent).toContain("Token decimals");
    expect(container.textContent).toContain("Spender");
    expect(container.textContent).toContain("Current allowance");
    expect(container.textContent).toContain("+750 raw token units");
    expect(container.textContent).toContain("1000 raw token units");
    expect(container.textContent).toContain("Calldata");
    expect(container.textContent).toContain("Calldata digest");
    expect(container.textContent).toContain(`0x${"22".repeat(32)}`);
  });

  it("renders decoded protocol transaction review details", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <DappTransactionRequestCard
          request={{
            ...baseRequest,
            value: "0",
            data: "0x617ba037",
            review: {
              kind: "aave-action",
              title: "Aave action",
              action: "supply",
              pool: "0x0000000000000000000000000000000000000006",
              asset: "0x0000000000000000000000000000000000000003",
              amount: "1000",
              beneficiary: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
              rawData: "0x617ba037",
              feeEstimate,
              simulation: passedSimulation
            }
          }}
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Aave action");
    expect(container.textContent).toContain("Pool");
    expect(container.textContent).toContain("Beneficiary");
    expect(container.textContent).toContain("1000 raw token units");
  });

  it("calls approve and reject handlers from action buttons", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <DappTransactionRequestCard request={baseRequest} busy={false} onApprove={onApprove} onReject={onReject} />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const approveButton = buttons.find((button) => button.textContent === "Send") as HTMLButtonElement;
    const rejectButton = buttons.find((button) => button.textContent === "Reject") as HTMLButtonElement;
    await act(async () => {
      approveButton.click();
    });
    expect(onApprove).toHaveBeenCalledOnce();

    await act(async () => {
      rejectButton.click();
    });
    expect(onReject).toHaveBeenCalledOnce();
  });
});
