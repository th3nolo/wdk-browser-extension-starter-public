import { prepareDappEvmTransactionForApproval, type ParsedDappEvmTransaction } from "../dapp-transaction";
import { ProviderRpcError, PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { getSession, peekSession, type WalletSession } from "../session/session";
import { readStore, type StoredState } from "../storage/store";
import {
  isTypedDataSignatureKind,
  type AccountRecord,
  type BalanceRecord,
  type ChainId,
  type Eip712TypedDataPayload,
  type PersonalSignMessageEncoding,
  type SendRequest,
  type SignatureRequestKind,
  type TransactionRecord,
  type WalletRecord
} from "../types";
import {
  listAccounts,
  listAllBalances,
  sendDappEvmTransaction,
  sendTransaction,
  signMessage,
  signTypedData
} from "../wdk/client";

type WalletExecutionSessionOptions = {
  touchSession?: boolean;
};

type DappSignatureExecutionRequest = {
  signatureKind: SignatureRequestKind;
  accountIndex: number;
  message: string;
  messageEncoding: PersonalSignMessageEncoding;
  typedData?: Eip712TypedDataPayload;
};

export type ConnectedAccountLookup =
  | { status: "locked" }
  | { status: "missing" }
  | { status: "connected"; account: AccountRecord };

function executionSession(walletId: string, options: WalletExecutionSessionOptions = {}): WalletSession | undefined {
  const session = options.touchSession ? getSession() : peekSession();
  if (!session || session.walletId !== walletId) return undefined;
  return session;
}

function requireExecutionSession(walletId: string): WalletSession {
  const session = executionSession(walletId, { touchSession: true });
  if (!session) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
  }
  return session;
}

// Derived addresses are deterministic from the seed + index (RPC-independent), so
// cache them in memory keyed by wallet + account count. Without this, every state
// poll re-derives every (chain, account) — the dominant cost when there are many
// accounts. The session gate below still hides them whenever the wallet is locked.
let derivedAccountsCache: { walletId: string; accountCount: number; accounts: AccountRecord[] } | undefined;

export function invalidateDerivedAccountsCache(): void {
  derivedAccountsCache = undefined;
}

export async function listWalletAccounts(
  wallet: WalletRecord,
  store: StoredState,
  options: WalletExecutionSessionOptions = {}
): Promise<AccountRecord[] | undefined> {
  const session = executionSession(wallet.id, options);
  if (!session) return undefined;
  const cached = derivedAccountsCache;
  if (cached && cached.walletId === wallet.id && cached.accountCount === wallet.accountCount) {
    return cached.accounts;
  }
  const accounts = await listAccounts(session.seedPhraseBytes, wallet.id, wallet.accountCount, store.rpcOverrides);
  derivedAccountsCache = { walletId: wallet.id, accountCount: wallet.accountCount, accounts };
  return accounts;
}

export async function connectedAccountForWallet(
  wallet: WalletRecord,
  chain: ChainId,
  accountIndex: number,
  store: StoredState,
  options: WalletExecutionSessionOptions = {}
): Promise<ConnectedAccountLookup> {
  const accounts = await listWalletAccounts(wallet, store, options);
  if (!accounts) return { status: "locked" };
  const account = accounts.find((entry) => entry.chain === chain && entry.index === accountIndex);
  return account ? { status: "connected", account } : { status: "missing" };
}

export async function listBalancesForWalletAccounts(
  walletId: string,
  accounts: AccountRecord[],
  store: StoredState,
  options: WalletExecutionSessionOptions = {}
): Promise<BalanceRecord[]> {
  if (!accounts.length) return [];
  const session = executionSession(walletId, options);
  if (!session) return [];
  return listAllBalances(session.seedPhraseBytes, accounts, store.rpcOverrides);
}

export async function submitSendRequest(request: SendRequest, store: StoredState): Promise<TransactionRecord> {
  const session = requireExecutionSession(request.walletId);
  return sendTransaction(session.seedPhraseBytes, request, store.rpcOverrides);
}

export async function validateDappTransactionForApproval(
  chain: ChainId,
  tx: ParsedDappEvmTransaction,
  store?: StoredState
): Promise<void> {
  await prepareDappTransactionForApproval(chain, tx, store);
}

export async function prepareDappTransactionForApproval(
  chain: ChainId,
  tx: ParsedDappEvmTransaction,
  store?: StoredState
): Promise<ParsedDappEvmTransaction> {
  const currentStore = store ?? await readStore();
  return prepareDappEvmTransactionForApproval(chain, tx, currentStore.rpcOverrides);
}

export async function signDappSignatureForApproval(
  walletId: string,
  chain: ChainId,
  request: DappSignatureExecutionRequest,
  store: StoredState
): Promise<string> {
  const session = requireExecutionSession(walletId);
  if (request.typedData && isTypedDataSignatureKind(request.signatureKind)) {
    return signTypedData(session.seedPhraseBytes, chain, request.accountIndex, request.typedData, store.rpcOverrides);
  }
  return signMessage(
    session.seedPhraseBytes,
    chain,
    request.accountIndex,
    request.message,
    request.messageEncoding,
    store.rpcOverrides
  );
}

export async function submitDappTransactionForApproval(
  walletId: string,
  chain: ChainId,
  accountIndex: number,
  tx: ParsedDappEvmTransaction,
  store: StoredState
): Promise<string> {
  const session = requireExecutionSession(walletId);
  const prepared = await prepareDappTransactionForApproval(chain, tx, store);
  return sendDappEvmTransaction(session.seedPhraseBytes, chain, accountIndex, prepared, store.rpcOverrides);
}
