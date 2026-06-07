import { describe, expect, it } from "vitest";
import { PROVIDER_RPC_ERROR_CODES } from "./errors";
import { INPAGE_TO_CONTENT } from "./constants";
import { parseInpageRequestMessage } from "./rpc";

describe("provider request parser", () => {
  it("ignores messages that are not addressed to the content bridge", () => {
    expect(parseInpageRequestMessage({ target: "other", id: "1", method: "eth_accounts" })).toBeUndefined();
    expect(parseInpageRequestMessage(null)).toBeUndefined();
  });

  it("accepts well-formed provider requests", () => {
    expect(parseInpageRequestMessage({
      target: INPAGE_TO_CONTENT,
      id: "request-1",
      method: "personal_sign",
      params: ["hello", "0x0000000000000000000000000000000000000000"]
    })).toEqual({
      ok: true,
      request: {
        id: "request-1",
        method: "personal_sign",
        params: ["hello", "0x0000000000000000000000000000000000000000"]
      }
    });
  });

  it("rejects malformed request methods and params with a response id", () => {
    expect(parseInpageRequestMessage({ target: INPAGE_TO_CONTENT, id: "request-2", method: "" })).toEqual({
      ok: false,
      id: "request-2",
      error: { code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD, message: "Invalid provider method" }
    });
    expect(parseInpageRequestMessage({ target: INPAGE_TO_CONTENT, id: "request-3", method: "eth_accounts", params: "bad" })).toEqual({
      ok: false,
      id: "request-3",
      error: { code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD, message: "Invalid provider params" }
    });
  });

  it("ignores malformed requests without a usable response id", () => {
    expect(parseInpageRequestMessage({ target: INPAGE_TO_CONTENT, id: "", method: "eth_accounts" })).toBeUndefined();
    expect(parseInpageRequestMessage({ target: INPAGE_TO_CONTENT, method: "eth_accounts" })).toBeUndefined();
  });
});
