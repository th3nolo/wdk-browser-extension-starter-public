import { createMutationChain } from "../storage/mutation-chain";

export const DAPP_TARGETS_STORAGE_KEY = "wdk-wallet-dapp-targets";

const TARGET_TTL_MS = 24 * 60 * 60 * 1000;
const targetMutationChain = createMutationChain();

export type DappMessageTarget = {
  origin: string;
  tabId: number;
  documentId?: string;
  frameId?: number;
  lastSeenAt: number;
};

function targetKey(target: Pick<DappMessageTarget, "origin" | "tabId" | "documentId" | "frameId">): string {
  return [
    target.origin,
    target.tabId,
    target.documentId ?? "",
    target.frameId ?? ""
  ].join("|");
}

function pruneTargets(targets: DappMessageTarget[], now = Date.now()): DappMessageTarget[] {
  return targets.filter((target) => now - target.lastSeenAt <= TARGET_TTL_MS);
}

async function readTargets(): Promise<DappMessageTarget[]> {
  const item = await browser.storage.session.get(DAPP_TARGETS_STORAGE_KEY);
  const targets = item[DAPP_TARGETS_STORAGE_KEY];
  if (!Array.isArray(targets)) return [];
  return pruneTargets(targets.filter((target): target is DappMessageTarget =>
    target
    && typeof target === "object"
    && typeof target.origin === "string"
    && typeof target.tabId === "number"
    && typeof target.lastSeenAt === "number"
    && (target.documentId === undefined || typeof target.documentId === "string")
    && (target.frameId === undefined || typeof target.frameId === "number")
  ));
}

async function writeTargets(targets: DappMessageTarget[]): Promise<void> {
  if (targets.length) {
    await browser.storage.session.set({ [DAPP_TARGETS_STORAGE_KEY]: targets });
    return;
  }
  await browser.storage.session.remove(DAPP_TARGETS_STORAGE_KEY);
}

export async function recordDappMessageTarget(origin: string, sender: Browser.runtime.MessageSender): Promise<void> {
  await targetMutationChain.run(async () => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") throw new Error("dApp requests must originate from a browser tab");
    const nextTarget: DappMessageTarget = {
      origin,
      tabId,
      documentId: sender.documentId,
      frameId: sender.frameId,
      lastSeenAt: Date.now()
    };
    const targets = await readTargets();
    const nextKey = targetKey(nextTarget);
    await writeTargets([
      ...targets.filter((target) => targetKey(target) !== nextKey),
      nextTarget
    ]);
  });
}

export async function dappMessageTargetsForOrigin(origin: string): Promise<DappMessageTarget[]> {
  const targets = await readTargets();
  return targets.filter((target) => target.origin === origin);
}

export async function removeDappMessageTarget(targetToRemove: DappMessageTarget): Promise<void> {
  await targetMutationChain.run(async () => {
    const removeKey = targetKey(targetToRemove);
    await writeTargets((await readTargets()).filter((target) => targetKey(target) !== removeKey));
  });
}
