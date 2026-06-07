import { parseAddEthereumChainParams } from "../add-ethereum-chain";
import { parseSwitchEthereumChainParams, toHexChainId } from "../evm-chains";
import { parseSignTypedDataParams, serializeTypedDataForDedup } from "../eip712-sign";
import { parseEthSendTransactionParams, serializeDappTransactionForDedup } from "../dapp-transaction";
import { isReadOnlyEvmRpcMethod, proxyReadOnlyEvmRpc, readOnlyRpcError } from "../dapp-read-rpc";
import { isEvmAddress, parsePersonalSignParams } from "../personal-sign";
import { ProviderRpcError, PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import {
  buildPersonalSignVerificationEvidence,
  buildTransactionVerificationEvidence,
  buildTypedDataVerificationEvidence,
  captureRawDappRequestParams
} from "../verify/evidence";
import {
  connectionEvmChainId,
  dappEvmChainIdForOrigin,
  exposedAddresses,
  normalizedOrigin,
  queueDappConnection,
  requireConnectedDappSession,
  resolveDappAccess,
  resolveExposedAccountForRequest,
  switchDappEthereumChain,
  waitForDappConnectionApproval
} from "./connected-sites";
import type { BackgroundMessage } from "./messages";
import { queuePendingDappTransaction } from "./pending-dapp-transactions";
import { queuePendingSignature } from "./pending-signatures";
import { prepareDappTransactionForApproval } from "./wallet-execution";

export async function handleDappRequest(message: Extract<BackgroundMessage, { type: "DAPP_REQUEST" }>, origin: string) {
  const normalized = normalizedOrigin(origin);
  switch (message.method) {
    case "eth_chainId":
      return toHexChainId(await dappEvmChainIdForOrigin(normalized));
    case "wallet_switchEthereumChain":
      return switchDappEthereumChain(normalized, parseSwitchEthereumChainParams(message.params));
    case "eth_accounts": {
      const access = await resolveDappAccess(normalized);
      return access.status === "connected" ? exposedAddresses(access.session) : [];
    }
    case "eth_requestAccounts": {
      const access = await resolveDappAccess(normalized, { touchSession: true });
      if (access.status === "no-wallet") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "No active wallet");
      if (access.status === "connected") return exposedAddresses(access.session);
      if (access.status === "connected-locked") throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED, "Wallet is locked");
      // Queue the request, surface the approval popup, and keep the dApp's
      // promise pending until the user approves (resolves with accounts) or
      // rejects (4001) — the EIP-1102 contract wagmi/web3-onboard expect.
      await queueDappConnection(normalized);
      return waitForDappConnectionApproval(normalized, access.walletId);
    }
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4": {
      const connected = await requireConnectedDappSession(normalized);
      // Resolve the signer the dApp asked for (first/second param) against the
      // exposed set; absent => primary, present-but-unexposed => UNAUTHORIZED.
      const signer = resolveExposedAccountForRequest(connected, signerAddressFromParams(message.params));
      const rawParams = captureRawDappRequestParams(message.params);
      const parsed = parseSignTypedDataParams(message.params, signer.address, connectionEvmChainId(connected.connection));
      const dedupeKey = serializeTypedDataForDedup(parsed);
      const kind = message.method === "eth_signTypedData_v3" ? "eth_signTypedData_v3" : "eth_signTypedData_v4";
      return queuePendingSignature(normalized, connected.walletId, signer.index, dedupeKey, {
        kind,
        typedData: parsed,
        displayMessage: dedupeKey,
        messageEncoding: "utf8",
        messageByteLength: new TextEncoder().encode(dedupeKey).length,
        verification: buildTypedDataVerificationEvidence(rawParams, kind, parsed)
      });
    }
    case "personal_sign": {
      const connected = await requireConnectedDappSession(normalized);
      const signer = resolveExposedAccountForRequest(connected, signerAddressFromParams(message.params));
      const rawParams = captureRawDappRequestParams(message.params);
      const parsed = parsePersonalSignParams(message.params, signer.address);
      return queuePendingSignature(normalized, connected.walletId, signer.index, parsed.message, {
        kind: "personal_sign",
        displayMessage: parsed.displayMessage,
        messageEncoding: parsed.messageEncoding,
        messageByteLength: parsed.messageByteLength,
        verification: buildPersonalSignVerificationEvidence(rawParams, parsed)
      });
    }
    case "eth_sendTransaction": {
      const connected = await requireConnectedDappSession(normalized);
      const sender = resolveExposedAccountForRequest(connected, transactionFromAddress(message.params));
      const rawParams = captureRawDappRequestParams(message.params);
      const parsed = parseEthSendTransactionParams(message.params, sender.address);
      const prepared = await prepareDappTransactionForApproval(connected.chain, parsed);
      const dedupeKey = serializeDappTransactionForDedup(prepared);
      return queuePendingDappTransaction(
        normalized,
        connected.walletId,
        sender.index,
        connected.chain,
        dedupeKey,
        prepared,
        buildTransactionVerificationEvidence(rawParams, prepared)
      );
    }
    case "wallet_addEthereumChain":
      return switchDappEthereumChain(normalized, parseAddEthereumChainParams(message.params));
    default:
      if (isReadOnlyEvmRpcMethod(message.method)) {
        const connected = await requireConnectedDappSession(normalized);
        try {
          return await proxyReadOnlyEvmRpc(message.method, message.params, connected);
        } catch (error) {
          throw readOnlyRpcError(error);
        }
      }
      throw new ProviderRpcError(PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD, `Unsupported dApp method: ${message.method}`);
  }
}

/**
 * Extracts the signer address a personal_sign / eth_signTypedData request names.
 * Both layouts ([address, message] and [message, address]) are tolerated; the
 * detailed validation stays in the per-method parse helpers.
 */
function signerAddressFromParams(params: unknown): string | undefined {
  if (!Array.isArray(params)) return undefined;
  for (const candidate of params) {
    if (isEvmAddress(candidate)) return candidate;
  }
  return undefined;
}

/** Extracts the `from` field of an eth_sendTransaction request object. */
function transactionFromAddress(params: unknown): string | undefined {
  if (!Array.isArray(params)) return undefined;
  const tx = params[0];
  if (!tx || typeof tx !== "object" || Array.isArray(tx)) return undefined;
  const from = (tx as Record<string, unknown>).from;
  return isEvmAddress(from) ? from : undefined;
}
