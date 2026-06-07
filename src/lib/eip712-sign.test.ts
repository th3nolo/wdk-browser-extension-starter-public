import { describe, expect, it } from "vitest";
import { parseSignTypedDataParams, serializeTypedDataForDedup, summarizeTypedData } from "./eip712-sign";

const connected = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const typedData = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" }
    ],
    Mail: [{ name: "contents", type: "string" }]
  },
  primaryType: "Mail",
  domain: {
    name: "Example",
    version: "1",
    chainId: 1,
    verifyingContract: "0x0000000000000000000000000000000000000001"
  },
  message: { contents: "Hello" }
};

describe("EIP-712 signing params", () => {
  it("parses eth_signTypedData_v4 params in address-first order", () => {
    const parsed = parseSignTypedDataParams(
      [connected, typedData],
      connected,
      1
    );
    expect(parsed.primaryType).toBe("Mail");
    expect(parsed.message.contents).toBe("Hello");
  });

  it("rejects mismatched signing accounts", () => {
    expect(() => parseSignTypedDataParams(
      ["0x0000000000000000000000000000000000000001", typedData],
      connected,
      1
    )).toThrow("does not match connected account");
  });

  it("rejects domain.chainId that does not match the connected chain", () => {
    expect(() => parseSignTypedDataParams(
      [connected, typedData],
      connected,
      42161
    )).toThrow("domain.chainId (1) does not match connected chain (42161)");
  });

  it("accepts absent domain.chainId", () => {
    const withoutChain = {
      ...typedData,
      domain: { ...typedData.domain, chainId: undefined }
    };
    delete withoutChain.domain.chainId;
    expect(parseSignTypedDataParams([connected, withoutChain], connected, 42161).primaryType).toBe("Mail");
  });

  it("normalizes hex and string domain.chainId values", () => {
    const hexChain = {
      ...typedData,
      domain: { ...typedData.domain, chainId: "0x1" }
    };
    expect(parseSignTypedDataParams([connected, hexChain], connected, 1).primaryType).toBe("Mail");
  });

  it("creates stable dedupe keys", () => {
    const first = serializeTypedDataForDedup(parseSignTypedDataParams(
      [connected, typedData],
      connected,
      1
    ));
    const second = serializeTypedDataForDedup(parseSignTypedDataParams(
      [connected, JSON.stringify(typedData)],
      connected,
      1
    ));
    expect(first).toBe(second);
  });

  it("summarizes typed data including chain ID", () => {
    expect(summarizeTypedData(parseSignTypedDataParams([connected, typedData], connected, 1))).toContain("Chain ID: 1");
  });
});
