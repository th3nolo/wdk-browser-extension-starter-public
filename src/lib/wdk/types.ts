import type { IWalletAccountWithProtocols } from "@tetherto/wdk";

/** WDK account surface used by this extension's wallet adapter. */
export type WdkEvmTransaction = {
  to: string;
  value: bigint | number;
  data?: string;
  gasLimit?: bigint | number;
  maxFeePerGas?: bigint | number;
  maxPriorityFeePerGas?: bigint | number;
};

export type WdkAccount = Pick<
  IWalletAccountWithProtocols,
  "getAddress" | "getBalance" | "getTokenBalance" | "transfer" | "sign"
> & {
  sendTransaction: (tx: WdkEvmTransaction) => Promise<{ hash: string }>;
  signTypedData?: (typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    message: Record<string, unknown>;
  }) => Promise<string>;
};

/** Minimal WDK manager surface used by this extension. */
export type WdkManagerAdapter = {
  registerWallet(blockchain: string, walletManager: unknown, config: unknown): WdkManagerAdapter;
  getAccount(blockchain: string, index?: number): Promise<WdkAccount>;
  dispose(blockchains?: string[]): void;
};

/** Cached WDK manager instance for a seed phrase and RPC override set. */
export type WdkRuntime = { wdk: WdkManagerAdapter };
