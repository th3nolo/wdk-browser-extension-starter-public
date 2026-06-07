import { CHAIN_BY_ID } from "../chains";
import { rpcFetchForChain } from "../rpc-fetch";
import type { RpcOverrides } from "../rpc-overrides";
import type { TransactionRecord, TransactionStatus } from "../types";

/**
 * How long an on-chain account-based transaction may stay unconfirmed before we
 * treat it as dropped/replaced. Receipt-less EVM and Solana transactions are
 * never re-broadcast by the wallet, so without this they would stay "pending"
 * forever. Bitcoin is excluded because legitimate mempool waits can exceed this.
 */
const PENDING_EXPIRY_MS = 6 * 60 * 60 * 1000;

function isPendingExpired(transaction: TransactionRecord): boolean {
  const submittedAt = Date.parse(transaction.createdAt);
  if (Number.isNaN(submittedAt)) return false;
  return Date.now() - submittedAt > PENDING_EXPIRY_MS;
}

export async function refreshTransactionStatuses(
  transactions: TransactionRecord[],
  rpcOverrides?: RpcOverrides
): Promise<TransactionRecord[]> {
  let changed = false;
  const refreshed = await Promise.all(transactions.map(async (transaction) => {
    const status = await resolveTransactionStatus(transaction, rpcOverrides);
    if (!status || status === transaction.status) return transaction;
    changed = true;
    return { ...transaction, status, updatedAt: new Date().toISOString() };
  }));
  return changed ? refreshed : transactions;
}

export async function resolveTransactionStatus(
  transaction: TransactionRecord,
  rpcOverrides?: RpcOverrides
): Promise<TransactionStatus | undefined> {
  if (transaction.status !== "pending" || !transaction.txHash) return undefined;
  const chain = CHAIN_BY_ID[transaction.chain];
  const override = rpcOverrides?.[transaction.chain];

  try {
    if (chain.family === "evm") {
      return promoteIfDropped(await evmTransactionStatus(transaction.chain, transaction.txHash, override), transaction);
    }
    if (chain.family === "solana") {
      return promoteIfDropped(await solanaTransactionStatus(transaction.chain, transaction.txHash, override), transaction);
    }
    if (chain.family === "btc" && chain.rpcUrl) return await bitcoinTransactionStatus(chain.rpcUrl, transaction.txHash);
    return undefined;
  } catch {
    return undefined;
  }
}

/** A still-pending account-based tx that has outlived the expiry window is treated as dropped. */
function promoteIfDropped(status: TransactionStatus | undefined, transaction: TransactionRecord): TransactionStatus | undefined {
  if (status === "pending" && isPendingExpired(transaction)) return "dropped";
  return status;
}

async function evmTransactionStatus(chainId: TransactionRecord["chain"], hash: string, override?: string): Promise<TransactionStatus | undefined> {
  const response = await rpcFetchForChain(chainId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] })
  }, override);
  const payload = await response.json() as { result?: { status?: string } | null };
  if (!payload.result) return "pending";
  if (payload.result.status === "0x0") return "failed";
  if (payload.result.status === "0x1") return "confirmed";
  return undefined;
}

async function solanaTransactionStatus(chainId: TransactionRecord["chain"], signature: string, override?: string): Promise<TransactionStatus | undefined> {
  const response = await rpcFetchForChain(chainId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [[signature], { searchTransactionHistory: true }] })
  }, override);
  const payload = await response.json() as {
    result?: { value?: Array<{ err?: unknown; confirmationStatus?: string; confirmations?: number | null } | null> };
  };
  const status = payload.result?.value?.[0];
  if (!status) return "pending";
  if (status.err) return "failed";
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" || status.confirmations === null) return "confirmed";
  return "pending";
}

async function bitcoinTransactionStatus(apiUrl: string, txHash: string): Promise<TransactionStatus | undefined> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/tx/${txHash}/status`);
  if (!response.ok) return undefined;
  const status = await response.json() as { confirmed?: boolean };
  return status.confirmed ? "confirmed" : "pending";
}
