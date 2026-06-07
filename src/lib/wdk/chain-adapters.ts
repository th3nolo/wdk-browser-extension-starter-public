import { assetDecimals, CHAIN_BY_ID, CHAINS, type ChainDefinition } from "../chains";
import { BTC_ADDRESS_BALANCE_URLS, BTC_BLOCKBOOK_URL, rpcUrlsForChain } from "../rpc-endpoints";
import type { RpcOverrides } from "../rpc-overrides";
import type { AccountRecord, AssetId, BalanceRecord, ChainId, SendRequest } from "../types";
import type { ParsedDappEvmTransaction } from "../dapp-transaction";
import { validateAddressChecksum } from "../address-validation";
import { decimalToBaseUnits } from "../decimal-amount";
import { EVM_TRANSFER_MAX_FEE_WEI } from "./constants";
import { assertSendAffordable } from "./send-affordability";
import type { WdkAccount, WdkManagerAdapter, WdkRuntime } from "./types";

export type WdkManagerModules = {
  evm: unknown;
  btc: unknown;
  solana: unknown;
  spark: unknown;
};

export type WdkChainAdapter = {
  chain: ChainDefinition;
  register: (wdk: WdkManagerAdapter, modules: WdkManagerModules, rpcOverrides?: RpcOverrides) => WdkManagerAdapter;
  derivationPath: (index: number) => string;
  getAccount: (runtime: WdkRuntime, index: number) => Promise<WdkAccount>;
  shouldSkipAccountListingError: (error: unknown) => boolean;
  listBalances: (runtime: WdkRuntime, account: AccountRecord) => Promise<BalanceRecord[]>;
  send: (runtime: WdkRuntime, request: SendRequest) => Promise<{ from: string; txHash: string }>;
  sendDappTransaction: (runtime: WdkRuntime, accountIndex: number, tx: ParsedDappEvmTransaction) => Promise<string>;
};

type RegistrationFactory = (chain: ChainDefinition, modules: WdkManagerModules, rpcOverrides?: RpcOverrides) => { manager: unknown; options: unknown };

const registerByFamily: Record<ChainDefinition["family"], RegistrationFactory> = {
  evm: (chain, modules, rpcOverrides) => ({
    manager: modules.evm,
    options: {
      provider: providerForChain(chain, rpcOverrides),
      chainId: chain.chainId,
      transferMaxFee: EVM_TRANSFER_MAX_FEE_WEI
    }
  }),
  btc: (_chain, modules) => ({
    manager: modules.btc,
    options: {
      network: "bitcoin",
      client: { type: "blockbook-http", clientConfig: { url: BTC_BLOCKBOOK_URL } }
    }
  }),
  solana: (chain, modules, rpcOverrides) => ({
    manager: modules.solana,
    options: {
      provider: providerForChain(chain, rpcOverrides),
      commitment: "confirmed"
    }
  }),
  spark: (_chain, modules) => ({
    manager: modules.spark,
    options: { network: "MAINNET" }
  })
};

const derivationPathByFamily: Record<ChainDefinition["family"], (index: number) => string> = {
  evm: (index) => `m/44'/60'/0'/0/${index}`,
  btc: (index) => `m/84'/0'/0'/0/${index}`,
  spark: (index) => `m/44'/998'/0'/0/${index}`,
  solana: (index) => `m/44'/501'/${index}'/0'`
};

function providerForChain(chain: ChainDefinition, rpcOverrides?: RpcOverrides): string | undefined {
  const override = rpcOverrides?.[chain.id];
  return rpcUrlsForChain(chain.id, override)[0];
}

async function getAccount(runtime: WdkRuntime, chain: ChainDefinition, index: number): Promise<WdkAccount> {
  return runtime.wdk.getAccount(chain.wdkKey, index);
}

async function tokenBalance(account: WdkAccount, chain: ChainId, asset: AssetId, token: string, decimals: number): Promise<BalanceRecord> {
  const amount = await account.getTokenBalance(token);
  return { chain, asset, amount: amount.toString(), symbol: asset, decimals };
}

function tokenContractForAsset(chain: ChainDefinition, asset: AssetId): string | undefined {
  if (asset === "USDt") return chain.usdtContract;
  if (asset === "XAUt") return chain.xautContract;
  return undefined;
}

function isRecoverableSparkAccountListingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Failed to fetch") || message.includes("Authentication failed");
}

function readSatoshiValue(value: unknown, field: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`Invalid Bitcoin balance response: ${field}`);
}

function readBitcoinStats(value: unknown, label: string): bigint {
  if (!value || typeof value !== "object") throw new Error(`Invalid Bitcoin balance response: ${label}`);
  const stats = value as Record<string, unknown>;
  return readSatoshiValue(stats.funded_txo_sum, `${label}.funded_txo_sum`) -
    readSatoshiValue(stats.spent_txo_sum, `${label}.spent_txo_sum`);
}

function parseBitcoinAddressBalance(payload: unknown): bigint {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Bitcoin balance response");
  const record = payload as Record<string, unknown>;
  return readBitcoinStats(record.chain_stats, "chain_stats") + readBitcoinStats(record.mempool_stats, "mempool_stats");
}

