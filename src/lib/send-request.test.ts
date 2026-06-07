import { describe, expect, it } from "vitest";
import {
  assertExecutableSendRequest,
  assertSendRequestAllowedForWallet,
  previewSendRequest
} from "./send-request";
import type { AccountRecord, SendRequest, WalletRecord } from "./types";

const recipient = "0x0000000000000000000000000000000000000001";
const wallet: WalletRecord = {
  id: "wallet-1",
  name: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  accountCount: 1
};
const account: AccountRecord = {
  walletId: "wallet-1",
  chain: "ethereum",
  index: 0,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  path: "m/44'/60'/0'/0/0"
};

describe("send request rules", () => {
  it("derives popup preview state from the same field rules used by submit", () => {
    const preview = previewSendRequest({
      walletId: "wallet-1",
      account,
      chain: "ethereum",
      asset: "ETH",
      accountIndex: 0,
      to: recipient,
      amount: "1"
    });

    expect(preview).toMatchObject({
      assetSupported: true,
      canReview: true,
      fieldError: undefined,
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 0,
        to: recipient,
        amount: "1"
      }
    });
  });

  it("keeps popup preview disabled when required local context is missing", () => {
    const preview = previewSendRequest({
      walletId: "wallet-1",
      account: undefined,
      chain: "ethereum",
      asset: "ETH",
      accountIndex: 0,
      to: recipient,
      amount: "1"
    });

    expect(preview.assetSupported).toBe(true);
    expect(preview.fieldError).toBeUndefined();
    expect(preview.canReview).toBe(false);
  });

  it("preserves background submit error messages", () => {
    expect(() => assertSendRequestAllowedForWallet(validRequest(), undefined)).toThrow("Selected wallet was not found");
    expect(() => assertSendRequestAllowedForWallet({ ...validRequest(), accountIndex: 1 }, wallet)).toThrow(
      "Selected account is not available for this wallet"
    );
    expect(() => assertSendRequestAllowedForWallet({ ...validRequest(), asset: "XAUt", chain: "polygon" }, wallet)).toThrow(
      "XAUt is not configured for Polygon"
    );
    expect(() => assertSendRequestAllowedForWallet({ ...validRequest(), to: "not-an-address" }, wallet)).toThrow(
      "Invalid recipient address for selected network"
    );
    expect(() => assertSendRequestAllowedForWallet({ ...validRequest(), amount: "0" }, wallet)).toThrow("Invalid amount");
  });

  it("keeps WDK executable validation order before loading a runtime", () => {
    expect(() => assertExecutableSendRequest({ ...validRequest(), to: "not-an-address", asset: "XAUt", chain: "polygon" })).toThrow(
      "Invalid recipient address for selected network"
    );
    expect(() => assertExecutableSendRequest({ ...validRequest(), asset: "XAUt", chain: "polygon" })).toThrow(
      "XAUt is not configured for Polygon"
    );
  });
});

function validRequest(): SendRequest {
  return {
    walletId: "wallet-1",
    chain: "ethereum",
    asset: "ETH",
    accountIndex: 0,
    to: recipient,
    amount: "1"
  };
}
