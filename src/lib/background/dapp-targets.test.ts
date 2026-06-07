import { beforeEach, describe, expect, it, vi } from "vitest";
import { dappMessageTargetsForOrigin, recordDappMessageTarget } from "./dapp-targets";

let sessionStorage: Record<string, unknown>;

beforeEach(() => {
  sessionStorage = {};
  vi.stubGlobal("browser", {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
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

function sender(tabId: number, documentId: string): Browser.runtime.MessageSender {
  return {
    tab: { id: tabId } as Browser.tabs.Tab,
    documentId
  };
}

describe("dapp message targets", () => {
  it("serializes concurrent target records so document targets are not lost", async () => {
    await Promise.all([
      recordDappMessageTarget("https://dapp.example", sender(1, "doc-1")),
      recordDappMessageTarget("https://dapp.example", sender(2, "doc-2"))
    ]);

    await expect(dappMessageTargetsForOrigin("https://dapp.example")).resolves.toEqual([
      expect.objectContaining({ origin: "https://dapp.example", tabId: 1, documentId: "doc-1" }),
      expect.objectContaining({ origin: "https://dapp.example", tabId: 2, documentId: "doc-2" })
    ]);
  });
});
