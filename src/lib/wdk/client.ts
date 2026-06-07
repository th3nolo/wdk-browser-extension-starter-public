import type { RpcOverrides } from "../rpc-overrides";
import type { AccountRecord, BalanceRecord, ChainId, Eip712TypedDataPayload, SendRequest, TransactionRecord } from "../types";
import type { ParsedDappEvmTransaction } from "../dapp-transaction";
import { assertExecutableSendRequest } from "../send-request";
import { withWdkRuntime } from "./runtime-cache";
import type { WdkAccount, WdkManagerAdapter, WdkRuntime } from "./types";
import { allWdkChainAdapters, registerWdkWallets, wdkAdapterForChain, type WdkChainAdapter } from "./chain-adapters";

async function loadWdk(seedPhrase: string, rpcOverrides?: RpcOverrides): Promise<WdkRuntime> {
  const [{ default: WDK }, { default: WalletManagerEvm }, { default: WalletManagerBtc }, { default: WalletManagerSolana }, { default: WalletManagerSpark }] =
    await Promise.all([
      import("@tetherto/wdk"),
      import("@tetherto/wdk-wallet-evm"),
      import("@tetherto/wdk-wallet-btc"),
      import("@tetherto/wdk-wallet-solana"),
      import("@tetherto/wdk-wallet-spark")
    ]);

  const wdk: WdkManagerAdapter = registerWdkWallets(new WDK(seedPhrase), {
    evm: WalletManagerEvm,
    btc: WalletManagerBtc,
    solana: WalletManagerSolana,
    spark: WalletManagerSpark
  }, rpcOverrides);
  return { wdk };
}

export async function listAccounts(
  seedPhraseBytes: Uint8Array,
  walletId: string,
  accountCount: number,
  rpcOverrides?: RpcOverrides
): Promise<AccountRecord[]> {
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => {
    // Derive every (chain, index) account in parallel. Sequentially this is
    // O(chains × accountCount) awaits — with many accounts and Spark's networked
    // derivation it dominates unlock + every state refresh.
    const tasks = allWdkChainAdapters().flatMap((adapter) =>
      Array.from({ length: accountCount }, (_, index) => deriveAccountRecord(runtime, adapter, walletId, index))
    );
    const results = await Promise.all(tasks);
    return results.filter((account): account is AccountRecord => account !== null);
  }, rpcOverrides);
}

async function deriveAccountRecord(
  runtime: WdkRuntime,
  adapter: WdkChainAdapter,
  walletId: string,
  index: number
): Promise<AccountRecord | null> {
  let account: WdkAccount;
  try {
    account = await adapter.getAccount(runtime, index);
  } catch (error) {
    if (adapter.shouldSkipAccountListingError(error)) return null;
    throw error;
  }
  try {
    return {
      walletId,
      chain: adapter.chain.id,
      index,
      address: await account.getAddress(),
      path: adapter.derivationPath(index)
    };
  } catch (error) {
    if (adapter.shouldSkipAccountListingError(error)) return null;
    throw error;
  }
}

export async function listBalances(
  seedPhraseBytes: Uint8Array,
  account: AccountRecord,
  rpcOverrides?: RpcOverrides
): Promise<BalanceRecord[]> {
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => listBalancesForAccount(runtime, account), rpcOverrides);
}

export async function listAllBalances(
  seedPhraseBytes: Uint8Array,
  accounts: AccountRecord[],
  rpcOverrides?: RpcOverrides
): Promise<BalanceRecord[]> {
  if (!accounts.length) return [];
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => {
    const balances = await Promise.all(accounts.map(async (account) => {
      try {
        return await listBalancesForAccount(runtime, account);
      } catch (error) {
        console.warn("Balance refresh failed for account", {
          chain: account.chain,
          index: account.index,
          address: account.address,
          error: error instanceof Error ? error.message : String(error)
        });
        return [];
      }
    }));
    return balances.flat();
  }, rpcOverrides);
}

async function listBalancesForAccount(runtime: WdkRuntime, account: AccountRecord): Promise<BalanceRecord[]> {
  return wdkAdapterForChain(account.chain).listBalances(runtime, account);
}

export async function sendTransaction(
  seedPhraseBytes: Uint8Array,
  request: SendRequest,
  rpcOverrides?: RpcOverrides
): Promise<TransactionRecord> {
  assertExecutableSendRequest(request);
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => {
    const { from, txHash } = await wdkAdapterForChain(request.chain).send(runtime, request);
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      walletId: request.walletId,
      chain: request.chain,
      asset: request.asset,
      from,
      to: request.to,
      amount: request.amount,
      status: "pending",
      txHash,
      createdAt: now,
      updatedAt: now
    };
  }, rpcOverrides);
}

function hexMessageToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    bytes[i / 2] = Number.parseInt(stripped.slice(i, i + 2), 16);
  }
  return bytes;
}

type PersonalSignInput = (message: string | Uint8Array) => Promise<string>;

export async function signMessage(
  seedPhraseBytes: Uint8Array,
  chain: ChainId,
  accountIndex: number,
  message: string,
  messageEncoding: "utf8" | "hex" = "utf8",
  rpcOverrides?: RpcOverrides
): Promise<string> {
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => {
    const account = await wdkAdapterForChain(chain).getAccount(runtime, accountIndex);
    if (messageEncoding === "hex") {
      return (account.sign as PersonalSignInput)(hexMessageToBytes(message));
    }
    return account.sign(message);
  }, rpcOverrides);
}

export async function sendDappEvmTransaction(
  seedPhraseBytes: Uint8Array,
  chain: ChainId,
  accountIndex: number,
  tx: ParsedDappEvmTransaction,
  rpcOverrides?: RpcOverrides
): Promise<string> {
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) =>
    wdkAdapterForChain(chain).sendDappTransaction(runtime, accountIndex, tx),
  rpcOverrides);
}

export async function signTypedData(
  seedPhraseBytes: Uint8Array,
  chain: ChainId,
  accountIndex: number,
  typedData: Eip712TypedDataPayload,
  rpcOverrides?: RpcOverrides
): Promise<string> {
  return withWdkRuntime(seedPhraseBytes, loadWdk, async (runtime) => {
    const account = await wdkAdapterForChain(chain).getAccount(runtime, accountIndex);
    if (typeof account.signTypedData !== "function") {
      throw new Error("Typed data signing is not available for this network");
    }
    return account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      message: typedData.message
    });
  }, rpcOverrides);
}
