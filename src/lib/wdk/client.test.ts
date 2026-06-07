import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAccounts, listAllBalances, listBalances, sendDappEvmTransaction, sendTransaction } from "./client";
import { resetWdkRuntimeCacheForTests } from "./runtime-cache";

const encoder = new TextEncoder();

function seedBytes(value: string): Uint8Array {
  return encoder.encode(value);
}

const wdkState = vi.hoisted(() => ({
  account: {
    getAddress: vi.fn(async () => "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"),
    getBalance: vi.fn(async () => 10_000_000_000_000_000_000n),
    getTokenBalance: vi.fn(async () => 100_000_000n),
    sendTransaction: vi.fn(async () => ({ hash: "0xnative" })),
    transfer: vi.fn(async () => ({ hash: "0xtoken" }))
  },
  instances: [] as Array<{
    registerWallet: ReturnType<typeof vi.fn>;
    getAccount: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  getAccountErrors: new Map<string, Error>(),
  registrations: [] as Array<{ key: string; options: unknown }>
}));

vi.mock("@tetherto/wdk", () => ({
  default: vi.fn().mockImplementation(() => {
    const instance = {
      registerWallet: vi.fn((key: string, _manager: unknown, options: unknown) => {
        wdkState.registrations.push({ key, options });
        return instance;
      }),
      getAccount: vi.fn(async (key: string) => {
        const error = wdkState.getAccountErrors.get(key);
        if (error) throw error;
        return wdkState.account;
      }),
      dispose: vi.fn()
    };
    wdkState.instances.push(instance);
    return instance;
  })
}));

vi.mock("@tetherto/wdk-wallet-evm", () => ({ default: vi.fn() }));
vi.mock("@tetherto/wdk-wallet-btc", () => ({ default: vi.fn() }));
vi.mock("@tetherto/wdk-wallet-solana", () => ({ default: vi.fn() }));
vi.mock("@tetherto/wdk-wallet-spark", () => ({ default: vi.fn() }));

describe("WDK send adapter", () => {
  beforeEach(() => {
    resetWdkRuntimeCacheForTests();
    vi.clearAllMocks();
    wdkState.instances.length = 0;
    wdkState.getAccountErrors.clear();
    wdkState.registrations.length = 0;
    wdkState.account.getAddress.mockResolvedValue("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    wdkState.account.getBalance.mockResolvedValue(10_000_000_000_000_000_000n);
    wdkState.account.getTokenBalance.mockResolvedValue(100_000_000n);
    wdkState.account.sendTransaction.mockResolvedValue({ hash: "0xnative" });
    wdkState.account.transfer.mockResolvedValue({ hash: "0xtoken" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: "0x" })
    })));
  });


  it("derives every configured chain and requested account index through WDK", async () => {
    const accounts = await listAccounts(seedBytes("seed"), "wallet-1", 2);

    expect(accounts).toHaveLength(14);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("bitcoin", 0);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("bitcoin", 1);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("ethereum", 0);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("polygon", 1);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("arbitrum", 1);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("plasma", 1);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("solana", 1);
    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("spark", 1);
    expect(accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ walletId: "wallet-1", chain: "ethereum", index: 1, path: "m/44'/60'/0'/0/1" }),
      expect.objectContaining({ walletId: "wallet-1", chain: "bitcoin", index: 1, path: "m/84'/0'/0'/0/1" }),
      expect.objectContaining({ walletId: "wallet-1", chain: "solana", index: 1, path: "m/44'/501'/1'/0'" }),
      expect.objectContaining({ walletId: "wallet-1", chain: "spark", index: 1, path: "m/44'/998'/0'/0/1" })
    ]));
    expect(wdkState.instances).toHaveLength(1);
    expect(wdkState.instances[0].dispose).not.toHaveBeenCalled();
  });

  it("keeps non-Spark accounts available when Spark account listing cannot reach its service", async () => {
    wdkState.getAccountErrors.set("spark", new Error("Authentication failed: Failed to fetch"));

    const accounts = await listAccounts(seedBytes("seed"), "wallet-1", 1);

    expect(accounts).toHaveLength(6);
    expect(accounts.some((account) => account.chain === "spark")).toBe(false);
    expect(accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ chain: "ethereum", index: 0 }),
      expect.objectContaining({ chain: "bitcoin", index: 0 }),
      expect.objectContaining({ chain: "solana", index: 0 })
    ]));
  });

  it("does not hide non-Spark account listing errors", async () => {
    wdkState.getAccountErrors.set("ethereum", new Error("Authentication failed: Failed to fetch"));

    await expect(listAccounts(seedBytes("seed"), "wallet-1", 1)).rejects.toThrow("Authentication failed: Failed to fetch");
  });

  it("registers EVM chains with the documented transferMaxFee ceiling", async () => {
    await listAccounts(seedBytes("seed"), "wallet-1", 1);

    const evmRegistrations = wdkState.registrations.filter(({ key }) =>
      ["ethereum", "polygon", "arbitrum", "plasma"].includes(key)
    );
    expect(evmRegistrations).toHaveLength(4);
    for (const { options } of evmRegistrations) {
      expect(options).toMatchObject({ transferMaxFee: 100_000_000_000_000n });
    }
  });

  it("registers Solana with the browser-safe public RPC primary", async () => {
    await listAccounts(seedBytes("seed"), "wallet-1", 1);

    const solanaRegistration = wdkState.registrations.find(({ key }) => key === "solana");
    expect(solanaRegistration?.options).toMatchObject({
      provider: "https://solana-rpc.publicnode.com",
      commitment: "confirmed"
    });
  });

  it("reads native and token balances for token-configured chains", async () => {
    const balances = await listBalances(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      index: 0,
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      path: "m/44'/60'/0'/0/0"
    });

    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("ethereum", 0);
    expect(wdkState.account.getBalance).toHaveBeenCalledOnce();
    expect(wdkState.account.getTokenBalance).toHaveBeenCalledWith("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    expect(wdkState.account.getTokenBalance).toHaveBeenCalledWith("0x68749665FF8D2d112Fa859AA293F07A622782F38");
    expect(balances).toEqual([
      { chain: "ethereum", asset: "ETH", amount: "10000000000000000000", symbol: "ETH", decimals: 18 },
      { chain: "ethereum", asset: "USDt", amount: "100000000", symbol: "USDt", decimals: 6 },
      { chain: "ethereum", asset: "XAUt", amount: "100000000", symbol: "XAUt", decimals: 6 }
    ]);
    expect(wdkState.instances).toHaveLength(1);
    expect(wdkState.instances[0].dispose).not.toHaveBeenCalled();
  });

  it("falls back to public Bitcoin address APIs when the WDK Blockbook balance endpoint fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const address = "bc1qm578jrpt40uuvugzk3kvtkc0m6w6d00e78vtqp";
    wdkState.account.getBalance.mockRejectedValueOnce(new Error("Blockbook returned 503"));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("blockstream.info")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 1000 },
          mempool_stats: { funded_txo_sum: "250", spent_txo_sum: "50" }
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const balances = await listBalances(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "bitcoin",
      index: 0,
      address,
      path: "m/84'/0'/0'/0/0"
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://blockstream.info/api/address/${address}`,
      `https://mempool.space/api/address/${address}`
    ]);
    expect(balances).toEqual([
      { chain: "bitcoin", asset: "BTC", amount: "4200", symbol: "BTC", decimals: 8 }
    ]);
    expect(warning).toHaveBeenCalledWith("WDK BTC balance endpoint failed; falling back to public address APIs", expect.objectContaining({
      address,
      error: "Blockbook returned 503"
    }));
    warning.mockRestore();
  });

  it("does not query external balance APIs for locally invalid account addresses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBalances(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "spark",
      index: 0,
      address: "spark84pj7fegcemr9jhs3z57k9s94wpctrye2guy30d2cg7nshn9gm3u5jgvph",
      path: "m/44'/998'/0'/0/0"
    })).rejects.toThrow("Invalid Lightning (Spark) address for balance refresh");

    expect(wdkState.instances[0].getAccount).not.toHaveBeenCalled();
    expect(wdkState.account.getBalance).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps available balances when one account balance endpoint fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    wdkState.getAccountErrors.set("solana", new Error("Network Error"));

    const balances = await listAllBalances(seedBytes("seed"), [
      {
        walletId: "wallet-1",
        chain: "ethereum",
        index: 0,
        address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        path: "m/44'/60'/0'/0/0"
      },
      {
        walletId: "wallet-1",
        chain: "solana",
        index: 0,
        address: "4RjmxhzoP9LjoGRmq4t5d4sgHidYS5YPMrfdAit9jgXR",
        path: "m/44'/501'/0'/0'"
      }
    ]);

    expect(balances).toEqual([
      { chain: "ethereum", asset: "ETH", amount: "10000000000000000000", symbol: "ETH", decimals: 18 },
      { chain: "ethereum", asset: "USDt", amount: "100000000", symbol: "USDt", decimals: 6 },
      { chain: "ethereum", asset: "XAUt", amount: "100000000", symbol: "XAUt", decimals: 6 }
    ]);
    expect(warning).toHaveBeenCalledWith("Balance refresh failed for account", expect.objectContaining({
      chain: "solana",
      error: "Network Error"
    }));
    warning.mockRestore();
  });

  it("sends native EVM assets through the WDK account with 18-decimal base units", async () => {
    const tx = await sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "ETH",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1.25"
    });

    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith("ethereum", 0);
    expect(wdkState.account.sendTransaction).toHaveBeenCalledWith({
      to: "0x0000000000000000000000000000000000000001",
      value: 1_250_000_000_000_000_000n
    });
    expect(wdkState.account.transfer).not.toHaveBeenCalled();
    expect(wdkState.instances).toHaveLength(1);
    expect(wdkState.instances[0].dispose).not.toHaveBeenCalled();
    expect(tx).toMatchObject({
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "ETH",
      from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      to: "0x0000000000000000000000000000000000000001",
      amount: "1.25",
      status: "pending",
      txHash: "0xnative"
    });
  });

  it("sends USDt through token transfer with 6-decimal base units", async () => {
    const tx = await sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "USDt",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "12.3456"
    });

    expect(wdkState.account.sendTransaction).not.toHaveBeenCalled();
    expect(wdkState.account.transfer).toHaveBeenCalledWith({
      token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      recipient: "0x0000000000000000000000000000000000000001",
      amount: 12_345_600n
    });
    expect(tx).toMatchObject({ asset: "USDt", status: "pending", txHash: "0xtoken" });
  });

  it.each([
    ["bitcoin", "BTC", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "1.23456789", 123_456_789n, "bitcoin"],
    ["spark", "SATS", "spark1pgss85kzu8r3kerhnvxwzzasls3wz3tycfdc4f6d4wgp5trmsel3x8jgad52lz", "1.23456789", 123_456_789n, "spark"],
    ["solana", "SOL", "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk", "1.234567891", 1_234_567_891n, "solana"],
    ["polygon", "POL", "0x0000000000000000000000000000000000000001", "1.25", 1_250_000_000_000_000_000n, "polygon"],
    ["plasma", "XPL", "0x0000000000000000000000000000000000000001", "1.25", 1_250_000_000_000_000_000n, "plasma"]
  ] as const)("sends native %s assets with chain-specific base units", async (chain, asset, to, amount, value, wdkKey) => {
    const tx = await sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain,
      asset,
      accountIndex: 0,
      to,
      amount
    });

    expect(wdkState.instances[0].getAccount).toHaveBeenCalledWith(wdkKey, 0);
    expect(wdkState.account.sendTransaction).toHaveBeenCalledWith({ to, value });
    expect(wdkState.account.transfer).not.toHaveBeenCalled();
    expect(tx).toMatchObject({ chain, asset, to, amount, status: "pending", txHash: "0xnative" });
  });

  it("sends XAUt through token transfer with 6-decimal base units", async () => {
    const tx = await sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "XAUt",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "0.123456"
    });

    expect(wdkState.account.sendTransaction).not.toHaveBeenCalled();
    expect(wdkState.account.transfer).toHaveBeenCalledWith({
      token: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
      recipient: "0x0000000000000000000000000000000000000001",
      amount: 123_456n
    });
    expect(tx).toMatchObject({ asset: "XAUt", status: "pending", txHash: "0xtoken" });
  });

  it("sends prepared dApp contract transactions with calldata and wallet-estimated gas", async () => {
    const txHash = await sendDappEvmTransaction(seedBytes("seed"), "ethereum", 0, {
      to: "0x0000000000000000000000000000000000000003",
      value: 0n,
      data: "0x095ea7b3",
      gasLimit: 50000n
    });

    expect(txHash).toBe("0xnative");
    expect(wdkState.account.sendTransaction).toHaveBeenCalledWith({
      to: "0x0000000000000000000000000000000000000003",
      value: 0n,
      data: "0x095ea7b3",
      gasLimit: 50000n
    });
  });

  it("sends simple dApp native transfers without passing gas overrides", async () => {
    const txHash = await sendDappEvmTransaction(seedBytes("seed"), "ethereum", 0, {
      to: "0x0000000000000000000000000000000000000001",
      value: 1_000_000_000_000_000_000n
    });

    expect(txHash).toBe("0xnative");
    expect(wdkState.account.sendTransaction).toHaveBeenCalledWith({
      to: "0x0000000000000000000000000000000000000001",
      value: 1_000_000_000_000_000_000n
    });
  });
  it("rejects unsupported token transfers before loading WDK", async () => {
    await expect(sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "polygon",
      asset: "XAUt",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1"
    })).rejects.toThrow("XAUt is not configured for Polygon");

    expect(wdkState.instances).toHaveLength(0);
  });

  it("rejects native sends when balance cannot cover amount plus fees", async () => {
    wdkState.account.getBalance.mockResolvedValue(1_250_000_000_000_000_000n);

    await expect(sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "ETH",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1.25"
    })).rejects.toThrow("Insufficient ETH for amount plus fees");

    expect(wdkState.account.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects token sends when token balance is too low", async () => {
    wdkState.account.getTokenBalance.mockResolvedValue(1_000_000n);

    await expect(sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "USDt",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "12.3456"
    })).rejects.toThrow("Insufficient USDt balance");

    expect(wdkState.account.transfer).not.toHaveBeenCalled();
  });

  it("rejects token sends when native balance cannot cover EVM fees", async () => {
    wdkState.account.getBalance.mockResolvedValue(1n);

    await expect(sendTransaction(seedBytes("seed"), {
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "USDt",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1"
    })).rejects.toThrow("Insufficient ETH for transaction fees");

    expect(wdkState.account.transfer).not.toHaveBeenCalled();
  });
});
