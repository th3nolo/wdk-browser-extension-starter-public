import { describe, expect, it } from "vitest";
import { CONTENT_TO_INPAGE, INPAGE_TO_CONTENT } from "./constants";
import {
  attachBridgeMac,
  decodeBridgeSecret,
  encodeBridgeSecret,
  generateBridgeSecret,
  verifyBridgeMessage,
  verifyBridgePayload
} from "./bridge-auth";

describe("bridge auth", () => {
  it("round-trips encoded bridge secrets", () => {
    const secret = generateBridgeSecret();
    expect(decodeBridgeSecret(encodeBridgeSecret(secret))).toEqual(secret);
  });

  it("accepts payloads signed with the shared secret", async () => {
    const secret = generateBridgeSecret();
    const payload = await attachBridgeMac(secret, {
      target: INPAGE_TO_CONTENT,
      id: "request-1",
      method: "eth_accounts",
      params: []
    });

    expect(await verifyBridgePayload(secret, payload)).toBe(true);
    expect(await verifyBridgeMessage(secret, payload)).toEqual({
      target: INPAGE_TO_CONTENT,
      id: "request-1",
      method: "eth_accounts",
      params: []
    });
  });

  it("rejects forged or tampered bridge payloads", async () => {
    const secret = generateBridgeSecret();
    const otherSecret = generateBridgeSecret();
    const payload = await attachBridgeMac(secret, {
      target: CONTENT_TO_INPAGE,
      id: "request-1",
      result: ["0xabc"]
    });

    expect(await verifyBridgePayload(otherSecret, payload)).toBe(false);
    expect(await verifyBridgePayload(secret, { ...payload, result: ["0xdef"] })).toBe(false);
    expect(await verifyBridgeMessage(secret, { target: CONTENT_TO_INPAGE, id: "request-1" })).toBeUndefined();
  });
});
