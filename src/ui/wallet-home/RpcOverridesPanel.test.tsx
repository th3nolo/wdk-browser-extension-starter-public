/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PopupState, PopupSummaryState } from "../../lib/types";
import { sendMessage } from "../api";
import { createUiTestHarness } from "../test-utils";
import type { PopupActionRunner } from "../usePopupState";
import { RpcOverridesPanel } from "./RpcOverridesPanel";

vi.mock("../api", async () => {
  const { createWalletClient } = await import("../../sdk");
  const sendMessage = vi.fn();
  return { sendMessage, walletClient: createWalletClient(sendMessage) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedSendMessage = vi.mocked(sendMessage);

let container: HTMLDivElement;
let root: Root;
let state: PopupState;
let error = "";
let ui: ReturnType<typeof createUiTestHarness>;

beforeEach(() => {
  state = unlockedState();
  error = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  ui = createUiTestHarness(container);
  mockedSendMessage.mockImplementation(async (message) => {
    if (message.type !== "SET_RPC_OVERRIDE") return state;
    if (message.url === "https://denied.example") {
      throw new Error("Host permission for the custom RPC endpoint was denied");
    }
    state = {
      ...state,
      rpcOverrides: message.url
        ? { ...(state.rpcOverrides ?? {}), [message.chain]: message.url }
        : Object.fromEntries(Object.entries(state.rpcOverrides ?? {}).filter(([chain]) => chain !== message.chain))
    };
    return state;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("RpcOverridesPanel", () => {
  it("saves and clears an approved RPC override", async () => {
    await renderPanel();

    await ui.setField("RPC endpoint", "https://rpc.example");
    await ui.clickButton("Save RPC");

    expect(mockedSendMessage).toHaveBeenLastCalledWith({
      type: "SET_RPC_OVERRIDE",
      chain: "ethereum",
      url: "https://rpc.example"
    });
    await ui.waitForText("https://rpc.example");

    await ui.clickButton("Clear");

    expect(mockedSendMessage).toHaveBeenLastCalledWith({
      type: "SET_RPC_OVERRIDE",
      chain: "ethereum",
      url: undefined
    });
    await ui.waitForText("Default RPC");
  });

  it("shows permission denied without saving the override", async () => {
    await renderPanel();

    await ui.setField("RPC endpoint", "https://denied.example");
    await ui.clickButton("Save RPC");

    await ui.waitForText("Host permission for the custom RPC endpoint was denied");
    expect(container.textContent).toContain("Default RPC");
    expect(container.textContent).not.toContain("https://denied.example");
  });

  it("blocks invalid RPC override URLs before sending", async () => {
    await renderPanel();

    await ui.setField("RPC endpoint", "ftp://rpc.example");

    await ui.waitForText("RPC URL must be a valid https endpoint or local dev URL");
    expect(ui.buttonByText("Save RPC").disabled).toBe(true);
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });
});

async function renderPanel() {
  const run: PopupActionRunner = async (action) => {
    error = "";
    try {
      return await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unexpected wallet error";
      rerender(run, onState);
      return undefined;
    }
  };
  const onState = (next: PopupSummaryState | PopupState) => {
    state = { ...state, ...next };
    rerender(run, onState);
  };
  await act(async () => {
    root = createRoot(container);
    rerender(run, onState);
  });
}

function rerender(run: PopupActionRunner, onState: (next: PopupSummaryState | PopupState) => void) {
  root.render(
    <>
      {error && <p className="error">{error}</p>}
      <RpcOverridesPanel state={state} busy={false} run={run} onState={onState} />
    </>
  );
}

function unlockedState(): PopupState {
  return {
    locked: false,
    hasVault: true,
    wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
    activeWalletId: "wallet-1",
    accounts: [],
    balances: [],
    transactions: [],
    connectedSites: [],
    pendingConnections: [],
    pendingSignatures: [],
    pendingTransactions: []
  };
}
