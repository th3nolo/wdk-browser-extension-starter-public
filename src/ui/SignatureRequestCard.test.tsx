/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignatureRequestCard } from "./SignatureRequestCard";
import type { DappSignatureRequest } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseRequest: DappSignatureRequest = {
  id: "sig-1",
  origin: "https://dapp.example",
  walletId: "wallet-1",
  accountIndex: 0,
  kind: "personal_sign",
  message: "Sign in to Example",
  displayMessage: "Sign in to Example",
  messageEncoding: "utf8",
  messageByteLength: 18,
  verification: {
    kind: "personal_sign",
    requestDigest: `0x${"11".repeat(32)}`,
    requestByteLength: 86,
    messageDigest: `0x${"22".repeat(32)}`,
    messageByteLength: 18,
    messageEncoding: "utf8",
    source: "raw-dapp-request",
    algorithm: "eip191-personal-sign",
    verifiedByVectors: true,
    vectorSet: "wysiwys-v1"
  },
  requestedAt: "2026-05-30T12:00:00.000Z"
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("SignatureRequestCard", () => {
  it("shows origin, encoding, and message preview", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SignatureRequestCard request={baseRequest} busy={false} onApprove={onApprove} onReject={onReject} />
      );
    });

    expect(container.textContent).toContain("https://dapp.example");
    expect(container.textContent).toContain("Sign in to Example");
    expect(container.textContent).toContain("UTF-8 text");
    expect(container.querySelector(".signature-phishing-warning")).toBeTruthy();
    expect(container.textContent).toContain("Verification details");
    expect(container.textContent).toContain("Message digest");
    expect(container.textContent).toContain(`0x${"22".repeat(32)}`);
  });

  it("warns when personal_sign payload resembles EIP-712 typed data", async () => {
    const typedLike: DappSignatureRequest = {
      ...baseRequest,
      message: JSON.stringify({ types: { EIP712Domain: [] }, primaryType: "Mail", domain: {}, message: {} }),
      displayMessage: JSON.stringify({ types: { EIP712Domain: [] }, primaryType: "Mail", domain: {}, message: {} }),
      messageEncoding: "utf8",
      messageByteLength: 80
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SignatureRequestCard request={typedLike} busy={false} onApprove={vi.fn()} onReject={vi.fn()} />
      );
    });

    expect(container.textContent).toMatch(/Prefer eth_signTypedData/i);
  });

  it("renders eth_signTypedData_v3 as structured typed data", async () => {
    const typedRequest: DappSignatureRequest = {
      ...baseRequest,
      kind: "eth_signTypedData_v3",
      message: JSON.stringify({ primaryType: "Mail" }),
      displayMessage: JSON.stringify({ primaryType: "Mail" }),
      typedData: {
        domain: { name: "Example", chainId: 1 },
        types: { EIP712Domain: [], Mail: [{ name: "contents", type: "string" }] },
        primaryType: "Mail",
        message: { contents: "Hello" }
      },
      verification: {
        kind: "eth_signTypedData_v3",
        requestDigest: `0x${"33".repeat(32)}`,
        requestByteLength: 210,
        finalDigest: `0x${"44".repeat(32)}`,
        domainSeparator: `0x${"55".repeat(32)}`,
        messageHash: `0x${"66".repeat(32)}`,
        primaryType: "Mail",
        source: "raw-dapp-request",
        algorithm: "eip712",
        verifiedByVectors: true,
        vectorSet: "wysiwys-v1"
      }
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SignatureRequestCard request={typedRequest} busy={false} onApprove={vi.fn()} onReject={vi.fn()} />
      );
    });

    expect(container.textContent).toContain("EIP-712 typed data");
    expect(container.textContent).toContain("Mail");
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("EIP-712 digest");
    expect(container.textContent).toContain(`0x${"44".repeat(32)}`);
    expect(container.textContent).not.toMatch(/Prefer eth_signTypedData/i);
  });

  it("calls approve and reject handlers from action buttons", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SignatureRequestCard request={baseRequest} busy={false} onApprove={onApprove} onReject={onReject} />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const approveButton = buttons.find((button) => button.textContent === "Sign") as HTMLButtonElement;
    const rejectButton = buttons.find((button) => button.textContent === "Reject") as HTMLButtonElement;
    await act(async () => {
      approveButton.click();
    });
    expect(onApprove).toHaveBeenCalledOnce();

    await act(async () => {
      rejectButton.click();
    });
    expect(onReject).toHaveBeenCalledOnce();
  });
});
