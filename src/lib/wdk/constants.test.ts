import { describe, expect, it } from "vitest";
import { EVM_TRANSFER_MAX_FEE_WEI } from "./constants";

describe("WDK EVM constants", () => {
  it("defines transferMaxFee as 0.0001 ETH in wei", () => {
    expect(EVM_TRANSFER_MAX_FEE_WEI).toBe(100_000_000_000_000n);
  });
});
