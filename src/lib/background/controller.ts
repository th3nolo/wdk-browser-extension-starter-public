import { expireIdleSession, initSession } from "../session/session";
import { readStore } from "../storage/store";
import {
  approveDappConnection,
  rejectDappConnection,
  revokeDappConnection
} from "./connected-sites";
import { handleDappRequest } from "./dapp-rpc";
import { recordDappMessageTarget } from "./dapp-targets";
import {
  approveDappSignature,
  approveDappTransaction,
  initDappApprovalWorkflow,
  rejectDappSignature,
  rejectDappTransactionApproval
} from "./dapp-approval-workflow";
import { assertAllowedMessageContext } from "./message-acl";
import type { BackgroundMessage } from "./messages";
import { openQrScannerWindow, setPendingScan, takePendingScan } from "./qr-scan";
import { submitPopupSendRequest } from "./send-request-lifecycle";
import { fullWalletState, refreshStoredTransactionStatuses, walletBalances, walletSummaryState } from "./wallet-summary";
import {
  addWalletAccount,
  createWallet,
  deleteWallet,
  importWallet,
  lockActiveWallet,
  requireUnlockedWalletSession,
  setWalletRpcOverride,
  switchWallet,
  unlockDefaultWallet
} from "./wallet-lifecycle";

type DappRequestMessage = Extract<BackgroundMessage, { type: "DAPP_REQUEST" }>;
type PopupCommandMessage = Exclude<BackgroundMessage, DappRequestMessage>;
type BackgroundCommandHandler<K extends PopupCommandMessage["type"]> = (message: Extract<PopupCommandMessage, { type: K }>) => Promise<unknown> | unknown;
type BackgroundCommandHandlers = { [K in PopupCommandMessage["type"]]: BackgroundCommandHandler<K> };

function dispatchBackgroundMessage(message: PopupCommandMessage, handlers: BackgroundCommandHandlers): Promise<unknown> | unknown {
  const handler = handlers[message.type] as (message: PopupCommandMessage) => Promise<unknown> | unknown;
  if (!handler) throw new Error("Unsupported message");
  return handler(message);
}

function createBackgroundCommandHandlers(): BackgroundCommandHandlers {
  return {
    GET_STATE: () => fullWalletState(),
    GET_STATE_SUMMARY: () => walletSummaryState(),
    GET_BALANCES: () => walletBalances(),

    CREATE_WALLET: (message) => createWallet(message.name, message.password, message.seedPhrase),
    IMPORT_WALLET: (message) => importWallet(message.name, message.password, message.seedPhrase),
    UNLOCK: (message) => unlockDefaultWallet(message.password),
    SWITCH_WALLET: (message) => switchWallet(message.walletId, message.password),
    LOCK: () => lockActiveWallet(),
    DELETE_WALLET: (message) => deleteWallet(message.walletId, message.password),
    ADD_ACCOUNT: (message) => addWalletAccount(message.walletId),
    REFRESH: async () => {
      requireUnlockedWalletSession((await readStore()).activeWalletId);
      return fullWalletState();
    },

    APPROVE_DAPP: async (message) => {
      await approveDappConnection(message.origin, message.accountIndexes ?? [message.accountIndex]);
      return walletSummaryState();
    },
    REJECT_DAPP: async (message) => {
      await rejectDappConnection(message.origin);
      return walletSummaryState();
    },
    REVOKE_DAPP: async (message) => {
      await revokeDappConnection(message.origin);
      return walletSummaryState();
    },

    APPROVE_SIGNATURE: async (message) => {
      await approveDappSignature(message.id);
      return walletSummaryState();
    },
    REJECT_SIGNATURE: async (message) => {
      await rejectDappSignature(message.id);
      return walletSummaryState();
    },
    APPROVE_DAPP_TRANSACTION: async (message) => {
      await approveDappTransaction(message.id);
      return walletSummaryState();
    },
    REJECT_DAPP_TRANSACTION: async (message) => {
      await rejectDappTransactionApproval(message.id);
      return walletSummaryState();
    },

    SEND: (message) => submitPopupSendRequest(message.request),
    SET_RPC_OVERRIDE: (message) => setWalletRpcOverride(message.chain, message.url),

    OPEN_QR_SCANNER: async () => { await openQrScannerWindow(); return null; },
    SUBMIT_QR_SCAN: async (message) => { await setPendingScan(message.value); return null; },
    TAKE_QR_SCAN: () => takePendingScan()
  };
}

async function handleProviderRequest(message: DappRequestMessage, origin: string, sender: Browser.runtime.MessageSender): Promise<unknown> {
  await recordDappMessageTarget(origin, sender);
  return handleDappRequest(message, origin);
}

export function createBackgroundWalletController() {
  let ready: Promise<void> | undefined;
  const ensureReady = () => {
    ready ??= Promise.all([initSession(), initDappApprovalWorkflow()]).then(() => {});
    return ready;
  };

  return {
    async initialize() {
      await ensureReady();
    },
    async handleMessage(message: BackgroundMessage, sender: Browser.runtime.MessageSender) {
      await ensureReady();
      const context = assertAllowedMessageContext(message, sender);
      if (context.kind === "dapp") return handleProviderRequest(context.message, context.origin, context.sender);
      return dispatchBackgroundMessage(context.message, createBackgroundCommandHandlers());
    },
    async expireIdleSession() {
      await ensureReady();
      await expireIdleSession();
    },
    async refreshPendingTransactions() {
      await ensureReady();
      await refreshStoredTransactionStatuses();
    }
  };
}
