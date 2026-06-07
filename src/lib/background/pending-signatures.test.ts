import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initPendingSignatures,
  listPendingSignatures,
  queuePendingSignature,
  rejectPendingSignature,
  removePendingSignature,
  resetPendingSignaturesForTests,
  resolvePendingSignature
} from "./pending-signatures";
import {
  DAPP_APPROVAL_OUTCOMES_STORAGE_KEY,
  DAPP_APPROVALS_STORAGE_KEY
} from "./pending-dapp-approvals";
import {
  listPendingDappTransactions,
  queuePendingDappTransaction,
  rejectPendingDappTransaction
} from "./pending-dapp-transactions";

let sessionStorage: Record<string, unknown> = {};

async function waitForQueuedPending(walletId = "wallet-1") {
  await vi.waitFor(() => {
    expect(listPendingSignatures(walletId).length).toBeGreaterThan(0);
  });
  return listPendingSignatures(walletId)[0];
}

async function waitForQueuedCount(count: number, walletId = "wallet-1") {
  await vi.waitFor(() => {
    expect(listPendingSignatures(walletId)).toHaveLength(count);
  });
  return listPendingSignatures(walletId);
}

beforeEach(() => {
  sessionStorage = {};
  resetPendingSignaturesForTests();
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
  resetPendingSignaturesForTests();
});

