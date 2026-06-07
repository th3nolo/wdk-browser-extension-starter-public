import { beforeEach, vi } from "vitest";
import { peekSession, resetSessionForTests } from "../session/session";
import type { StoredState } from "../storage/store";
import { resetPendingSignaturesForTests } from "./pending-signatures";
import {
  connectedAccountForWallet,
  listBalancesForWalletAccounts,
  listWalletAccounts,
  prepareDappTransactionForApproval,
  signDappSignatureForApproval,
  submitDappTransactionForApproval,
  submitSendRequest,
  validateDappTransactionForApproval
} from "./wallet-execution";

const STORE_KEY = "wdk-wallet-state";
const EXTENSION_ID = "test-extension";

export const POPUP_SENDER: Browser.runtime.MessageSender = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/popup.html`
};

export function dappSender(
  tabUrl: string,
  options: { tabId?: number; documentId?: string; frameId?: number } = {}
): Browser.runtime.MessageSender {
  return {
    id: EXTENSION_ID,
    tab: { id: options.tabId ?? 1, url: tabUrl } as Browser.tabs.Tab,
    url: tabUrl,
    documentId: options.documentId,
    frameId: options.frameId
  };
}

export function createControllerTestHarness() {
  const state: {
    persisted: StoredState;
    sessionStorage: Record<string, unknown>;
    tabsSendMessage: ReturnType<typeof vi.fn>;
  } = {
    persisted: defaultStoredState(),
    sessionStorage: {},
    tabsSendMessage: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetWalletExecutionMocks();
    state.sessionStorage = {};
    resetSessionForTests();
    resetPendingSignaturesForTests();
    state.persisted = defaultStoredState();
    state.tabsSendMessage = vi.fn(async () => undefined);

    vi.stubGlobal("browser", {
      runtime: {
        id: EXTENSION_ID,
        getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`
      },
      tabs: {
        query: vi.fn(async () => [{ id: 1 }]),
        sendMessage: state.tabsSendMessage
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ [STORE_KEY]: state.persisted })),
          set: vi.fn(async (next: Record<string, StoredState>) => {
            state.persisted = next[STORE_KEY];
          })
        },
        session: {
          get: vi.fn(async (key?: string | string[] | Record<string, unknown> | null) => {
            if (typeof key === "string") return { [key]: state.sessionStorage[key] };
            return { ...state.sessionStorage };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(state.sessionStorage, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete state.sessionStorage[key];
          })
        }
      }
    });

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { method?: string } : {};
      return {
        ok: true,
        json: async () => body.method === "eth_getCode" ? { result: "0x" } : { result: { status: "0x1" } }
      };
    }));
  });

  return {
    get persisted() {
      return state.persisted;
    },
    set persisted(next: StoredState) {
      state.persisted = next;
    },
    get sessionStorage() {
      return state.sessionStorage;
    },
    get tabsSendMessage() {
      return state.tabsSendMessage;
    }
  };
}

function resetWalletExecutionMocks(): void {
  vi.mocked(listWalletAccounts).mockReset();
  vi.mocked(listWalletAccounts).mockImplementation(async (wallet) => {
    if (peekSession()?.walletId !== wallet.id) return undefined;
    return [{
      walletId: wallet.id,
      chain: "ethereum",
      index: 0,
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      path: "m/44'/60'/0'/0/0"
    }];
  });
  vi.mocked(connectedAccountForWallet).mockReset();
  vi.mocked(connectedAccountForWallet).mockImplementation(async (wallet, chain, accountIndex) => {
    if (peekSession()?.walletId !== wallet.id) return { status: "locked" };
    return {
      status: "connected",
      account: {
        walletId: wallet.id,
        chain,
        index: accountIndex,
        address: accountIndex === 1 ? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" : "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        path: `m/44'/60'/0'/0/${accountIndex}`
      }
    };
  });
  vi.mocked(listBalancesForWalletAccounts).mockReset();
  vi.mocked(listBalancesForWalletAccounts).mockResolvedValue([]);
  vi.mocked(submitSendRequest).mockReset();
  vi.mocked(submitSendRequest).mockImplementation(async (request) => ({
    id: "tx-new",
    walletId: request.walletId,
    chain: request.chain,
    asset: request.asset,
    from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    to: request.to,
    amount: request.amount,
    status: "pending",
    txHash: "0xdef",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  vi.mocked(validateDappTransactionForApproval).mockReset();
  vi.mocked(validateDappTransactionForApproval).mockResolvedValue(undefined);
  vi.mocked(prepareDappTransactionForApproval).mockReset();
  vi.mocked(prepareDappTransactionForApproval).mockImplementation(async (_chain, tx) => ({
    ...tx,
    gasLimit: tx.gasLimit ?? 21000n,
    review: tx.review ?? {
      kind: "native-transfer",
      title: "Native transfer",
      to: tx.to,
      value: tx.value.toString(),
      feeEstimate: {
        type: "eip1559",
        gasLimit: "21000",
        maxFeePerGas: "3000000000",
        maxPriorityFeePerGas: "1000000000",
        maxNativeFee: "63000000000000",
        source: "eth_feeHistory"
      },
      simulation: {
        status: "passed",
        gasEstimate: "21000",
        rpcEvidence: {
          gasEstimateMethod: "eth_estimateGas",
          simulationMethod: "eth_call",
          blockTag: "latest",
          gasEstimateHex: "0x5208",
          simulationResult: "0x"
        }
      }
    }
  }));
  vi.mocked(signDappSignatureForApproval).mockReset();
  vi.mocked(signDappSignatureForApproval).mockImplementation(async (_walletId, _chain, request) =>
    request.signatureKind === "personal_sign" ? "0xsigned" : "0xtyped"
  );
  vi.mocked(submitDappTransactionForApproval).mockReset();
  vi.mocked(submitDappTransactionForApproval).mockResolvedValue("0xtxhash");
}

function defaultStoredState(): StoredState {
  return {
    vaults: {},
    wallets: [],
    transactions: [
      {
        id: "tx-pending",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        to: "0x0000000000000000000000000000000000000001",
        amount: "1",
        status: "pending",
        txHash: "0xabc",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    connectedSites: [],
    pendingConnections: []
  };
}
