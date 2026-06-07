import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAPP_TRANSACTION_TTL_MS,
  initPendingDappTransactions,
  listPendingDappTransactions,
  queuePendingDappTransaction,
  rejectPendingDappTransaction,
  removePendingDappTransaction,
  resetPendingDappTransactionsForTests,
  resolvePendingDappTransaction
} from "./pending-dapp-transactions";
import type { ParsedDappEvmTransaction } from "../dapp-transaction";
import {
  DAPP_APPROVAL_OUTCOMES_STORAGE_KEY,
  DAPP_APPROVALS_STORAGE_KEY
} from "./pending-dapp-approvals";
import {
  listPendingSignatures,
  queuePendingSignature,
  rejectPendingSignature
} from "./pending-signatures";

let sessionStorage: Record<string, unknown> = {};

const parsedTx: ParsedDappEvmTransaction = {
  to: "0x0000000000000000000000000000000000000001",
  value: 1n
};

async function waitForQueuedPending(walletId = "wallet-1") {
  await vi.waitFor(() => {
    expect(listPendingDappTransactions(walletId).length).toBeGreaterThan(0);
  });
  return listPendingDappTransactions(walletId)[0];
}

beforeEach(() => {
  sessionStorage = {};
  resetPendingDappTransactionsForTests();
  vi.stubGlobal("browser", {
    storage: {
      session: {
        get: vi.fn(async (key?: string | string[] | Record<string, unknown> | null) => {
          if (typeof key === "string") return { [key]: sessionStorage[key] };
          return { ...sessionStorage };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionStorage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStorage[key];
        })
      }
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  resetPendingDappTransactionsForTests();
});

describe("pending dApp transaction queue", () => {
  it("persists pending transaction requests to session storage", async () => {
    const pending = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    const queued = await waitForQueuedPending();

    expect(queued).toMatchObject({
      origin: "https://dapp.example",
      walletId: "wallet-1",
      chain: "ethereum",
      to: parsedTx.to,
      value: "1"
    });
    expect(sessionStorage[DAPP_APPROVALS_STORAGE_KEY]).toBeTruthy();
    expect((sessionStorage[DAPP_APPROVALS_STORAGE_KEY] as Array<{ value: string }>)[0].value).toBe("1");

    await resolvePendingDappTransaction(queued.id, "0xtxhash");
    await expect(pending).resolves.toBe("0xtxhash");
    expect(listPendingDappTransactions("wallet-1")).toHaveLength(0);
  });

  it("dedupes equivalent live requests and resolves both waiters", async () => {
    const first = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    const queued = await waitForQueuedPending();
    const second = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);

    expect(listPendingDappTransactions("wallet-1")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await resolvePendingDappTransaction(queued.id, "0xtxhash");

    await expect(first).resolves.toBe("0xtxhash");
    await expect(second).resolves.toBe("0xtxhash");
  });

  it("restores pending transaction requests after service worker restart", async () => {
    void queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    await waitForQueuedPending();
    resetPendingDappTransactionsForTests();

    await initPendingDappTransactions();

    expect(listPendingDappTransactions("wallet-1")).toEqual([expect.objectContaining({ value: "1" })]);
  });

  it("drops malformed unified transaction approvals instead of casting them", async () => {
    sessionStorage[DAPP_APPROVALS_STORAGE_KEY] = [{
      id: "malformed-transaction",
      approvalKind: "transaction",
      walletId: "wallet-1",
      dedupeKey: "transaction:https://dapp.example|wallet-1|0|dedupe-1",
      expiresAt: Date.now() + 1000
    }];

    await initPendingDappTransactions();

    expect(listPendingDappTransactions("wallet-1")).toHaveLength(0);
  });

  it("expires queued transaction requests at the dApp approval TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const pending = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    await waitForQueuedPending();

    const rejection = expect(pending).rejects.toThrow("Transaction request timed out");
    await vi.advanceTimersByTimeAsync(DAPP_TRANSACTION_TTL_MS + 1);

    await rejection;
    expect(listPendingDappTransactions("wallet-1")).toHaveLength(0);
  });

  it("delivers rejected outcomes after service worker restart via session storage", async () => {
    void queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    const queued = await waitForQueuedPending();

    resetPendingDappTransactionsForTests();
    await initPendingDappTransactions();
    await rejectPendingDappTransaction(queued.id, "User rejected transaction request");

    const retry = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    await expect(retry).rejects.toThrow("User rejected transaction request");
  });

  it("drops malformed stored transaction outcomes instead of resolving from them", async () => {
    sessionStorage[DAPP_APPROVAL_OUTCOMES_STORAGE_KEY] = {
      "transaction:https://dapp.example|wallet-1|0|dedupe-1": {
        status: "resolved",
        approvalKind: "transaction",
        txHash: 123
      }
    };

    const pending = queuePendingDappTransaction("https://dapp.example", "wallet-1", 0, "ethereum", "dedupe-1", parsedTx);
    const queued = await waitForQueuedPending();

    expect(queued).toMatchObject({ chain: "ethereum", value: "1" });
    expect(sessionStorage[DAPP_APPROVAL_OUTCOMES_STORAGE_KEY]).toBeUndefined();

    await rejectPendingDappTransaction(queued.id);
    await expect(pending).rejects.toThrow("User rejected transaction request");
  });

  it("does not remove signature approvals through the transaction facade", async () => {
    const pending = queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    await vi.waitFor(() => {
      expect(listPendingSignatures("wallet-1")).toHaveLength(1);
    });
    const queued = listPendingSignatures("wallet-1")[0];

    await expect(removePendingDappTransaction(queued.id)).resolves.toBeUndefined();
    expect(listPendingSignatures("wallet-1")).toHaveLength(1);

    await rejectPendingSignature(queued.id);
    await expect(pending).rejects.toThrow("User rejected signature request");
  });
});
