import { describe, expect, it } from "vitest";
import { formatBaseUnitsForDisplay } from "./decimal-amount";

describe("formatBaseUnitsForDisplay", () => {
  it("formats wei-scale balances with trimmed trailing zeros", () => {
    expect(formatBaseUnitsForDisplay("1230000000000000000", 18)).toBe("1.23");
  });

  it("caps fractional digits for aggregated balances", () => {
    expect(formatBaseUnitsForDisplay("123456789", 6)).toBe("123.456789");
    expect(formatBaseUnitsForDisplay("1234567890123456789", 18)).toBe("1.23456789");
  });

  it("truncates extremely large whole amounts for display", () => {
    const huge = `${"9".repeat(30)}0`;
    expect(formatBaseUnitsForDisplay(huge, 1)).toMatch(/…$/);
  });
});
