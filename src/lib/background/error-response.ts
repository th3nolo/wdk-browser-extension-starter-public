/**
 * The wire error contract now lives in `src/sdk/contract.ts` — the single owner
 * of the request/response + error shapes shared by the UI client and the
 * background core. This module re-exports it so background callers keep their
 * existing import path.
 */
export {
  BACKGROUND_ERROR_RESPONSE_KEY,
  isBackgroundErrorResponse,
  toBackgroundErrorResponse,
  type BackgroundErrorResponse
} from "../../sdk/contract";
