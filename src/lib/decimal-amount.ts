const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/;

/** Cap displayed fractional digits so aggregated base-unit sums stay readable. */
export const MAX_DISPLAY_FRACTION_DIGITS = 8;

/** Whole-digit cap before truncating with an ellipsis suffix. */
export const MAX_DISPLAY_WHOLE_DIGITS = 24;

export function parseDecimalAmount(amount: string): { whole: string; fraction: string } | null {
  if (!DECIMAL_AMOUNT.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  return { whole, fraction };
}

export function isPositiveDecimalAmount(amount: string): boolean {
  const parsed = parseDecimalAmount(amount);
  if (!parsed) return false;
  if (BigInt(parsed.whole) > 0n) return true;
  return parsed.fraction.length > 0 && parsed.fraction.split("").some((digit) => digit !== "0");
}

export function decimalToBaseUnits(amount: string, decimals: number): bigint {
  const parsed = parseDecimalAmount(amount);
  if (!parsed) throw new Error("Invalid amount");
  if (parsed.fraction.length > decimals) throw new Error("Amount has too many decimal places");
  return BigInt(`${parsed.whole}${parsed.fraction.padEnd(decimals, "0")}`);
}

export function formatBaseUnitsForDisplay(
  amount: string,
  decimals: number,
  options: { maxFractionDigits?: number; maxWholeDigits?: number } = {}
): string {
  if (!/^\d+$/.test(amount)) return amount;

  const maxFractionDigits = options.maxFractionDigits ?? MAX_DISPLAY_FRACTION_DIGITS;
  const maxWholeDigits = options.maxWholeDigits ?? MAX_DISPLAY_WHOLE_DIGITS;
  const padded = amount.padStart(decimals + 1, "0");
  let whole = padded.slice(0, -decimals) || "0";
  let fraction = padded.slice(-decimals).replace(/0+$/, "");

  if (whole.length > maxWholeDigits) {
    whole = `${whole.slice(0, maxWholeDigits)}…`;
    fraction = "";
  } else if (fraction.length > maxFractionDigits) {
    fraction = fraction.slice(0, maxFractionDigits);
  }

  return fraction ? `${whole}.${fraction}` : whole;
}
