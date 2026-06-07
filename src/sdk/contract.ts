/**
 * The single owner of the wire + error contract between the swappable UI shell
 * and the headless wallet core. Both the UI (via the SDK client) and the
 * background controller agree on these shapes; neither imports the other.
 *
 * `WalletRequest` is the request union the background accepts; `WalletResponseMap`
 * maps each popup command `type` to the value its controller handler resolves
 * with (verified against `src/lib/background/controller.ts`).
 */
import type { BackgroundMessage } from "../lib/schemas/messages";
import type {
  BalanceRecord,
  ChainId,
  PopupState,
  PopupSummaryState,
  TransactionRecord
} from "../lib/types";

export const BACKGROUND_ERROR_RESPONSE_KEY = "__wdkBackgroundError";

export type BackgroundErrorResponse = {
  [BACKGROUND_ERROR_RESPONSE_KEY]: {
    message: string;
  };
};

export function toBackgroundErrorResponse(error: unknown): BackgroundErrorResponse {
  return {
    [BACKGROUND_ERROR_RESPONSE_KEY]: {
      message: error instanceof Error ? error.message : "Unexpected wallet error"
    }
  };
}

export function isBackgroundErrorResponse(value: unknown): value is BackgroundErrorResponse {
  return (
    typeof value === "object"
    && value !== null
    && BACKGROUND_ERROR_RESPONSE_KEY in value
    && typeof (value as BackgroundErrorResponse)[BACKGROUND_ERROR_RESPONSE_KEY]?.message === "string"
  );
}

/** The request union the background controller accepts. */
export type WalletRequest = BackgroundMessage;

/**
 * Maps each popup command `type` to the value the matching controller handler
 * resolves with. `TransactionRecord` is exported for callers that build their
 * own views even though no handler currently returns it directly.
 */
export type WalletResponseMap = {
  GET_STATE: PopupState;
  GET_STATE_SUMMARY: PopupSummaryState;
  GET_BALANCES: BalanceRecord[];
  APPROVE_DAPP: PopupSummaryState;
  REJECT_DAPP: PopupSummaryState;
  REVOKE_DAPP: PopupSummaryState;
  APPROVE_SIGNATURE: PopupSummaryState;
  REJECT_SIGNATURE: PopupSummaryState;
  APPROVE_DAPP_TRANSACTION: PopupSummaryState;
  REJECT_DAPP_TRANSACTION: PopupSummaryState;
  CREATE_WALLET: PopupSummaryState;
  IMPORT_WALLET: PopupSummaryState;
  UNLOCK: PopupSummaryState;
  SWITCH_WALLET: PopupSummaryState;
  LOCK: PopupSummaryState;
  DELETE_WALLET: PopupSummaryState;
  ADD_ACCOUNT: PopupSummaryState;
  REFRESH: PopupState;
  // `submitPopupSendRequest` returns the refreshed summary, not the bare record.
  SEND: PopupSummaryState;
  SET_RPC_OVERRIDE: PopupSummaryState;
  OPEN_QR_SCANNER: null;
  SUBMIT_QR_SCAN: null;
  TAKE_QR_SCAN: string | null;
};

export type WalletResponse<K extends keyof WalletResponseMap> = WalletResponseMap[K];

/** Re-exported so the client's command surface is fully typed from the contract. */
export type { ChainId, TransactionRecord };
