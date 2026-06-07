import { describe, expect, it } from "vitest";
import { groupBalancesByAsset, isMultiChainAsset } from "./balance-grouping";
import type { BalanceRecord } from "./types";

function balance(chain: BalanceRecord["chain"], asset: BalanceRecord["asset"], amount: string, decimals: number): BalanceRecord {
  return { chain, asset, amount, symbol: asset, decimals };
}

describe("groupBalancesByAsset", () => {
  it("aggregates the same asset across chains into one total", () => {
    const groups = groupBalancesByAsset([
      balance("ethereum", "USDt", "1000000", 6),
      balance("polygon", "USDt", "500000", 6),
      balance("arbitrum", "USDt", "0", 6)
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ asset: "USDt", decimals: 6, totalAmount: "1500000" });
    expect(groups[0].chains).toHaveLength(3);
    expect(isMultiChainAsset(groups[0])).toBe(true);
  });

  it("orders chains within a group by balance, largest first", () => {
    const [group] = groupBalancesByAsset([
      balance("arbitrum", "ETH", "1000000000000000000", 18),
      balance("ethereum", "ETH", "3000000000000000000", 18)
    ]);

    expect(group.totalAmount).toBe("4000000000000000000");
    expect(group.chains.map((entry) => entry.chain)).toEqual(["ethereum", "arbitrum"]);
  });

  it("keeps single-chain assets as their own non-expandable group", () => {
    const groups = groupBalancesByAsset([
      balance("polygon", "POL", "250000000000000000", 18),
      balance("solana", "SOL", "9000000", 9)
    ]);

    expect(groups.map((group) => group.asset)).toEqual(["POL", "SOL"]);
    expect(groups.every((group) => !isMultiChainAsset(group))).toBe(true);
  });

  it("preserves first-appearance order across distinct assets", () => {
    const groups = groupBalancesByAsset([
      balance("ethereum", "ETH", "1", 18),
      balance("ethereum", "USDt", "1", 6),
      balance("arbitrum", "ETH", "1", 18)
    ]);

    expect(groups.map((group) => group.asset)).toEqual(["ETH", "USDt"]);
  });

  it("returns nothing for an empty balance list", () => {
    expect(groupBalancesByAsset([])).toEqual([]);
  });
});
