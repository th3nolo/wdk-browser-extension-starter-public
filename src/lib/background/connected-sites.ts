import {
  DEFAULT_EVM_NUMERIC_CHAIN_ID,
  isSupportedEvmNumericChainId,
  toHexChainId,
  walletChainFromNumericChainId
} from "../evm-chains";
import { ProviderRpcError, PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { getSession } from "../session/session";
import { readStore, updateStore, type StoredState } from "../storage/store";
import { exposedAccountIndexes, type AccountRecord, type ChainId, type DappConnection, type WalletRecord } from "../types";
import {
  broadcastDappChainChanged,
  broadcastDappConnectState,
  broadcastDappSessionClosed
} from "./dapp-provider-events";
import { closeApprovalWindowIfOpen, openApprovalWindow } from "./approval-window";
import { connectedAccountForWallet } from "./wallet-execution";

// In-flight eth_requestAccounts calls park here until the user approves or
// rejects the connection in the popup. The service worker stays alive while the
// request is pending (open message port + approval window), so an in-memory
// registry is sufficient; if the worker is evicted mid-approval the dApp's
// request simply times out (inpage 60s) and can be retried.
const CONNECTION_RESOLUTION_TIMEOUT_MS = 50_000;

type ConnectionWaiter = {
  resolve: (addresses: string[]) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};
const connectionWaiters = new Map<string, Set<ConnectionWaiter>>();

function connectionWaiterKey(origin: string, walletId: string): string {
  return `${walletId}::${origin}`;
}

/**
 * Returns a promise that resolves with the exposed account addresses once the
 * user approves this origin, or rejects (4001) when they decline.
 */
export function waitForDappConnectionApproval(origin: string, walletId: string): Promise<string[]> {
  const key = connectionWaiterKey(origin, walletId);
  return new Promise<string[]>((resolve, reject) => {
    const bucket = connectionWaiters.get(key) ?? new Set<ConnectionWaiter>();
    const waiter: ConnectionWaiter = {
      resolve: (addresses) => { clearTimeout(waiter.timer); bucket.delete(waiter); resolve(addresses); },
      reject: (error) => { clearTimeout(waiter.timer); bucket.delete(waiter); reject(error); },
      timer: setTimeout(() => {
        bucket.delete(waiter);
        if (bucket.size === 0) connectionWaiters.delete(key);
        reject(new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Connection approval required. Open the WDK Wallet popup to approve this site."));
      }, CONNECTION_RESOLUTION_TIMEOUT_MS)
    };
    bucket.add(waiter);
    connectionWaiters.set(key, bucket);
  });
}

function settleConnectionWaiters(
  origin: string,
  walletId: string,
  outcome: { type: "approved"; addresses: string[] } | { type: "rejected"; error: unknown }
): void {
  const bucket = connectionWaiters.get(connectionWaiterKey(origin, walletId));
  if (!bucket) return;
  connectionWaiters.delete(connectionWaiterKey(origin, walletId));
  for (const waiter of [...bucket]) {
    if (outcome.type === "approved") waiter.resolve(outcome.addresses);
    else waiter.reject(outcome.error);
  }
}

export type ConnectedDappSession = {
  origin: string;
  walletId: string;
  wallet: WalletRecord;
  connection: DappConnection;
  /** Primary exposed account (kept for back-compat; equals accounts[0]). */
  account: AccountRecord;
  /** All accounts exposed to this origin, primary first. */
  accounts: AccountRecord[];
  chain: ChainId;
};

/** Addresses exposed to a connection, primary first. */
export function exposedAddresses(session: ConnectedDappSession): string[] {
  return session.accounts.map((account) => account.address);
}

/**
 * Resolves the account a signing/transaction request should run against. When
 * `from` is absent the primary exposed account is used; when present it must
 * match (case-insensitively) one of the exposed accounts, otherwise the request
 * is rejected as unauthorized.
 */
export function resolveExposedAccountForRequest(
  session: ConnectedDappSession,
  from: string | undefined
): AccountRecord {
  if (from === undefined) return session.account;
  const target = from.toLowerCase();
  const match = session.accounts.find((account) => account.address.toLowerCase() === target);
  if (!match) {
    throw new ProviderRpcError(
      PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      "Requested account is not connected to this site"
    );
  }
  return match;
}

export type DappAccess =
  | { status: "no-wallet" }
  | { status: "not-connected"; walletId: string }
  | { status: "connected-locked"; walletId: string; wallet: WalletRecord; connection: DappConnection }
  | { status: "connected"; session: ConnectedDappSession };

export function normalizedOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("Invalid dApp origin");
  }
}

