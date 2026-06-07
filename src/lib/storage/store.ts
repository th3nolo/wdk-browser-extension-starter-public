import type { EncryptedVault } from "../crypto/vault";
import { createMutationChain } from "./mutation-chain";
import type { RpcOverrides } from "../rpc-overrides";
import { sanitizeRpcOverrides } from "../rpc-overrides";
import { parseStoredStateInput } from "../schemas/store";
import type { DappConnection, DappConnectionRequest, TransactionRecord, WalletRecord } from "../types";

export type StoredState = {
  vaults: Record<string, EncryptedVault>;
  wallets: WalletRecord[];
  activeWalletId?: string;
  transactions: TransactionRecord[];
  connectedSites: DappConnection[];
  pendingConnections: DappConnectionRequest[];
  rpcOverrides?: RpcOverrides;
};

export type ParsedStoredState = Partial<StoredState> & {
  vault?: EncryptedVault;
};

const STORE_KEY = "wdk-wallet-state";
const DEFAULT_STATE: StoredState = { vaults: {}, wallets: [], transactions: [], connectedSites: [], pendingConnections: [] };

function normalizeState(input: ParsedStoredState | undefined): StoredState {
  const wallets = input?.wallets ?? [];
  const activeWalletId = input?.activeWalletId ?? wallets[0]?.id;
  let vaults = input?.vaults ?? {};

  if (input?.vault && activeWalletId && !vaults[activeWalletId]) {
    vaults = { ...vaults, [activeWalletId]: input.vault };
  }

  const rpcOverrides = sanitizeRpcOverrides(input?.rpcOverrides);
  const rest = { ...(input ?? {}) };
  delete rest.rpcOverrides;
  delete rest.vault;

  return {
    ...DEFAULT_STATE,
    ...rest,
    vaults,
    wallets,
    activeWalletId,
    transactions: input?.transactions ?? [],
    connectedSites: input?.connectedSites ?? [],
    pendingConnections: input?.pendingConnections ?? [],
    ...(Object.keys(rpcOverrides).length > 0 ? { rpcOverrides } : {})
  };
}

export async function readStore(): Promise<StoredState> {
  const item = await browser.storage.local.get(STORE_KEY);
  return normalizeState(parseStoredStateInput(item[STORE_KEY]));
}

export async function writeStore(next: StoredState): Promise<void> {
  const persisted = normalizeState(next);
  await browser.storage.local.set({ [STORE_KEY]: persisted });
}

const storeMutationChain = createMutationChain();

export async function updateStore(mutator: (state: StoredState) => StoredState | Promise<StoredState>): Promise<StoredState> {
  return storeMutationChain.run(async () => {
    const current = await readStore();
    const next = normalizeState(await mutator(current));
    await writeStore(next);
    return next;
  });
}
