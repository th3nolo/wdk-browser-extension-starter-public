import { decryptSeedPhrase, decryptSeedPhraseBytes, encryptSeedPhrase } from "../crypto/vault";
import { secureZeroBytes } from "../crypto/secure-zero";
import { ProviderRpcError, PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { ensureRpcOverridePermission, mergeRpcOverrides } from "../rpc-overrides";
import { clearSession, createSession, getSession, peekSession } from "../session/session";
import { readStore, updateStore } from "../storage/store";
import type { ChainId, PopupSummaryState, WalletRecord } from "../types";
import { normalizeSeedPhrase, validatePassword, validateSeedPhrase } from "../validation";
import { clearWdkRuntimeCache } from "../wdk/runtime-cache";
import { closeWalletDappSessions } from "./connected-sites";
import { rejectDappApprovalsForWallet } from "./dapp-approval-workflow";
import { walletSummaryState } from "./wallet-summary";

export function requireUnlockedWalletSession(walletId?: string) {
  const session = getSession();
  if (!session || (walletId && session.walletId !== walletId)) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
  }
  return session;
}

async function initializeWallet(name: string, password: string, seedPhrase: string): Promise<PopupSummaryState> {
  if (!validatePassword(password)) throw new Error("Password must be at least 12 characters with sufficient strength");
  const normalized = normalizeSeedPhrase(seedPhrase);
  if (!validateSeedPhrase(normalized)) throw new Error("Invalid BIP-39 seed phrase");
  const vault = await encryptSeedPhrase(normalized, password);
  const wallet: WalletRecord = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), accountCount: 1 };
  await createSession(wallet.id, normalized);
  await updateStore((store) => ({
    ...store,
    vaults: { ...store.vaults, [wallet.id]: vault },
    wallets: [...store.wallets, wallet],
    activeWalletId: wallet.id,
    pendingConnections: [],
    connectedSites: store.connectedSites.filter((site) => site.walletId !== wallet.id)
  }));
  return walletSummaryState();
}

export function createWallet(name: string, password: string, seedPhrase: string): Promise<PopupSummaryState> {
  return initializeWallet(name, password, seedPhrase);
}

export function importWallet(name: string, password: string, seedPhrase: string): Promise<PopupSummaryState> {
  return initializeWallet(name, password, seedPhrase);
}

async function unlockWallet(walletId: string, password: string): Promise<PopupSummaryState> {
  const store = await readStore();
  const wallet = store.wallets.find((entry) => entry.id === walletId);
  const vault = store.vaults[walletId];
  if (!wallet || !vault) throw new Error("Selected wallet vault was not found");
  const seedPhraseBytes = await decryptSeedPhraseBytes(vault, password);
  try {
    await createSession(wallet.id, seedPhraseBytes);
  } catch (error) {
    secureZeroBytes(seedPhraseBytes);
    throw error;
  }
  await updateStore((state) => ({ ...state, activeWalletId: wallet.id }));
  return walletSummaryState();
}

export async function unlockDefaultWallet(password: string): Promise<PopupSummaryState> {
  const store = await readStore();
  const walletId = store.activeWalletId ?? store.wallets[0]?.id;
  if (!walletId) throw new Error("No wallet has been created");
  return unlockWallet(walletId, password);
}

export function switchWallet(walletId: string, password: string): Promise<PopupSummaryState> {
  return unlockWallet(walletId, password);
}

export async function lockActiveWallet(): Promise<PopupSummaryState> {
  const store = await readStore();
  const walletId = store.activeWalletId;
  await rejectDappApprovalsForWallet(walletId);
  await clearSession();
  await closeWalletDappSessions(walletId);
  return walletSummaryState();
}

export async function deleteWallet(walletId: string, password: string): Promise<PopupSummaryState> {
  const store = await readStore();
  const wallet = store.wallets.find((entry) => entry.id === walletId);
  const vault = store.vaults[walletId];
  if (!wallet || !vault) throw new Error("Selected wallet vault was not found");
  await decryptSeedPhrase(vault, password);

  const session = peekSession();
  if (session?.walletId === walletId) {
    await clearSession();
  }
  await rejectDappApprovalsForWallet(walletId);
  await closeWalletDappSessions(walletId);

  const remainingWallets = store.wallets.filter((entry) => entry.id !== walletId);
  const remainingVaults = { ...store.vaults };
  delete remainingVaults[walletId];
  const nextActiveWalletId = store.activeWalletId === walletId ? remainingWallets[0]?.id : store.activeWalletId;

  await updateStore((state) => ({
    ...state,
    vaults: remainingVaults,
    wallets: remainingWallets,
    activeWalletId: nextActiveWalletId,
    transactions: state.transactions.filter((tx) => tx.walletId !== walletId),
    connectedSites: state.connectedSites.filter((site) => site.walletId !== walletId),
    pendingConnections: state.pendingConnections.filter((request) => request.walletId !== walletId)
  }));
  return walletSummaryState();
}

export async function addWalletAccount(walletId: string): Promise<PopupSummaryState> {
  requireUnlockedWalletSession(walletId);
  await updateStore((store) => ({
    ...store,
    wallets: store.wallets.map((wallet) => wallet.id === walletId ? { ...wallet, accountCount: wallet.accountCount + 1 } : wallet)
  }));
  return walletSummaryState();
}

export async function setWalletRpcOverride(chain: ChainId, url: string | undefined): Promise<PopupSummaryState> {
  requireUnlockedWalletSession();
  if (url && !(await ensureRpcOverridePermission(url))) {
    throw new Error("Host permission for the custom RPC endpoint was denied");
  }
  await updateStore((store) => ({
    ...store,
    rpcOverrides: mergeRpcOverrides(store.rpcOverrides, chain, url)
  }));
  await clearWdkRuntimeCache();
  return walletSummaryState();
}