function bitcoinAddressBalanceUrl(baseUrl: string, address: string): string {
  return `${baseUrl.replace(/\/$/, "")}/address/${encodeURIComponent(address)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertValidAccountAddressForBalance(account: AccountRecord, chain: ChainDefinition): void {
  if (validateAddressChecksum(account.chain, account.address)) return;
  throw new Error(`Invalid ${chain.label} address for balance refresh`);
}

async function fetchBitcoinAddressBalance(address: string, originalError: unknown): Promise<bigint> {
  let lastError: unknown = originalError;
  for (const baseUrl of BTC_ADDRESS_BALANCE_URLS) {
    try {
      const response = await fetch(bitcoinAddressBalanceUrl(baseUrl, address));
      if (!response.ok) throw new Error(`${baseUrl} returned ${response.status}`);
      return parseBitcoinAddressBalance(await response.json());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Bitcoin balance fallback failed after WDK balance failed: ${errorMessage(lastError)}`);
}

async function nativeBalance(wdkAccount: WdkAccount, chain: ChainDefinition, account: AccountRecord): Promise<bigint> {
  try {
    return await wdkAccount.getBalance();
  } catch (error) {
    if (chain.family !== "btc") throw error;
    console.warn("WDK BTC balance endpoint failed; falling back to public address APIs", {
      address: account.address,
      error: errorMessage(error)
    });
    return fetchBitcoinAddressBalance(account.address, error);
  }
}

function createAdapter(chain: ChainDefinition): WdkChainAdapter {
  return {
    chain,
    register(wdk, modules, rpcOverrides) {
      const registration = registerByFamily[chain.family](chain, modules, rpcOverrides);
      return wdk.registerWallet(chain.wdkKey, registration.manager, registration.options);
    },
    derivationPath(index) {
      return derivationPathByFamily[chain.family](index);
    },
    getAccount(runtime, index) {
      return getAccount(runtime, chain, index);
    },
    shouldSkipAccountListingError(error) {
      return chain.family === "spark" && isRecoverableSparkAccountListingError(error);
    },
    async listBalances(runtime, account) {
      assertValidAccountAddressForBalance(account, chain);
      const wdkAccount = await getAccount(runtime, chain, account.index);
      const native = await nativeBalance(wdkAccount, chain, account);
      const balances: BalanceRecord[] = [{
        chain: account.chain,
        asset: chain.nativeAsset,
        amount: native.toString(),
        symbol: chain.nativeAsset,
        decimals: assetDecimals(account.chain, chain.nativeAsset)
      }];
      if (chain.usdtContract) balances.push(await tokenBalance(wdkAccount, account.chain, "USDt", chain.usdtContract, 6));
      if (chain.xautContract) balances.push(await tokenBalance(wdkAccount, account.chain, "XAUt", chain.xautContract, 6));
      return balances;
    },
    async send(runtime, request) {
      const account = await getAccount(runtime, chain, request.accountIndex);
      await assertSendAffordable(account, request);
      const from = await account.getAddress();
      const value = decimalToBaseUnits(request.amount, assetDecimals(request.chain, request.asset));
      if (request.asset === chain.nativeAsset) {
        const result = await account.sendTransaction({ to: request.to, value });
        return { from, txHash: result.hash };
      }
      const token = tokenContractForAsset(chain, request.asset);
      if (!token) throw new Error(`${request.asset} transfers are not configured for ${chain.label}`);
      const result = await account.transfer({ token, recipient: request.to, amount: value });
      return { from, txHash: result.hash };
    },
    async sendDappTransaction(runtime, accountIndex, tx) {
      if (chain.family !== "evm") throw new Error("dApp transactions are only supported on EVM networks");
      const account = await getAccount(runtime, chain, accountIndex);
      const balance = await account.getBalance();
      if (balance < tx.value + EVM_TRANSFER_MAX_FEE_WEI) {
        throw new Error(`Insufficient ${chain.nativeAsset} for amount plus fees`);
      }
      const result = await account.sendTransaction({
        to: tx.to,
        value: tx.value,
        ...(tx.data ? { data: tx.data } : {}),
        ...(tx.gasLimit ? { gasLimit: tx.gasLimit } : {})
      });
      return result.hash;
    }
  };
}

export const WDK_CHAIN_ADAPTERS: Record<ChainId, WdkChainAdapter> = Object.fromEntries(
  CHAINS.map((chain) => [chain.id, createAdapter(chain)])
) as Record<ChainId, WdkChainAdapter>;

export function wdkAdapterForChain(chain: ChainId): WdkChainAdapter {
  const adapter = WDK_CHAIN_ADAPTERS[chain];
  if (!adapter) throw new Error(`Unsupported network: ${chain}`);
  return adapter;
}

export function registerWdkWallets(wdk: WdkManagerAdapter, modules: WdkManagerModules, rpcOverrides?: RpcOverrides): WdkManagerAdapter {
  return CHAINS.reduce((manager, chain) => WDK_CHAIN_ADAPTERS[chain.id].register(manager, modules, rpcOverrides), wdk);
}

export function allWdkChainAdapters(): WdkChainAdapter[] {
  return CHAINS.map((chain) => WDK_CHAIN_ADAPTERS[chain.id]);
}

export function configuredChainLabel(chain: ChainId): string {
  return CHAIN_BY_ID[chain].label;
}
