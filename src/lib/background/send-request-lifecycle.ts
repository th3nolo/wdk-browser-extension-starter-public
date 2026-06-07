import { assertSendRequestAllowedForWallet } from "../send-request";
import { readStore, updateStore } from "../storage/store";
import type { PopupSummaryState, SendRequest } from "../types";
import { submitSendRequest } from "./wallet-execution";
import { requireUnlockedWalletSession } from "./wallet-lifecycle";
import { walletSummaryState } from "./wallet-summary";

export async function submitPopupSendRequest(request: SendRequest): Promise<PopupSummaryState> {
  requireUnlockedWalletSession(request.walletId);
  const store = await readStore();
  assertSendRequestAllowedForWallet(request, store.wallets.find((entry) => entry.id === request.walletId));
  const tx = await submitSendRequest(request, store);
  await updateStore((state) => ({ ...state, transactions: [tx, ...state.transactions] }));
  return walletSummaryState();
}