export function connectionEvmChainId(connection: DappConnection | undefined): number {
  return connection?.evmChainId ?? DEFAULT_EVM_NUMERIC_CHAIN_ID;
}

function connectedOriginsForWallet(store: StoredState, walletId: string): string[] {
  return [...new Set(store.connectedSites.filter((site) => site.walletId === walletId).map((site) => site.origin))];
}

function requireWalletSession(walletId?: string) {
  const session = getSession();
  if (!session || (walletId && session.walletId !== walletId)) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
  }
  return session;
}

export async function resolveDappAccess(origin: string, options: { touchSession?: boolean } = {}): Promise<DappAccess> {
  const store = await readStore();
  const walletId = store.activeWalletId;
  if (!walletId) return { status: "no-wallet" };

  const wallet = store.wallets.find((entry) => entry.id === walletId);
  if (!wallet) throw new Error("Active wallet not found");
  const connection = store.connectedSites.find((site) => site.origin === origin && site.walletId === wallet.id);
  if (!connection) return { status: "not-connected", walletId };

  const chain = walletChainFromNumericChainId(connectionEvmChainId(connection)) ?? "ethereum";
  // Resolve the primary first (its index always leads the exposed set), then the
  // remaining exposed indexes. Primary status governs locked/not-connected.
  const primary = await connectedAccountForWallet(wallet, chain, connection.accountIndex, store, options);
  if (primary.status === "locked") return { status: "connected-locked", walletId, wallet, connection };
  if (primary.status === "missing") return { status: "not-connected", walletId };

  const accounts: AccountRecord[] = [primary.account];
  for (const index of exposedAccountIndexes(connection)) {
    if (index === connection.accountIndex) continue;
    const exposed = await connectedAccountForWallet(wallet, chain, index, store, options);
    // Skip exposed indexes that can no longer be resolved (e.g. account-count
    // shrank); the primary already guaranteed the session is live.
    if (exposed.status === "connected") accounts.push(exposed.account);
  }
  return {
    status: "connected",
    session: {
      origin,
      walletId,
      wallet,
      connection,
      account: primary.account,
      accounts,
      chain
    }
  };
}

async function connectedDappSession(
  origin: string,
  options: { requireUnlocked?: boolean } = {}
): Promise<ConnectedDappSession | undefined> {
  const access = await resolveDappAccess(origin, { touchSession: options.requireUnlocked ?? true });
  if (access.status === "connected") return access.session;
  if (options.requireUnlocked ?? true) {
    if (access.status === "no-wallet") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "No active wallet");
    if (access.status === "connected-locked") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
  }
  return undefined;
}

export async function requireConnectedDappSession(origin: string): Promise<ConnectedDappSession> {
  const access = await resolveDappAccess(origin, { touchSession: true });
  if (access.status === "connected") return access.session;
  if (access.status === "no-wallet") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "No active wallet");
  if (access.status === "connected-locked") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
  throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Site is not connected to this wallet");
}

export async function assertPendingRequestStillConnected(
  request: { origin: string; walletId: string; accountIndex: number; chain?: ChainId },
  label: "Signature" | "Transaction"
): Promise<ConnectedDappSession> {
  const connected = await requireConnectedDappSession(request.origin);
  if (connected.walletId !== request.walletId) {
    throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Site is not connected to this wallet");
  }
  if (!exposedAccountIndexes(connected.connection).includes(request.accountIndex)) {
    throw new Error(`${label} account is no longer connected to this site`);
  }
  if (request.chain && connected.chain !== request.chain) {
    throw new Error(`${label} network is no longer connected to this site`);
  }
  return {
    ...connected
  };
}

export async function dappEvmChainIdForOrigin(origin: string): Promise<number> {
  const store = await readStore();
  const walletId = store.activeWalletId;
  if (!walletId) return DEFAULT_EVM_NUMERIC_CHAIN_ID;
  const connection = store.connectedSites.find((site) => site.origin === origin && site.walletId === walletId);
  return connectionEvmChainId(connection);
}

