import { describe, expect, it, test } from "vitest";
import { calldataByteLength, calldataDigest } from "../calldata";
import {
  buildPersonalSignVerificationEvidence,
  buildTransactionVerificationEvidence,
  buildTypedDataVerificationEvidence,
  captureRawDappRequestParams,
  personalSignDigest,
  rawRequestDigest
} from "../evidence";
import { safeDomainIncludesChainId, safeTxHash, type SafeTx } from "../safe";
import { eip712DigestEvidence } from "../typed-data";
import { calldataVectors, rawRequestVector, safeVectors, typedDataVectors } from "../__fixtures__/vectors";

describe("WYSIWYS reference vectors", () => {
  test.each(calldataVectors)("$name calldata digest", (vector) => {
    expect(calldataDigest(vector.calldata)).toBe(vector.expected);
  });

  test.each(typedDataVectors)("$name EIP-712 digest evidence", (vector) => {
    expect(eip712DigestEvidence(vector.payload)).toEqual(vector.expected);
  });

  test.each(safeVectors)("$name SafeTx hash", (vector) => {
    expect(safeTxHash(toSafeTx(vector.tx), vector.safe, BigInt(vector.chainId), vector.version)).toBe(vector.expected);
  });

  it("computes nested Safe approveHash calldata length from the checked-in vector", () => {
    const nested = safeVectors[2];
    expect(nested.innerHash).toBe(safeVectors[0].expected);
    expect(calldataByteLength(nested.tx.data)).toBe(36);
  });

  it("computes personal_sign EIP-191 digest for UTF-8 and raw hex bytes", () => {
    expect(personalSignDigest("Hello", "utf8")).toBe("0xaa744ba2ca576ec62ca0045eca00ad3917fdf7ffa34fbbae50828a5a69c1580e");
    expect(personalSignDigest("0x48656c6c6f", "hex")).toBe("0xaa744ba2ca576ec62ca0045eca00ad3917fdf7ffa34fbbae50828a5a69c1580e");
  });

  it("builds transaction evidence from immutable raw dApp params", () => {
    const raw = captureRawDappRequestParams(rawRequestVector.params);
    expect(Object.isFrozen(raw)).toBe(true);
    const tx = {
      from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      to: rawRequestVector.params[0].to,
      value: 0n,
      data: rawRequestVector.params[0].data
    };
    const evidence = buildTransactionVerificationEvidence(raw, tx);
    expect(evidence.kind).toBe("eth_sendTransaction");
    expect(evidence.calldataDigest).toBe(calldataVectors[1].expected);
    expect(evidence.verifiedByVectors).toBe(true);
    expect(evidence.requestDigest).toBe(rawRequestDigest(rawRequestVector.params).digest);
  });

  it("builds signature evidence for personal_sign and typed data", () => {
    const personal = buildPersonalSignVerificationEvidence(["Hello", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"], {
      message: "Hello",
      displayMessage: "Hello",
      messageEncoding: "utf8",
      messageByteLength: 5
    });
    expect(personal.messageDigest).toBe("0xaa744ba2ca576ec62ca0045eca00ad3917fdf7ffa34fbbae50828a5a69c1580e");

    const typed = buildTypedDataVerificationEvidence(
      ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94", typedDataVectors[0].payload],
      "eth_signTypedData_v4",
      typedDataVectors[0].payload
    );
    expect(typed.kind).toBe("eth_signTypedData_v4");
    expect(typed.finalDigest).toBe(typedDataVectors[0].expected.finalDigest);
    expect(typed.domainSeparator).toBe(typedDataVectors[0].expected.domainSeparator);
    expect(typed.messageHash).toBe(typedDataVectors[0].expected.messageHash);
  });
});

describe("WYSIWYS negative vectors", () => {
  it("rejects malformed calldata", () => {
    expect(() => calldataDigest("0x123")).toThrow("Invalid calldata");
    expect(() => calldataDigest("0xzz")).toThrow("Invalid calldata");
  });

  it("rejects unsupported typed-data field types", () => {
    expect(() => eip712DigestEvidence({
      domain: {},
      primaryType: "Bad",
      types: { Bad: [{ name: "value", type: "fixed128x18" }] },
      message: { value: "1" }
    })).toThrow("Unsupported EIP-712 field type");
  });

  it("rejects wrong Safe version and proves the Safe domain boundary changes the hash", () => {
    const tx = toSafeTx(safeVectors[0].tx);
    expect(() => safeDomainIncludesChainId("not-a-version")).toThrow("Invalid Safe version");
    expect(safeTxHash(tx, safeVectors[0].safe, 1n, "1.4.1")).not.toBe(safeTxHash(tx, safeVectors[0].safe, 1n, "1.2.0"));
  });
});

function toSafeTx(tx: typeof safeVectors[number]["tx"]): SafeTx {
  return {
    to: tx.to,
    value: BigInt(tx.value),
    data: tx.data,
    operation: tx.operation,
    safeTxGas: BigInt(tx.safeTxGas),
    baseGas: BigInt(tx.baseGas),
    gasPrice: BigInt(tx.gasPrice),
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: BigInt(tx.nonce)
  };
}
