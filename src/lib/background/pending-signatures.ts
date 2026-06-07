import type {
  DappSignatureRequest,
  Eip712TypedDataPayload,
  PersonalSignMessageEncoding,
  SignatureRequestKind
} from "../types";
import { openApprovalWindow } from "./approval-window";
import {
  DAPP_APPROVAL_TTL_MS,
  getPendingDappApproval,
  initPendingDappApprovals,
  listPendingDappApprovals,
  normalizeSignatureDisplay,
  queueAndWaitPendingDappApproval,
  rejectPendingDappApprovalsForWallet,
  removePendingDappApproval,
  resetPendingDappApprovalsForTests,
  signatureDedupeKey,
  settlePendingDappApproval,
  type DappApprovalOutcome,
  type SignatureDappApprovalOutcome,
  type StoredPendingApproval,
  type StoredPendingSignature
} from "./pending-dapp-approvals";

export const SIGNATURE_TTL_MS = DAPP_APPROVAL_TTL_MS;

export type QueueSignatureOptions = {
  kind?: SignatureRequestKind;
  typedData?: Eip712TypedDataPayload;
  displayMessage?: string;
  messageEncoding?: PersonalSignMessageEncoding;
  messageByteLength?: number;
  verification?: DappSignatureRequest["verification"];
};

export type { StoredPendingSignature };

function signatureLookupKeys(
  origin: string,
  walletId: string,
  accountIndex: number,
  kind: SignatureRequestKind,
  message: string,
  existing?: StoredPendingApproval
): string[] {
  return [
    signatureDedupeKey(origin, walletId, accountIndex, kind, message),
    existing?.id
  ].filter((key): key is string => Boolean(key));
}

function asSignatureRequest(approval: StoredPendingSignature): DappSignatureRequest {
  return {
    id: approval.id,
    origin: approval.origin,
    walletId: approval.walletId,
    accountIndex: approval.accountIndex,
    kind: approval.signatureKind,
    message: approval.message,
    displayMessage: approval.displayMessage,
    messageEncoding: approval.messageEncoding,
    messageByteLength: approval.messageByteLength,
    typedData: approval.typedData,
    verification: approval.verification,
    requestedAt: approval.requestedAt
  };
}

function unwrapSignatureOutcome(outcome: DappApprovalOutcome): string {
  if (outcome.status === "rejected") throw new Error(outcome.message);
  if (outcome.approvalKind !== "signature" || typeof outcome.signature !== "string") {
    throw new Error("Stored approval outcome type mismatch");
  }
  return outcome.signature;
}

export async function initPendingSignatures(): Promise<void> {
  await initPendingDappApprovals();
}

export function listPendingSignatures(walletId?: string): DappSignatureRequest[] {
  return listPendingDappApprovals("signature", walletId).map(asSignatureRequest);
}

export function getPendingSignature(id: string): StoredPendingSignature | undefined {
  return getPendingDappApproval("signature", id);
}

export async function queuePendingSignature(
  origin: string,
  walletId: string,
  accountIndex: number,
  message: string,
  display?: QueueSignatureOptions
): Promise<string> {
  await initPendingSignatures();
  void openApprovalWindow();
  const signatureKind = display?.kind ?? "personal_sign";
  const dedupeKey = signatureDedupeKey(origin, walletId, accountIndex, signatureKind, message);
  const displayFields = normalizeSignatureDisplay(message, display?.displayMessage, display?.messageEncoding, display?.messageByteLength);
  const approval: StoredPendingSignature = {
    id: crypto.randomUUID(),
    approvalKind: "signature",
    origin,
    walletId,
    accountIndex,
    signatureKind,
    message,
    ...displayFields,
    typedData: display?.typedData,
    verification: display?.verification,
    requestedAt: new Date().toISOString(),
    expiresAt: Date.now() + SIGNATURE_TTL_MS,
    dedupeKey
  };
  return unwrapSignatureOutcome(await queueAndWaitPendingDappApproval(
    approval,
    (existing) => signatureLookupKeys(origin, walletId, accountIndex, signatureKind, message, existing)
  ));
}

export async function removePendingSignature(id: string): Promise<StoredPendingSignature | undefined> {
  return removePendingDappApproval(id, "signature");
}

export async function resolvePendingSignature(id: string, signature: string): Promise<StoredPendingSignature> {
  const outcome: SignatureDappApprovalOutcome = { status: "resolved", approvalKind: "signature", signature };
  return settlePendingDappApproval(
    id,
    "signature",
    outcome,
    "Signature request was not found or already resolved"
  );
}

export async function rejectPendingSignature(id: string, message = "User rejected signature request"): Promise<StoredPendingSignature> {
  return settlePendingDappApproval(
    id,
    "signature",
    { status: "rejected", message },
    "Signature request was not found or already resolved"
  );
}

export async function rejectPendingSignaturesForWallet(walletId?: string): Promise<void> {
  await rejectPendingDappApprovalsForWallet(walletId, "signature", "Signature request cancelled");
}

export function resetPendingSignaturesForTests(): void {
  resetPendingDappApprovalsForTests();
}
