import type { AssetId, BalanceRecord, ChainId } from "./types";

export type AssetChainBalance = {
  chain: ChainId;
  amount: string;
};

/**
 * One logical asset aggregated across every chain it lives on. Avoids the
 * "duplicate tokens are confusing" problem (e.g. USDt on Ethereum + Polygon +
 * Arbitrum) by collapsing same-symbol balances into a single total, with the
 * per-chain breakdown preserved for an expandable view.
 */
export type GroupedAssetBalance = {
  asset: AssetId;
  symbol: string;
  decimals: number;
  totalAmount: string;
  chains: AssetChainBalance[];
};

function compareAmountsDesc(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue === rightValue) return 0;
  return rightValue > leftValue ? 1 : -1;
}

/**
 * Group balances by asset symbol, summing base-unit amounts. Same-symbol assets
 * share decimals across chains (USDt = 6, ETH = 18, …) so the sum is exact.
 * Group order follows first appearance; within a group, chains are ordered by
 * balance (largest first) so the most relevant network leads the breakdown.
 */
export function groupBalancesByAsset(balances: BalanceRecord[]): GroupedAssetBalance[] {
  const groups = new Map<AssetId, GroupedAssetBalance>();
  for (const balance of balances) {
    const existing = groups.get(balance.asset);
    if (existing) {
      existing.totalAmount = (BigInt(existing.totalAmount) + BigInt(balance.amount)).toString();
      existing.chains.push({ chain: balance.chain, amount: balance.amount });
    } else {
      groups.set(balance.asset, {
        asset: balance.asset,
        symbol: balance.symbol,
        decimals: balance.decimals,
        totalAmount: balance.amount,
        chains: [{ chain: balance.chain, amount: balance.amount }]
      });
    }
  }
  for (const group of groups.values()) {
    group.chains.sort((left, right) => compareAmountsDesc(left.amount, right.amount));
  }
  return [...groups.values()];
}

export function isMultiChainAsset(group: GroupedAssetBalance): boolean {
  return group.chains.length > 1;
}
