import { createWalletClient, type WalletRequest } from "../sdk";

/**
 * Raw transport from the UI shell to the wallet core. It only moves the wire
 * message across `browser.runtime`; the error contract is unwrapped centrally
 * inside the SDK client (`walletClient`), not here. Kept as a named export so
 * tests can mock the transport in one place.
 */
export function sendMessage(message: WalletRequest): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

/** The typed command surface the UI uses for every wallet interaction. */
export const walletClient = createWalletClient(sendMessage);
