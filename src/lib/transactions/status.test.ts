import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshTransactionStatuses, resolveTransactionStatus } from "./status";
import type { TransactionRecord } from "../types";

const baseTx: TransactionRecord = {
  id: "tx-1",
  walletId: "wallet-1",
  chain: "ethereum",
  asset: "ETH",
  from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  to: "0x0000000000000000000000000000000000000001",
  amount: "1",
  status: "pending",
  txHash: "0xabc",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("transaction status resolver", () => {
  it("marks successful EVM receipts as confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: { status: "0x1" } })));
    await expect(resolveTransactionStatus(baseTx)).resolves.toBe("confirmed");
  });

  it("marks failed EVM receipts as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: { status: "0x0" } })));
    await expect(resolveTransactionStatus(baseTx)).resolves.toBe("failed");
  });

  it("keeps recent missing EVM receipts pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: null })));
    await expect(resolveTransactionStatus({ ...baseTx, createdAt: new Date().toISOString() })).resolves.toBe("pending");
  });

  it("marks long-pending EVM receipts as dropped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: null })));
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await expect(resolveTransactionStatus({ ...baseTx, createdAt: stale })).resolves.toBe("dropped");
  });

  it("marks long-pending Solana signatures as dropped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: { value: [null] } })));
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await expect(resolveTransactionStatus({ ...baseTx, chain: "solana", asset: "SOL", txHash: "sig", createdAt: stale })).resolves.toBe("dropped");
  });

  it("marks finalized Solana signatures as confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: { value: [{ err: null, confirmationStatus: "finalized", confirmations: null }] } })));
    await expect(resolveTransactionStatus({ ...baseTx, chain: "solana", asset: "SOL", txHash: "sig" })).resolves.toBe("confirmed");
  });

  it("marks failed Solana signatures as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ result: { value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] } })));
    await expect(resolveTransactionStatus({ ...baseTx, chain: "solana", asset: "SOL", txHash: "sig" })).resolves.toBe("failed");
  });

  it("marks confirmed Bitcoin transactions as confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ confirmed: true })));
    await expect(resolveTransactionStatus({ ...baseTx, chain: "bitcoin", asset: "BTC", txHash: "hash" })).resolves.toBe("confirmed");
  });

  it("keeps unconfirmed Bitcoin transactions pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ confirmed: false })));
    await expect(resolveTransactionStatus({ ...baseTx, chain: "bitcoin", asset: "BTC", txHash: "hash" })).resolves.toBe("pending");
  });

  it("leaves status unchanged when RPC fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("RPC unavailable"); }));

    const transactions = [baseTx];

    await expect(resolveTransactionStatus(baseTx)).resolves.toBeUndefined();
    await expect(refreshTransactionStatuses(transactions)).resolves.toBe(transactions);
  });

  it("returns the original transaction array when no statuses change", async () => {
    const confirmed = { ...baseTx, status: "confirmed" } as const;
    const transactions: TransactionRecord[] = [confirmed];
    const refreshed = await refreshTransactionStatuses(transactions);

    expect(refreshed).toBe(transactions);
    expect(refreshed).toEqual([confirmed]);
  });

  it("leaves unsupported pending transactions unchanged", async () => {
    await expect(resolveTransactionStatus({ ...baseTx, chain: "spark", asset: "SATS", txHash: "spark" })).resolves.toBeUndefined();
  });
});

function response(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}