describe("pending signature queue", () => {
  it("persists pending signature requests to session storage", async () => {
    const pending = queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    const queued = await waitForQueuedPending();

    expect(queued).toMatchObject({
      origin: "https://dapp.example",
      walletId: "wallet-1",
      message: "hello"
    });
    expect(sessionStorage[DAPP_APPROVALS_STORAGE_KEY]).toBeTruthy();

    await resolvePendingSignature(queued.id, "0xsigned");
    await expect(pending).resolves.toBe("0xsigned");
    expect(listPendingSignatures("wallet-1")).toHaveLength(0);
  });

  it("serializes concurrent approval persistence so later requests are not lost", async () => {
    const storage = browser.storage.session as unknown as {
      set: ReturnType<typeof vi.fn>;
    };
    const delayedWrites: Array<() => void> = [];
    let approvalWrites = 0;
    storage.set.mockImplementation(async (items: Record<string, unknown>) => {
      if (DAPP_APPROVALS_STORAGE_KEY in items && approvalWrites === 0) {
        approvalWrites += 1;
        await new Promise<void>((resolve) => {
          delayedWrites.push(() => {
            Object.assign(sessionStorage, items);
            resolve();
          });
        });
        return;
      }
      if (DAPP_APPROVALS_STORAGE_KEY in items) approvalWrites += 1;
      Object.assign(sessionStorage, items);
    });

    const first = queuePendingSignature("https://dapp.example", "wallet-1", 0, "first");
    await vi.waitFor(() => {
      expect(delayedWrites).toHaveLength(1);
    });
    const second = queuePendingSignature("https://dapp.example", "wallet-1", 0, "second");

    delayedWrites[0]();
    const queued = await waitForQueuedCount(2);
    const persisted = sessionStorage[DAPP_APPROVALS_STORAGE_KEY] as Array<{ message: string }>;
    expect(persisted.map((entry) => entry.message).sort()).toEqual(["first", "second"]);

    await rejectPendingSignature(queued.find((request) => request.message === "first")!.id);
    await rejectPendingSignature(queued.find((request) => request.message === "second")!.id);
    await expect(first).rejects.toThrow("User rejected signature request");
    await expect(second).rejects.toThrow("User rejected signature request");
  });

  it("restores pending signature requests after service worker restart", async () => {
    void queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    await waitForQueuedPending();
    resetPendingSignaturesForTests();

    await initPendingSignatures();

    expect(listPendingSignatures("wallet-1")).toHaveLength(1);
    expect(listPendingSignatures("wallet-1")[0]).toMatchObject({ message: "hello" });
  });

  it("drops malformed unified signature approvals instead of casting them", async () => {
    sessionStorage[DAPP_APPROVALS_STORAGE_KEY] = [{
      id: "malformed-signature",
      approvalKind: "signature",
      walletId: "wallet-1",
      dedupeKey: "signature:https://dapp.example|wallet-1|0|personal_sign|hello",
      expiresAt: Date.now() + 1000
    }];

    await initPendingSignatures();

    expect(listPendingSignatures("wallet-1")).toHaveLength(0);
  });

  it("expires persisted signature requests after TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    void queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    await waitForQueuedPending();
    resetPendingSignaturesForTests();
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

    await initPendingSignatures();

    expect(listPendingSignatures("wallet-1")).toHaveLength(0);
  });

  it("rejects pending signature requests and clears storage", async () => {
    const pending = queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    const queued = await waitForQueuedPending();

    await rejectPendingSignature(queued.id);

    await expect(pending).rejects.toThrow("User rejected signature request");
    expect(listPendingSignatures("wallet-1")).toHaveLength(0);
  });

  it("delivers resolved signatures after service worker restart via session storage outcomes", async () => {
    void queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    const queued = await waitForQueuedPending();

    resetPendingSignaturesForTests();
    await initPendingSignatures();

    await resolvePendingSignature(queued.id, "0xsigned");

    const retry = queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    await expect(retry).resolves.toBe("0xsigned");
    expect(listPendingSignatures("wallet-1")).toHaveLength(0);
  });

  it("drops malformed stored signature outcomes instead of resolving from them", async () => {
    sessionStorage[DAPP_APPROVAL_OUTCOMES_STORAGE_KEY] = {
      "signature:https://dapp.example|wallet-1|0|personal_sign|hello": {
        status: "resolved",
        approvalKind: "signature",
        signature: 123
      }
    };

    const pending = queuePendingSignature("https://dapp.example", "wallet-1", 0, "hello");
    const queued = await waitForQueuedPending();

    expect(queued).toMatchObject({ message: "hello" });
    expect(sessionStorage[DAPP_APPROVAL_OUTCOMES_STORAGE_KEY]).toBeUndefined();

    await rejectPendingSignature(queued.id);
    await expect(pending).rejects.toThrow("User rejected signature request");
  });

  it("dedupes typed-data signatures by request kind", async () => {
    const typedData = {
      domain: { chainId: 1 },
      types: { EIP712Domain: [], Mail: [{ name: "contents", type: "string" }] },
      primaryType: "Mail",
      message: { contents: "Hello" }
    };
    const v3 = queuePendingSignature("https://dapp.example", "wallet-1", 0, "typed", {
      kind: "eth_signTypedData_v3",
      typedData,
      displayMessage: "typed"
    });
    const v4 = queuePendingSignature("https://dapp.example", "wallet-1", 0, "typed", {
      kind: "eth_signTypedData_v4",
      typedData,
      displayMessage: "typed"
    });

    const queued = await waitForQueuedCount(2);
    expect(queued.map((request) => request.kind).sort()).toEqual(["eth_signTypedData_v3", "eth_signTypedData_v4"]);

    await resolvePendingSignature(queued.find((request) => request.kind === "eth_signTypedData_v3")!.id, "0xv3");
    await resolvePendingSignature(queued.find((request) => request.kind === "eth_signTypedData_v4")!.id, "0xv4");
    await expect(v3).resolves.toBe("0xv3");
    await expect(v4).resolves.toBe("0xv4");
  });

  it("does not remove transaction approvals through the signature facade", async () => {
    const pending = queuePendingDappTransaction(
      "https://dapp.example",
      "wallet-1",
      0,
      "ethereum",
      "dedupe-1",
      { to: "0x0000000000000000000000000000000000000001", value: 1n }
    );
    await vi.waitFor(() => {
      expect(listPendingDappTransactions("wallet-1")).toHaveLength(1);
    });
    const queued = listPendingDappTransactions("wallet-1")[0];

    await expect(removePendingSignature(queued.id)).resolves.toBeUndefined();
    expect(listPendingDappTransactions("wallet-1")).toHaveLength(1);

    await rejectPendingDappTransaction(queued.id);
    await expect(pending).rejects.toThrow("User rejected transaction request");
  });
});
