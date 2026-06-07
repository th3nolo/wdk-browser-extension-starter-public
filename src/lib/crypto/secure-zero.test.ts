import { describe, expect, it } from "vitest";
import { secureZeroBytes } from "./secure-zero";

describe("secureZeroBytes", () => {
  it("fills a byte buffer with zeros", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    secureZeroBytes(bytes);
    expect([...bytes]).toEqual([0, 0, 0, 0]);
  });
});
