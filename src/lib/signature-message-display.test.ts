import { describe, expect, it } from "vitest";
import {
  looksLikeEip712PersonalSign,
  personalSignEncodingLabel,
  signatureMessageScrollHint
} from "./signature-message-display";

describe("signature message display", () => {
  it("labels utf8 and hex encodings", () => {
    expect(personalSignEncodingLabel("utf8")).toContain("UTF-8");
    expect(personalSignEncodingLabel("hex")).toContain("raw bytes");
  });

  it("detects EIP-712-like JSON in personal_sign payloads", () => {
    const typed = JSON.stringify({
      types: { Mail: [{ name: "contents", type: "string" }] },
      primaryType: "Mail",
      domain: { name: "Example", version: "1", chainId: 1 },
      message: { contents: "Hello" }
    });
    expect(looksLikeEip712PersonalSign(typed)).toBe(true);
    expect(looksLikeEip712PersonalSign("Sign in")).toBe(false);
  });

  it("suggests scrolling for large messages", () => {
    expect(signatureMessageScrollHint(100)).toBeUndefined();
    expect(signatureMessageScrollHint(600)).toContain("Scroll");
  });
});
