/**
 * The curated, typed command surface the UI shell uses to talk to the wallet
 * core. The UI never builds raw wire messages or inspects error responses —
 * every command is a method here, and the central error unwrap (an
 * `isBackgroundErrorResponse` response becomes a thrown `Error`) lives ONLY in
 * `request` below.
 */
import type { SendRequest } from "../lib/types";
import {
  BACKGROUND_ERROR_RESPONSE_KEY,
  isBackgroundErrorResponse,
  type ChainId,
  type WalletRequest,
  type WalletResponseMap
} from "./contract";

export type WalletTransport = (message: WalletRequest) => Promise<unknown>;

export type WalletClient = ReturnType<typeof createWalletClient>;

export function createWalletClient(transport: WalletTransport) {
  /** Sole place the error contract is unwrapped into a thrown Error. */
  async function request<K extends keyof WalletResponseMap>(
    message: Extract<WalletRequest, { type: K }>
  ): Promise<WalletResponseMap[K]> {
    const response = await transport(message);
    if (isBackgroundErrorResponse(response)) {
      throw new Error(response[BACKGROUND_ERROR_RESPONSE_KEY].message);
    }
    return response as WalletResponseMap[K];
  }

  return {
    getState: () => request({ type: "GET_STATE" }),
    getSummary: () => request({ type: "GET_STATE_SUMMARY" }),
    getBalances: () => request({ type: "GET_BALANCES" }),

    createWallet: (name: string, password: string, seedPhrase: string) =>
      request({ type: "CREATE_WALLET", name, password, seedPhrase }),
    importWallet: (name: string, password: string, seedPhrase: string) =>
      request({ type: "IMPORT_WALLET", name, password, seedPhrase }),
    unlock: (password: string) => request({ type: "UNLOCK", password }),
    switchWallet: (id: string, password: string) =>
      request({ type: "SWITCH_WALLET", walletId: id, password }),
    lock: () => request({ type: "LOCK" }),
    deleteWallet: (id: string, password: string) =>
      request({ type: "DELETE_WALLET", walletId: id, password }),
    addAccount: (walletId: string) => request({ type: "ADD_ACCOUNT", walletId }),
    refresh: () => request({ type: "REFRESH" }),

    connectApprove: (origin: string, accountIndexes: number[]) =>
      request({
        type: "APPROVE_DAPP",
        origin,
        accountIndex: accountIndexes[0] ?? 0,
        accountIndexes
      }),
    connectReject: (origin: string) => request({ type: "REJECT_DAPP", origin }),
    revoke: (origin: string) => request({ type: "REVOKE_DAPP", origin }),

    approveSignature: (id: string) => request({ type: "APPROVE_SIGNATURE", id }),
    rejectSignature: (id: string) => request({ type: "REJECT_SIGNATURE", id }),
    approveTransaction: (id: string) => request({ type: "APPROVE_DAPP_TRANSACTION", id }),
    rejectTransaction: (id: string) => request({ type: "REJECT_DAPP_TRANSACTION", id }),

    send: (sendRequest: SendRequest) => request({ type: "SEND", request: sendRequest }),
    setRpcOverride: (chain: ChainId, url?: string) =>
      request({ type: "SET_RPC_OVERRIDE", chain, url }),

    /** Open the camera QR scanner in a dedicated window (popup can't grant camera). */
    openScanner: () => request({ type: "OPEN_QR_SCANNER" }),
    /** Called from the scanner window with the decoded value. */
    submitScan: (value: string) => request({ type: "SUBMIT_QR_SCAN", value }),
    /** Read + clear the most recent scanned value (the Send form consumes it). */
    takePendingScan: () => request({ type: "TAKE_QR_SCAN" })
  };
}

/** Default browser-extension client wired to `browser.runtime.sendMessage`. */
export const walletClient = createWalletClient((message) => browser.runtime.sendMessage(message));
