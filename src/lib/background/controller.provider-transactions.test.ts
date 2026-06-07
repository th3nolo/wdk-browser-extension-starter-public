import { describe, expect, it, vi } from "vitest";
import { createSession } from "../session/session";
import { DAPP_PROVIDER_EVENT_MESSAGE } from "./dapp-provider-events";
import { createBackgroundWalletController } from "./controller";
import { PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { createControllerTestHarness, dappSender, POPUP_SENDER } from "./controller-test-harness";
import {
  prepareDappTransactionForApproval,
  signDappSignatureForApproval,
  submitDappTransactionForApproval
} from "./wallet-execution";
import type { PopupState } from "../types";

vi.mock("./wallet-execution", () => ({
  connectedAccountForWallet: vi.fn(),
  listBalancesForWalletAccounts: vi.fn(),
  listWalletAccounts: vi.fn(),
  prepareDappTransactionForApproval: vi.fn(),
  signDappSignatureForApproval: vi.fn(),
  submitDappTransactionForApproval: vi.fn(),
  submitSendRequest: vi.fn(),
  validateDappTransactionForApproval: vi.fn()
}));

const harness = createControllerTestHarness();

describe("background wallet controller - provider methods and transactions", () => {
  it("returns the per-origin EVM chain ID instead of always mainnet", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 137,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_chainId"
    }, dappSender("https://dapp.example"))).resolves.toBe("0x89");
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_chainId"
    }, dappSender("https://other.example"))).resolves.toBe("0x1");
  });

  it("proxies validated read-only EVM RPC methods for connected origins", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      rpcOverrides: { ethereum: "https://rpc.override.example" },
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 1,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    await createSession("wallet-1", "test seed phrase");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      const results: Record<string, unknown> = {
        eth_blockNumber: "0x7",
        eth_getBalance: "0x10",
        eth_call: "0x",
        eth_estimateGas: "0x5208",
        eth_gasPrice: "0x3b9aca00",
        eth_feeHistory: { oldestBlock: "0x7", baseFeePerGas: ["0x1"], gasUsedRatio: [0] },
        eth_getTransactionCount: "0x1",
        eth_getTransactionReceipt: null,
        eth_getCode: "0x"
      };
      return { ok: true, json: async () => ({ result: results[body.method] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = createBackgroundWalletController();
    const sender = dappSender("https://dapp.example");
    const account = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "net_version" }, sender)).resolves.toBe("1");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_blockNumber" }, sender)).resolves.toBe("0x7");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_getBalance", params: [account, "latest"] }, sender)).resolves.toBe("0x10");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_call", params: [{ to: account, data: "0x" }, "latest"] }, sender)).resolves.toBe("0x");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_estimateGas", params: [{ to: account, value: "0x0" }] }, sender)).resolves.toBe("0x5208");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_gasPrice" }, sender)).resolves.toBe("0x3b9aca00");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_feeHistory", params: ["0x1", "latest", [50]] }, sender)).resolves.toEqual({
      oldestBlock: "0x7",
      baseFeePerGas: ["0x1"],
      gasUsedRatio: [0]
    });
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_getTransactionCount", params: [account, "latest"] }, sender)).resolves.toBe("0x1");
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_getTransactionReceipt", params: [`0x${"11".repeat(32)}`] }, sender)).resolves.toBeNull();
    await expect(controller.handleMessage({ type: "DAPP_REQUEST", method: "eth_getCode", params: [account, "latest"] }, sender)).resolves.toBe("0x");

    const ethCallBody = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => String(init?.body).includes('"eth_call"'))?.[1]?.body)) as { params: Array<Record<string, unknown>> };
    expect(ethCallBody.params[0].from).toBe(account);
    expect(fetchMock.mock.calls.every(([url]) => url === "https://rpc.override.example")).toBe(true);
  });

  it("requires an unlocked connected origin for read-only EVM RPC proxy methods", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 1,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_blockNumber"
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      message: "Wallet is locked"
    });

    await createSession("wallet-1", "test seed phrase");
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_blockNumber"
    }, dappSender("https://other.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      message: "Site is not connected to this wallet"
    });
  });

  it("rejects read-only transaction simulation params that spoof the connected account", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_call",
      params: [{ from: "0x0000000000000000000000000000000000000002", to: "0x0000000000000000000000000000000000000001", data: "0x" }, "latest"]
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: -32602,
      message: "eth_call from must match the connected account"
    });
  });

  it("propagates read-only RPC errors with their JSON-RPC code and data", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ error: { code: -32000, message: "execution reverted", data: "0x08c379a0" } })
    } as Response)));
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_call",
      params: [{ to: "0x0000000000000000000000000000000000000001", data: "0x" }, "latest"]
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: -32000,
      message: "execution reverted",
      data: "0x08c379a0"
    });
  });

  it("switches the connected origin to a supported EVM chain", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 1,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x89" }]
    }, dappSender("https://dapp.example"))).resolves.toBeNull();

    expect(harness.persisted.connectedSites[0].evmChainId).toBe(137);
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_chainId"
    }, dappSender("https://dapp.example"))).resolves.toBe("0x89");
  });

  it("rejects unsupported wallet_switchEthereumChain requests", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 1,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x3e7" }]
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      message: "Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first."
    });
  });

  it("rejects malformed wallet_switchEthereumChain params with EIP-1193 codes", async () => {
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "wallet_switchEthereumChain",
      params: []
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      message: "Invalid wallet_switchEthereumChain params"
    });
  });

  it("signs personal_sign on the connected origin's active EVM chain", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        evmChainId: 42161,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures[0].verification).toMatchObject({
      kind: "personal_sign",
      algorithm: "eip191-personal-sign",
      messageDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      requestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      verifiedByVectors: true
    });
    await controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER);

    await expect(signature).resolves.toBe("0xsigned");
    expect(signDappSignatureForApproval).toHaveBeenCalledWith(
      "wallet-1",
      "arbitrum",
      expect.objectContaining({ accountIndex: 0, message: "Sign in to WDK demo", messageEncoding: "utf8" }),
      expect.objectContaining({ activeWalletId: "wallet-1" })
    );
  });

  it("queues hex-encoded personal_sign with raw bytes for signing and UTF-8 for display", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["0x48656c6c6f", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures[0]).toMatchObject({
      message: "0x48656c6c6f",
      displayMessage: "Hello",
      messageEncoding: "hex",
      messageByteLength: 5,
      verification: expect.objectContaining({
        kind: "personal_sign",
        messageEncoding: "hex",
        messageDigest: "0xaa744ba2ca576ec62ca0045eca00ad3917fdf7ffa34fbbae50828a5a69c1580e"
      })
    });
    await controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER);

    await expect(signature).resolves.toBe("0xsigned");
    expect(signDappSignatureForApproval).toHaveBeenCalledWith(
      "wallet-1",
      "ethereum",
      expect.objectContaining({ accountIndex: 0, message: "0x48656c6c6f", messageEncoding: "hex" }),
      expect.objectContaining({ activeWalletId: "wallet-1" })
    );
  });

  it("accepts personal_sign params in [address, message] order", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    void controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94", "0x48656c6c6f"]
    }, dappSender("https://dapp.example"));

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures[0].message).toBe("0x48656c6c6f");
    expect(state.pendingSignatures[0].displayMessage).toBe("Hello");
  });

  it("rejects eth_signTypedData_v4 when domain.chainId does not match the connected chain", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_signTypedData_v4",
      params: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94", {
        types: {
          EIP712Domain: [{ name: "chainId", type: "uint256" }],
          Mail: [{ name: "contents", type: "string" }]
        },
        primaryType: "Mail",
        domain: { chainId: 42161 },
        message: { contents: "Hello" }
      }]
    }, dappSender("https://dapp.example"))).rejects.toThrow("domain.chainId (42161) does not match connected chain (1)");
  });

  it("queues eth_signTypedData_v3 with the original request kind and signs typed data on approval", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_signTypedData_v3",
      params: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94", {
        types: {
          EIP712Domain: [{ name: "chainId", type: "uint256" }],
          Mail: [{ name: "contents", type: "string" }]
        },
        primaryType: "Mail",
        domain: { chainId: 1 },
        message: { contents: "Hello" }
      }]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures[0].kind).toBe("eth_signTypedData_v3");
    expect(state.pendingSignatures[0].verification).toMatchObject({
      kind: "eth_signTypedData_v3",
      algorithm: "eip712",
      finalDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      domainSeparator: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      messageHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      primaryType: "Mail",
      verifiedByVectors: true
    });
    await controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER);

    await expect(signature).resolves.toBe("0xtyped");
    expect(signDappSignatureForApproval).toHaveBeenCalledWith(
      "wallet-1",
      "ethereum",
      expect.objectContaining({ accountIndex: 0, signatureKind: "eth_signTypedData_v3", typedData: expect.objectContaining({ primaryType: "Mail" }) }),
      expect.objectContaining({ activeWalletId: "wallet-1" })
    );
  });

  it("queues eth_signTypedData_v4 until the popup approves the signature request", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    void controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_signTypedData_v4",
      params: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94", {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" }
          ],
          Mail: [{ name: "contents", type: "string" }]
        },
        primaryType: "Mail",
        domain: {
          name: "Example",
          version: "1",
          chainId: 1,
          verifyingContract: "0x0000000000000000000000000000000000000001"
        },
        message: { contents: "Hello" }
      }]
    }, dappSender("https://dapp.example"));

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures[0].kind).toBe("eth_signTypedData_v4");
    expect(state.pendingSignatures[0].typedData?.primaryType).toBe("Mail");
    expect(state.pendingSignatures[0].verification).toMatchObject({
      kind: "eth_signTypedData_v4",
      algorithm: "eip712",
      primaryType: "Mail",
      requestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      finalDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/)
    });
  });

  it("rejects empty personal_sign messages", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example"))).rejects.toThrow("cannot be empty");
  });

  it("rejects signature approval after the site is revoked", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    void controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example"));

    const state = await waitForPendingSignature(controller);
    await controller.handleMessage({ type: "REVOKE_DAPP", origin: "https://dapp.example" }, POPUP_SENDER);

    await expect(controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER))
      .rejects.toThrow("Site is not connected to this wallet");
  });

  it("queues, approves, and persists eth_sendTransaction requests", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const tx = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", to: "0x0000000000000000000000000000000000000001", value: "0xde0b6b3a7640000" }]
    }, dappSender("https://dapp.example/path")) as Promise<string>;

    const state = await waitForPendingDappTransaction(controller);
    expect(state.pendingTransactions[0]).toMatchObject({
      origin: "https://dapp.example",
      walletId: "wallet-1",
      accountIndex: 0,
      chain: "ethereum",
      to: "0x0000000000000000000000000000000000000001",
      value: "1000000000000000000",
      gasLimit: "21000",
      review: expect.objectContaining({ kind: "native-transfer", simulation: expect.objectContaining({ status: "passed" }) }),
      verification: expect.objectContaining({
        kind: "eth_sendTransaction",
        algorithm: "erc8213-calldata-digest",
        calldataDigest: null,
        dataByteLength: 0,
        requestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        verifiedByVectors: true
      })
    });
    expect(prepareDappTransactionForApproval).toHaveBeenCalledWith(
      "ethereum",
      expect.objectContaining({ value: 1000000000000000000n })
    );

    const approved = await controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: state.pendingTransactions[0].id }, POPUP_SENDER) as PopupState;

    await expect(tx).resolves.toBe("0xtxhash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledWith(
      "wallet-1",
      "ethereum",
      0,
      expect.objectContaining({ value: 1000000000000000000n }),
      expect.objectContaining({ activeWalletId: "wallet-1" })
    );
    expect(harness.persisted.transactions[0]).toMatchObject({ walletId: "wallet-1", chain: "ethereum", asset: "ETH", amount: "1", txHash: "0xtxhash" });
    expect(approved.pendingTransactions).toHaveLength(0);
  });

  it("rejects eth_sendTransaction requests from the popup queue", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const tx = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x0" }]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingDappTransaction(controller);
    await controller.handleMessage({ type: "REJECT_DAPP_TRANSACTION", id: state.pendingTransactions[0].id }, POPUP_SENDER);

    await expect(tx).rejects.toThrow("User rejected transaction request");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("rejects eth_sendTransaction when from does not match the connected account", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ from: "0x0000000000000000000000000000000000000002", to: "0x0000000000000000000000000000000000000001" }]
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      message: "Requested account is not connected to this site"
    });

    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("rejects unsupported contract calldata before queuing eth_sendTransaction approval", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    vi.mocked(prepareDappTransactionForApproval).mockRejectedValueOnce(new Error(
      "Contract dApp transactions are not supported until calldata decoding and simulation are available"
    ));
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x0", data: "0x12345678" }]
    }, dappSender("https://dapp.example"))).rejects.toThrow("Contract dApp transactions are not supported until calldata decoding and simulation are available");

    const state = await controller.handleMessage({ type: "GET_STATE_SUMMARY" }, POPUP_SENDER) as PopupState;
    expect(state.pendingTransactions).toHaveLength(0);
    expect(prepareDappTransactionForApproval).toHaveBeenCalled();
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("rejects dapp gas overrides before queuing eth_sendTransaction approval", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x0", gas: "0x5208" }]
    }, dappSender("https://dapp.example"))).rejects.toThrow("Unsupported gas in dApp transaction request");

    const state = await controller.handleMessage({ type: "GET_STATE_SUMMARY" }, POPUP_SENDER) as PopupState;
    expect(state.pendingTransactions).toHaveLength(0);
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("rejects contract recipients before queuing eth_sendTransaction approval", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    vi.mocked(prepareDappTransactionForApproval).mockRejectedValueOnce(new Error(
      "Contract dApp transactions are not supported until calldata decoding and simulation are available"
    ));
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_sendTransaction",
      params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x0" }]
    }, dappSender("https://dapp.example"))).rejects.toThrow("Contract dApp transactions are not supported until calldata decoding and simulation are available");

    const state = await controller.handleMessage({ type: "GET_STATE_SUMMARY" }, POPUP_SENDER) as PopupState;
    expect(state.pendingTransactions).toHaveLength(0);
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("switches the connected origin when wallet_addEthereumChain names a preconfigured chain", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x89" }]
    }, dappSender("https://dapp.example"))).resolves.toBeNull();

    expect(harness.persisted.connectedSites[0].evmChainId).toBe(137);
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "chainChanged",
      chainId: "0x89"
    }, {});
  });
});

async function waitForPendingSignature(controller: ReturnType<typeof createBackgroundWalletController>) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;
    if (state.pendingSignatures.length) return state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as Promise<PopupState>;
}

async function waitForPendingDappTransaction(controller: ReturnType<typeof createBackgroundWalletController>) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;
    if (state.pendingTransactions.length) return state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as Promise<PopupState>;
}