export async function switchDappEthereumChain(origin: string, requestedChainId: number): Promise<null> {
  if (!isSupportedEvmNumericChainId(requestedChainId)) {
    throw new ProviderRpcError(
      PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN,
      "Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first."
    );
  }
  const connected = await requireConnectedDappSession(origin);
  const walletId = connected.walletId;
  const chainIdHex = toHexChainId(requestedChainId);
  let previousChainId = DEFAULT_EVM_NUMERIC_CHAIN_ID;
  await updateStore((state) => {
    const connection = state.connectedSites.find((site) => site.origin === origin && site.walletId === walletId);
    if (!connection) throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Site is not connected to this wallet");
    previousChainId = connectionEvmChainId(connection);
    if (connection.evmChainId === requestedChainId) return state;
    return {
      ...state,
      connectedSites: state.connectedSites.map((site) =>
        site.origin === origin && site.walletId === walletId
          ? { ...site, evmChainId: requestedChainId, lastUsedAt: new Date().toISOString() }
          : site
      )
    };
  });
  if (previousChainId !== requestedChainId) {
    await broadcastDappChainChanged(origin, chainIdHex);
  }
  return null;
}

export async function queueDappConnection(origin: string): Promise<void> {
  const requestedAt = new Date().toISOString();
  await updateStore((store) => {
    const walletId = store.activeWalletId;
    if (!walletId) return store;
    if (store.pendingConnections.some((request) => request.origin === origin && request.walletId === walletId)) return store;
    return { ...store, pendingConnections: [...store.pendingConnections, { origin, walletId, requestedAt }] };
  });
  // Fire-and-forget: surfacing the window must never block the awaited request.
  void openApprovalWindow();
}

export async function approveDappConnection(origin: string, accountIndexes: number[]): Promise<void> {
  const normalized = normalizedOrigin(origin);
  const store = await readStore();
  const pending = store.pendingConnections.find(
    (request) => request.origin === normalized && request.walletId === store.activeWalletId
  );
  if (!pending) throw new Error("Connection request was not found or already resolved");
  const walletId = pending.walletId;
  requireWalletSession(walletId);
  const wallet = store.wallets.find((entry) => entry.id === walletId);
  if (!wallet) throw new Error("Active wallet not found");
  if (
    accountIndexes.length === 0 ||
    accountIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= wallet.accountCount)
  ) {
    throw new Error("Selected account is not available for this wallet");
  }
  // Primary stays first (back-compat); the rest are the sorted unique remainder.
  const primaryIndex = accountIndexes[0];
  const sortedUnique = [...new Set(accountIndexes)].sort((a, b) => a - b);
  const orderedIndexes = [primaryIndex, ...sortedUnique.filter((index) => index !== primaryIndex)];
  const now = new Date().toISOString();
  await updateStore((state) => ({
    ...state,
    pendingConnections: state.pendingConnections.filter(
      (request) => !(request.origin === normalized && request.walletId === walletId)
    ),
    connectedSites: [
      ...state.connectedSites.filter((site) => !(site.origin === normalized && site.walletId === walletId)),
      {
        origin: normalized,
        walletId,
        accountIndex: primaryIndex,
        accountIndexes: orderedIndexes,
        evmChainId: DEFAULT_EVM_NUMERIC_CHAIN_ID,
        connectedAt: now,
        lastUsedAt: now
      }
    ]
  }));
  const connected = await connectedDappSession(normalized);
  if (connected) {
    const addresses = exposedAddresses(connected);
    await broadcastDappConnectState(normalized, addresses, connectionEvmChainId(connected.connection));
    settleConnectionWaiters(normalized, walletId, { type: "approved", addresses });
  }
  await closeApprovalWindowIfOpen();
}

export async function rejectDappConnection(origin: string): Promise<void> {
  const normalized = normalizedOrigin(origin);
  const store = await readStore();
  const walletId = store.activeWalletId;
  await updateStore((state) => ({
    ...state,
    pendingConnections: state.pendingConnections.filter(
      (request) => !(request.origin === normalized && request.walletId === state.activeWalletId)
    )
  }));
  if (walletId) {
    settleConnectionWaiters(normalized, walletId, {
      type: "rejected",
      error: new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.USER_REJECTED, "User rejected the connection request")
    });
  }
  await closeApprovalWindowIfOpen();
}

export async function revokeDappConnection(origin: string): Promise<void> {
  const normalized = normalizedOrigin(origin);
  const store = await readStore();
  const walletId = store.activeWalletId;
  await updateStore((state) => ({ ...state, connectedSites: state.connectedSites.filter((site) => !(site.origin === normalized && site.walletId === walletId)) }));
  await broadcastDappSessionClosed(normalized);
}

export async function closeWalletDappSessions(walletId: string | undefined): Promise<void> {
  if (!walletId) return;
  const store = await readStore();
  await Promise.all(connectedOriginsForWallet(store, walletId).map((origin) => broadcastDappSessionClosed(origin)));
}
