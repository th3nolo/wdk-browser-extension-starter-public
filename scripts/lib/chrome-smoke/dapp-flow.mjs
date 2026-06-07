import {
  cdpJson,
  cdpJsonForTarget,
  delay,
  evaluateCdp,
  findCdpTarget,
  listCdpTargets,
  openCdpTarget,
  rewriteCdpWebSocketHost,
  waitForCdpExpression
} from "./cdp.mjs";
import {
  extensionResolutionDiagnostics,
  findExtensionServiceWorkerTarget,
  resolveWalletExtensionId,
  wakeExtensionServiceWorker
} from "./extension.mjs";
import { startBalanceEgressMock, startExtensionDiagnostics } from "./diagnostics.mjs";
import { startRpcInterception } from "./rpc-intercept.mjs";
import {
  assertConnectClickable,
  clickConnect,
  selectConnectionAccounts,
  waitForConnectionCard
} from "./popup-ui.mjs";
import { Interface } from "ethers";

const SWAP_SMOKE_INTERFACE = new Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)"
]);
const AAVE_SMOKE_INTERFACE = new Interface([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)"
]);
const LAYERZERO_OFT_SMOKE_INTERFACE = new Interface([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress) payable"
]);
const SAFE_SMOKE_INTERFACE = new Interface([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)"
]);
const ERC20_INFO_SMOKE_INTERFACE = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SMOKE_WALLET_PASSWORD = "correct horse battery staple";

export async function runDappFlow(initialStatus, context) {
  if (context.smokeMode !== "cdp" && context.smokeMode !== "headed-cdp") {
    throw new Error("Deep dApp smoke requires cdp or headed-cdp mode");
  }
  const { cdpHost, debugPort, smokeHost, serverPort, smokeUrl } = context;
  const dappTarget = await findCdpTarget(cdpHost, debugPort, smokeUrl);
  if (!dappTarget?.webSocketDebuggerUrl) throw new Error("Unable to find dApp CDP target");
  const dappWs = rewriteCdpWebSocketHost(dappTarget.webSocketDebuggerUrl, cdpHost);
  const cdpEndpoint = { host: cdpHost, port: debugPort };
  const resolvedExtension = await step(context, "resolve extension id", () => resolveWalletExtensionId({ ...context, ...cdpEndpoint, dappWs }));
  const extensionId = resolvedExtension.id;
  logSmokeStep(context, `extension id ${extensionId} (${resolvedExtension.source})`);
  const worker = await step(context, "wake/probe extension service worker", () => wakeExtensionServiceWorker({ ...context, ...cdpEndpoint, extensionId }));
  if (worker?.target) logSmokeStep(context, `worker target ${worker.target.type} ${worker.target.url}`);
  if (worker?.probe) logSmokeStep(context, `worker probe ${JSON.stringify(worker.probe)}`);
  else logSmokeStep(context, "worker probe skipped; runtime messages verify readiness");
  const extensionDiagnostics = worker?.target
    ? await step(context, "start extension diagnostics", () => startExtensionDiagnostics({
      host: cdpHost,
      port: debugPort,
      target: worker.target,
      log: process.env.SMOKE_EXTENSION_DIAGNOSTICS_LOG === "1"
    }))
    : undefined;

  const popupTarget = await openCdpTarget(cdpHost, debugPort, `chrome-extension://${extensionId}/popup.html`);
  if (!popupTarget.webSocketDebuggerUrl) throw new Error("Unable to open extension popup target");
  const popupWs = rewriteCdpWebSocketHost(popupTarget.webSocketDebuggerUrl, cdpHost);

  let dappTransactionHash = "";
  let dappTransactionApproved = false;
  let dappContractApprovalHash = "";
  let dappContractApprovalApproved = false;
  let dappSwapApproved = false;
  let dappAaveActionApproved = false;
  let dappBridgeApproved = false;
  let dappSafeExecutionApproved = false;
  let readOnlyRpcVerified = false;
  let extensionDiagnosticsSummary = { checked: false, entries: 0 };
  let providerMethodCounts = {};

  try {
    await step(context, "popup runtime ready", () => waitForCdpExpression(popupWs, "typeof chrome?.runtime?.sendMessage === 'function'", context.timeoutMs));
    const popupProbe = await step(context, "popup runtime probe", () => evaluateCdp(popupWs, `JSON.stringify({
      url: location.href,
      runtimeId: globalThis.chrome?.runtime?.id,
      readyState: document.readyState,
      hasBrowserRuntime: typeof globalThis.browser?.runtime?.sendMessage === "function",
      hasChromeRuntime: typeof globalThis.chrome?.runtime?.sendMessage === "function",
      body: document.body?.innerText?.slice(0, 300) ?? ""
    })`, { label: "popup runtime probe" }));
    const parsedPopupProbe = typeof popupProbe === "string" ? JSON.parse(popupProbe) : popupProbe;
    if (parsedPopupProbe?.runtimeId !== extensionId) {
      throw new Error(`Popup runtime id mismatch: expected ${extensionId}, got ${parsedPopupProbe?.runtimeId ?? "missing"}`);
    }
    await step(context, "initial state summary", () => extensionMessage(popupWs, { type: "GET_STATE_SUMMARY" }, context, "GET_STATE_SUMMARY before wallet setup"));
    await step(context, "create smoke wallet", () => extensionMessage(popupWs, {
      type: "CREATE_WALLET",
      name: "Smoke wallet",
      password: SMOKE_WALLET_PASSWORD,
      seedPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    }, context, "CREATE_WALLET"));
    const balanceSwTarget = findExtensionServiceWorkerTarget(await listCdpTargets(cdpHost, debugPort), extensionId);
    if (!balanceSwTarget) throw new Error("Unable to find extension service worker target for balance egress diagnostics");
    const balanceEgressMock = context.balanceEgressMode === "live"
      ? undefined
      : await step(context, "start balance egress mock", () => startBalanceEgressMock({
        host: cdpHost,
        port: debugPort,
        target: balanceSwTarget,
        log: process.env.SMOKE_BALANCE_EGRESS_LOG === "1"
      }));
    try {
      const balances = await step(context, "load balances under extension diagnostics", () =>
        extensionMessage(popupWs, { type: "GET_BALANCES" }, context, "GET_BALANCES diagnostics")
      );
      if (!Array.isArray(balances)) throw new Error(`GET_BALANCES returned non-array response: ${JSON.stringify(balances)}`);
    } finally {
      await balanceEgressMock?.stop();
    }
    await step(context, "install provider method recorder", () => installProviderMethodRecorder(dappWs));

    // EIP-1102 contract: eth_requestAccounts stays pending until the user
    // approves, then resolves with accounts. Phase 1 — kick it off without
    // awaiting (the promise is parked on window for phase 3).
    await step(context, "request dapp connection", () => evaluateCdp(dappWs, `(() => {
      window.__wdkConnectPromise = window.ethereum.request({ method: "eth_requestAccounts" }).then(
        (result) => ({ status: "resolved", result }),
        (error) => ({ status: "rejected", message: error?.message ?? String(error), code: error?.code })
      );
      return true;
    })()`, { awaitPromise: true, timeoutMs: context.messageTimeoutMs, label: "issue eth_requestAccounts" }));
    // The request round-trips asynchronously; wait until it has queued before approving.
    await step(context, "wait for pending connection", async () => {
      const origin = `http://${smokeHost}:${serverPort}`;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const summary = await extensionMessage(popupWs, { type: "GET_STATE_SUMMARY" }, context, "GET_STATE_SUMMARY");
        if (Array.isArray(summary?.pendingConnections) && summary.pendingConnections.some((entry) => entry.origin === origin)) return summary;
        await delay(100);
      }
      throw new Error("dApp connection was not queued for approval");
    });
    // Phase 2 — approve in the popup (the request is still pending). The
    // default path sends APPROVE_DAPP via chrome.runtime so the existing smoke
    // is unchanged; the real-UI path renders the popup React DOM and clicks the
    // actual Connect button so UI-only regressions (disabled button, overlay
    // intercept, missing checkbox) fail the run.
    if (context.realUi) {
      await approveConnectionViaUi({ context, cdpHost, debugPort, popupWs, popupTarget });
    } else {
      await step(context, "approve dapp connection", () => extensionMessage(popupWs, {
        type: "APPROVE_DAPP",
        origin: `http://${smokeHost}:${serverPort}`,
        accountIndex: 0
      }, context, "APPROVE_DAPP"));
    }
    // Phase 3 — the original eth_requestAccounts promise now resolves with accounts.
    const connectedAccounts = await step(context, "await connected accounts", () => evaluateCdp(dappWs, `(async () => {
      const timeoutMs = ${context.messageTimeoutMs};
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("eth_requestAccounts resolution timed out after " + timeoutMs + "ms")), timeoutMs));
      return Promise.race([window.__wdkConnectPromise, timeout]);
    })()`, { awaitPromise: true, timeoutMs: context.messageTimeoutMs + 1_000, label: "eth_requestAccounts resolution" }));
    if (
      connectedAccounts.status !== "resolved"
      || !Array.isArray(connectedAccounts.result)
      || typeof connectedAccounts.result[0] !== "string"
      || !connectedAccounts.result[0].startsWith("0x")
    ) {
      throw new Error(`dApp connection did not resolve with accounts after approval: ${JSON.stringify(connectedAccounts)}`);
    }
    const accountsRead = await step(context, "read connected accounts", () => dappProviderRequest(dappWs, "eth_accounts", undefined, context, "eth_accounts after approval"));
    if (accountsRead.status !== "resolved" || accountsRead.result?.[0] !== connectedAccounts.result[0]) {
      throw new Error(`eth_accounts did not return the connected account after approval: ${JSON.stringify(accountsRead)}`);
    }
    await step(context, "wait for accountsChanged event", () => waitForCdpExpression(dappWs, "window.__wdkProviderEvents.some(event => event.event === 'accountsChanged' && event.accounts?.length)", context.timeoutMs));

    const readOnlySwTarget = findExtensionServiceWorkerTarget(await listCdpTargets(cdpHost, debugPort), extensionId);
    if (!readOnlySwTarget) throw new Error("Unable to find extension service worker target for read-only RPC interception");
    const readOnlyInterception = await startRpcInterception({ host: cdpHost, port: debugPort, target: readOnlySwTarget, log: process.env.SMOKE_RPC_LOG === "1" });
    try {
      const receiptHash = `0x${"11".repeat(32)}`;
      const readOnlyResults = await step(context, "verify read-only EVM provider RPCs", () => evaluateCdp(dappWs, `(async () => {
        const account = ${JSON.stringify(connectedAccounts.result[0])};
        const receiptHash = ${JSON.stringify(receiptHash)};
        const calls = [
          ["net_version"],
          ["eth_blockNumber"],
          ["eth_getBalance", [account, "latest"]],
          ["eth_call", [{ to: account, data: "0x" }, "latest"]],
          ["eth_estimateGas", [{ to: account, value: "0x0" }]],
          ["eth_gasPrice"],
          ["eth_feeHistory", ["0x1", "latest", [50]]],
          ["eth_getTransactionCount", [account, "latest"]],
          ["eth_getTransactionReceipt", [receiptHash]],
          ["eth_getCode", [account, "latest"]]
        ];
        const results = {};
        for (const [method, params] of calls) {
          results[method] = await window.ethereum.request({ method, params });
        }
        window.__wdkSmokeReadOnlyRpc = results;
        return results;
      })()`, { awaitPromise: true, label: "read-only provider RPCs" }));
      const expectedMethods = ["eth_blockNumber", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_feeHistory", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getCode"];
      for (const method of expectedMethods) {
        if (!readOnlyInterception.calls.some((call) => call.method === method)) throw new Error(`Read-only RPC ${method} did not reach the RPC layer`);
      }
      if (!readOnlyResults || readOnlyResults.net_version !== "1" || readOnlyResults.eth_blockNumber !== "0x1") {
        throw new Error(`Read-only RPC results were unexpected: ${JSON.stringify(readOnlyResults)}`);
      }
      readOnlyRpcVerified = true;
    } finally {
      await readOnlyInterception.stop();
    }

    const signatureMessage = `WDK browser extension starter ${context.smokeRunId}`;
    await step(context, "request personal_sign", () => evaluateCdp(dappWs, `(() => {
      const account = ${JSON.stringify(connectedAccounts.result[0])};
      const message = ${JSON.stringify(signatureMessage)};
      window.__wdkSmokeSignature = "";
      window.ethereum.request({ method: "personal_sign", params: [message, account] })
        .then((signature) => {
          window.__wdkSmokeSignature = signature;
          const field = document.getElementById("signature");
          if (field) field.textContent = signature;
        })
        .catch((error) => {
          window.__wdkSmokeSignatureError = error?.message ?? String(error);
        });
      return "queued";
    })()`, { label: "queue personal_sign" }));
    const signatureId = await step(context, "state summary with pending signature", () => waitForPendingSignatureId(popupWs, dappWs, context, "GET_STATE_SUMMARY after signature request", "window.__wdkSmokeSignatureError ?? ''"));
    await step(context, "approve signature", () => extensionMessage(popupWs, { type: "APPROVE_SIGNATURE", id: signatureId }, context, "APPROVE_SIGNATURE"));
    await step(context, "wait for signature result", () => waitForCdpExpression(dappWs, "document.getElementById('signature')?.textContent.startsWith('0x')", context.timeoutMs));

    const unsafeTxError = await step(context, "reject unsafe dapp transaction", () => evaluateCdp(dappWs, `(async () => {
      try {
        await window.ethereum.request({
          method: "eth_sendTransaction",
          params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x0", gas: "0x5208" }]
        });
        return "resolved";
      } catch (error) {
        return error?.message ?? String(error);
      }
    })()`, { awaitPromise: true, label: "unsafe dapp transaction request" }));
    if (typeof unsafeTxError !== "string" || !unsafeTxError.includes("Unsupported gas in dApp transaction request")) {
      throw new Error(`Unsafe dApp transaction was not rejected as expected: ${unsafeTxError}`);
    }

    // --- EIP-712 typed-data signature (queue -> approve -> delivered) ---
    const connectedChain = await step(context, "read connected chainId", () => dappProviderRequest(dappWs, "eth_chainId", undefined, context, "eth_chainId"));
    const chainIdNumber = Number.parseInt(String(connectedChain.result ?? "0x0"), 16);
    await step(context, "request eth_signTypedData_v4", () => evaluateCdp(dappWs, `(() => {
      const account = ${JSON.stringify(connectedAccounts.result[0])};
      const typedData = ${JSON.stringify(buildTypedData(chainIdNumber, context.smokeRunId))};
      window.__wdkSmokeTypedSignature = "";
      window.ethereum.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] })
        .then((signature) => { window.__wdkSmokeTypedSignature = signature; })
        .catch((error) => { window.__wdkSmokeTypedError = error?.message ?? String(error); });
      return "queued";
    })()`, { label: "queue eth_signTypedData_v4" }));
    const typedSignatureId = await step(context, "state summary with typed signature", () => waitForPendingSignatureId(popupWs, dappWs, context, "GET_STATE_SUMMARY after typed-data request", "window.__wdkSmokeTypedError ?? ''"));
    await step(context, "approve typed signature", () => extensionMessage(popupWs, { type: "APPROVE_SIGNATURE", id: typedSignatureId }, context, "APPROVE_SIGNATURE (typed data)"));
    await step(context, "wait for typed signature result", () => waitForCdpExpression(dappWs, "(window.__wdkSmokeTypedSignature || '').startsWith('0x')", context.timeoutMs));

    // --- Reject a pending signature (popup rejects -> dApp receives the rejection) ---
    await step(context, "request personal_sign to reject", () => evaluateCdp(dappWs, `(() => {
      const account = ${JSON.stringify(connectedAccounts.result[0])};
      window.__wdkSmokeRejectError = "";
      window.__wdkSmokeRejectResolved = null;
      window.ethereum.request({ method: "personal_sign", params: [${JSON.stringify(`reject me ${context.smokeRunId}`)}, account] })
        .then((signature) => { window.__wdkSmokeRejectResolved = signature; })
        .catch((error) => { window.__wdkSmokeRejectError = error?.message ?? String(error); });
      return "queued";
    })()`, { label: "queue personal_sign to reject" }));
    const rejectSignatureId = await step(context, "state summary with signature to reject", () => waitForPendingSignatureId(popupWs, dappWs, context, "GET_STATE_SUMMARY before reject", "window.__wdkSmokeRejectError ?? ''"));
    await step(context, "reject signature", () => extensionMessage(popupWs, { type: "REJECT_SIGNATURE", id: rejectSignatureId }, context, "REJECT_SIGNATURE"));
    await step(context, "wait for signature rejection", () => waitForCdpExpression(dappWs, "(window.__wdkSmokeRejectError || '').length > 0", context.timeoutMs));
    const rejectionMessage = await step(context, "read rejection message", () => evaluateCdp(dappWs, "window.__wdkSmokeRejectError"));
    if (typeof rejectionMessage !== "string" || !/reject/i.test(rejectionMessage)) {
      throw new Error(`Signature rejection was not delivered to the dApp: ${rejectionMessage}`);
    }
    if ((await evaluateCdp(dappWs, "window.__wdkSmokeRejectResolved ?? null")) !== null) {
      throw new Error("Rejected signature unexpectedly resolved to a value");
    }

    // --- Full transaction approval, live, with the service worker's RPC calls intercepted ---
    // CDP fulfills the SW's JSON-RPC (eth_getCode -> 0x, gas/nonce/balance, and eth_sendRawTransaction
    // -> the real signed-tx hash) so a native transfer is validated, approved, and "broadcast" without
    // any real or loopback RPC. Exercises the union store's transaction arm: queue -> settle -> deliver.
    const swTarget = findExtensionServiceWorkerTarget(await listCdpTargets(cdpHost, debugPort), extensionId);
    if (!swTarget) throw new Error("Unable to find extension service worker target for RPC interception");
    const interception = await startRpcInterception({ host: cdpHost, port: debugPort, target: swTarget, log: process.env.SMOKE_RPC_LOG === "1" });
    try {
      const tokenContract = "0x0000000000000000000000000000000000000003";
      const spender = "0x0000000000000000000000000000000000000004";
      const swapRouter = "0x0000000000000000000000000000000000000005";
      const aavePool = "0x0000000000000000000000000000000000000006";
      const bridgeContract = "0x0000000000000000000000000000000000000007";
      const safeContract = "0x0000000000000000000000000000000000000008";
      const safeTarget = "0x0000000000000000000000000000000000000009";
      const approvalData = `0x095ea7b3${abiAddress(spender)}${abiUint(1000n)}`;
      await step(context, "request decoded erc20 approval", () => evaluateCdp(dappWs, `(() => {
        window.__wdkSmokeContractTxHash = "";
        window.__wdkSmokeContractTxError = "";
        window.ethereum.request({
          method: "eth_sendTransaction",
          params: [{ to: ${JSON.stringify(tokenContract)}, value: "0x0", data: ${JSON.stringify(approvalData)} }]
        })
          .then((hash) => { window.__wdkSmokeContractTxHash = hash; })
          .catch((error) => { window.__wdkSmokeContractTxError = error?.message ?? String(error); });
        return "queued";
      })()`, { label: "queue decoded erc20 approval" }));
      const contractTransaction = await step(context, "wait for pending erc20 approval", () =>
        waitForPendingTransaction(popupWs, dappWs, context, "GET_STATE_SUMMARY poll pending erc20 approval", "window.__wdkSmokeContractTxError ?? ''")
      );
      assertSimulationData(contractTransaction, "decoded ERC-20 approval");
      const contractTransactionId = contractTransaction.id;
      await step(context, "approve erc20 approval", () => extensionMessage(popupWs, { type: "APPROVE_DAPP_TRANSACTION", id: contractTransactionId }, context, "APPROVE_DAPP_TRANSACTION (erc20 approval)"));
      await step(context, "wait for erc20 approval hash", () => waitForCdpExpression(dappWs, "/^0x[0-9a-fA-F]{64}$/.test(window.__wdkSmokeContractTxHash || '')", context.timeoutMs));
      dappContractApprovalHash = await step(context, "read erc20 approval hash", () => evaluateCdp(dappWs, "window.__wdkSmokeContractTxHash"));
      dappContractApprovalApproved = true;
      if (!interception.calls.some((call) => call.method === "eth_estimateGas" && call.params?.[0]?.data === approvalData)) {
        throw new Error("Decoded ERC-20 approval did not reach eth_estimateGas with calldata");
      }
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.data === approvalData)) {
        throw new Error("Decoded ERC-20 approval did not reach eth_call simulation with calldata");
      }
      for (const metadataCall of ["name", "symbol", "decimals"]) {
        const metadataData = ERC20_INFO_SMOKE_INTERFACE.encodeFunctionData(metadataCall).toLowerCase();
        if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.to === tokenContract && call.params?.[0]?.data === metadataData)) {
          throw new Error(`Decoded ERC-20 approval did not read token ${metadataCall} metadata`);
        }
      }
      const allowanceSelector = ERC20_INFO_SMOKE_INTERFACE.getFunction("allowance").selector;
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.to === tokenContract && call.params?.[0]?.data?.startsWith(allowanceSelector))) {
        throw new Error("Decoded ERC-20 approval did not read current allowance");
      }

      const swapData = SWAP_SMOKE_INTERFACE.encodeFunctionData("swapExactTokensForTokens", [
        1000n,
        990n,
        [tokenContract, spender],
        connectedAccounts.result[0],
        999999n
      ]).toLowerCase();
      await queueAndApproveDappTransaction({
        context,
        popupWs,
        dappWs,
        label: "decoded swap",
        hashKey: "__wdkSmokeSwapTxHash",
        errorKey: "__wdkSmokeSwapTxError",
        tx: { to: swapRouter, value: "0x0", data: swapData }
      });
      dappSwapApproved = true;
      if (!interception.calls.some((call) => call.method === "eth_estimateGas" && call.params?.[0]?.data === swapData)) {
        throw new Error("Decoded swap did not reach eth_estimateGas with calldata");
      }
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.data === swapData)) {
        throw new Error("Decoded swap did not reach eth_call simulation with calldata");
      }

      const aaveData = AAVE_SMOKE_INTERFACE.encodeFunctionData("supply", [
        tokenContract,
        1000n,
        connectedAccounts.result[0],
        0
      ]).toLowerCase();
      await queueAndApproveDappTransaction({
        context,
        popupWs,
        dappWs,
        label: "decoded Aave supply",
        hashKey: "__wdkSmokeAaveTxHash",
        errorKey: "__wdkSmokeAaveTxError",
        tx: { to: aavePool, value: "0x0", data: aaveData }
      });
      dappAaveActionApproved = true;
      if (!interception.calls.some((call) => call.method === "eth_estimateGas" && call.params?.[0]?.data === aaveData)) {
        throw new Error("Decoded Aave action did not reach eth_estimateGas with calldata");
      }
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.data === aaveData)) {
        throw new Error("Decoded Aave action did not reach eth_call simulation with calldata");
      }

      const bridgeRecipient = `0x${"0".repeat(24)}${connectedAccounts.result[0].slice(2).toLowerCase()}`;
      const bridgeData = LAYERZERO_OFT_SMOKE_INTERFACE.encodeFunctionData("send", [
        [30110, bridgeRecipient, 1000n, 990n, "0x", "0x", "0x"],
        [1n, 0n],
        connectedAccounts.result[0]
      ]).toLowerCase();
      await queueAndApproveDappTransaction({
        context,
        popupWs,
        dappWs,
        label: "decoded bridge",
        hashKey: "__wdkSmokeBridgeTxHash",
        errorKey: "__wdkSmokeBridgeTxError",
        tx: { to: bridgeContract, value: "0x1", data: bridgeData }
      });
      dappBridgeApproved = true;
      if (!interception.calls.some((call) => call.method === "eth_estimateGas" && call.params?.[0]?.data === bridgeData)) {
        throw new Error("Decoded bridge did not reach eth_estimateGas with calldata");
      }
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.data === bridgeData)) {
        throw new Error("Decoded bridge did not reach eth_call simulation with calldata");
      }

      const safeData = SAFE_SMOKE_INTERFACE.encodeFunctionData("execTransaction", [
        safeTarget,
        100n,
        "0x1234",
        0,
        0n,
        0n,
        0n,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        "0x"
      ]).toLowerCase();
      await queueAndApproveDappTransaction({
        context,
        popupWs,
        dappWs,
        label: "decoded Safe execution",
        hashKey: "__wdkSmokeSafeTxHash",
        errorKey: "__wdkSmokeSafeTxError",
        tx: { to: safeContract, value: "0x0", data: safeData }
      });
      dappSafeExecutionApproved = true;
      if (!interception.calls.some((call) => call.method === "eth_estimateGas" && call.params?.[0]?.data === safeData)) {
        throw new Error("Decoded Safe execution did not reach eth_estimateGas with calldata");
      }
      if (!interception.calls.some((call) => call.method === "eth_call" && call.params?.[0]?.data === safeData)) {
        throw new Error("Decoded Safe execution did not reach eth_call simulation with calldata");
      }

      await step(context, "request safe eth_sendTransaction", () => evaluateCdp(dappWs, `(() => {
        const account = ${JSON.stringify(connectedAccounts.result[0])};
        window.__wdkSmokeTxHash = "";
        window.__wdkSmokeTxError = "";
        window.ethereum.request({ method: "eth_sendTransaction", params: [{ to: account, value: "0x2386f26fc10000" }] })
          .then((hash) => { window.__wdkSmokeTxHash = hash; })
          .catch((error) => { window.__wdkSmokeTxError = error?.message ?? String(error); });
        return "queued";
      })()`, { label: "queue safe eth_sendTransaction" }));
      // The transaction only queues after the async eth_getCode recipient check resolves, so poll.
      const transaction = await step(context, "wait for pending transaction", () =>
        waitForPendingTransaction(popupWs, dappWs, context, "GET_STATE_SUMMARY poll pending transaction", "window.__wdkSmokeTxError ?? ''")
      );
      assertSimulationData(transaction, "native dApp transaction");
      const transactionId = transaction.id;
      await step(context, "approve dapp transaction", () => extensionMessage(popupWs, { type: "APPROVE_DAPP_TRANSACTION", id: transactionId }, context, "APPROVE_DAPP_TRANSACTION"));
      await step(context, "wait for transaction hash", () => waitForCdpExpression(dappWs, "/^0x[0-9a-fA-F]{64}$/.test(window.__wdkSmokeTxHash || '')", context.timeoutMs));
      dappTransactionHash = await step(context, "read transaction hash", () => evaluateCdp(dappWs, "window.__wdkSmokeTxHash"));
      dappTransactionApproved = true;
    } finally {
      await interception.stop();
    }
    providerMethodCounts = await step(context, "verify recorded provider methods", () => verifyRecordedProviderMethods(dappWs));
    extensionDiagnosticsSummary = await step(context, "assert extension diagnostics clean", () =>
      extensionDiagnostics?.assertClean() ?? { checked: false, entries: 0 }
    );
  } catch (error) {
    const diagnostics = await collectDappDiagnostics({ ...context, ...cdpEndpoint, extensionId, popupWs, dappWs });
    diagnostics.extensionDiagnostics = extensionDiagnostics?.snapshot() ?? [];
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
  } finally {
    await extensionDiagnostics?.stop().catch(() => undefined);
  }

  return {
    origin: `http://${smokeHost}:${serverPort}`,
    extensionId,
    accountConnected: true,
    accountEventObserved: true,
    signatureApproved: true,
    typedSignatureApproved: true,
    signatureRejected: true,
    readOnlyRpcVerified,
    dappContractApprovalApproved,
    dappContractApprovalHash,
    dappSwapApproved,
    dappAaveActionApproved,
    dappBridgeApproved,
    dappSafeExecutionApproved,
    dappTransactionApproved,
    dappTransactionHash,
    unsafeTransactionRejected: true,
    extensionDiagnostics: extensionDiagnosticsSummary,
    providerMethodCounts,
    initialAnnouncements: initialStatus.announcements.length
  };
}

function installProviderMethodRecorder(wsUrl) {
  return evaluateCdp(wsUrl, `(() => {
    const provider = window.ethereum;
    if (!provider || typeof provider.request !== "function") {
      throw new Error("window.ethereum.request is unavailable");
    }
    if (window.__wdkProviderRequestRecorderInstalled) return true;
    window.__wdkRecordedProviderRequests = [];
    const originalRequest = provider.request.bind(provider);
    provider.request = (request) => {
      window.__wdkRecordedProviderRequests.push({
        method: request?.method,
        params: request?.params
      });
      return originalRequest(request);
    };
    window.__wdkProviderRequestRecorderInstalled = true;
    return true;
  })()`, { label: "install provider method recorder" });
}

async function verifyRecordedProviderMethods(wsUrl) {
  const requests = await evaluateCdp(wsUrl, "window.__wdkRecordedProviderRequests ?? []", { label: "read provider method recorder" });
  const counts = {};
  for (const request of Array.isArray(requests) ? requests : []) {
    if (typeof request?.method !== "string") continue;
    counts[request.method] = (counts[request.method] ?? 0) + 1;
  }
  const requiredMethods = [
    "eth_requestAccounts",
    "eth_accounts",
    "net_version",
    "eth_blockNumber",
    "eth_getBalance",
    "eth_call",
    "eth_estimateGas",
    "eth_gasPrice",
    "eth_feeHistory",
    "eth_getTransactionCount",
    "eth_getTransactionReceipt",
    "eth_getCode",
    "personal_sign",
    "eth_chainId",
    "eth_signTypedData_v4",
    "eth_sendTransaction"
  ];
  const missing = requiredMethods.filter((method) => !counts[method]);
  if (missing.length) throw new Error(`Provider method recorder missed: ${missing.join(", ")}`);
  return counts;
}

function buildTypedData(chainId, runId) {
  return {
    types: {
      Message: [
        { name: "contents", type: "string" },
        { name: "nonce", type: "uint256" }
      ]
    },
    primaryType: "Message",
    domain: {
      name: "WDK Smoke",
      version: "1",
      chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000"
    },
    message: { contents: `typed data ${runId}`, nonce: 1 }
  };
}

async function waitForPendingSignatureId(popupWs, dappWs, context, label, errorExpr) {
  const deadline = Date.now() + context.timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const summary = await extensionMessage(popupWs, { type: "GET_STATE_SUMMARY" }, context, label);
    const signature = summary?.pendingSignatures?.[0];
    if (signature?.id) {
      assertSignatureVerificationData(signature, "pending signature");
      return signature.id;
    }
    if (errorExpr) {
      lastError = await evaluateCdp(dappWs, errorExpr).catch(() => "");
      if (lastError) throw new Error(`signature request was rejected before queuing: ${lastError}`);
    }
    await delay(100);
  }
  throw new Error(`No pending signature appeared during dApp smoke${lastError ? ` (last dApp error: ${lastError})` : ""}`);
}

async function waitForPendingTransaction(popupWs, dappWs, context, label, errorExpr) {
  const deadline = Date.now() + context.timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const summary = await extensionMessage(popupWs, { type: "GET_STATE_SUMMARY" }, context, label);
    const transaction = summary?.pendingTransactions?.[0];
    if (transaction?.id) return transaction;
    if (errorExpr) {
      lastError = await evaluateCdp(dappWs, errorExpr).catch(() => "");
      if (lastError) throw new Error(`eth_sendTransaction was rejected before queuing: ${lastError}`);
    }
    await delay(200);
  }
  throw new Error(`Pending dApp transaction never appeared${lastError ? ` (last dApp error: ${lastError})` : ""}`);
}

function assertSimulationData(transaction, label) {
  const simulation = transaction?.review?.simulation;
  const rpcData = simulation?.rpcEvidence;
  const feeEstimate = transaction?.review?.feeEstimate;
  if (simulation?.status !== "passed") {
    throw new Error(`${label} pending review did not record passed simulation status`);
  }
  if (simulation?.gasEstimate !== transaction?.gasLimit) {
    throw new Error(`${label} pending review gas estimate did not match queued gas limit`);
  }
  if (
    rpcData?.gasEstimateMethod !== "eth_estimateGas"
    || rpcData?.simulationMethod !== "eth_call"
    || rpcData?.blockTag !== "latest"
    || typeof rpcData?.gasEstimateHex !== "string"
    || typeof rpcData?.simulationResult !== "string"
  ) {
    throw new Error(`${label} pending review did not record RPC simulation data`);
  }
  if (
    feeEstimate?.gasLimit !== transaction?.gasLimit
    || typeof feeEstimate?.maxNativeFee !== "string"
    || (feeEstimate.source !== "eth_feeHistory" && feeEstimate.source !== "eth_gasPrice")
  ) {
    throw new Error(`${label} pending review did not record wallet fee estimate`);
  }
  assertTransactionVerificationData(transaction, label);
}

function assertSignatureVerificationData(signature, label) {
  const verification = signature?.verification;
  if (
    verification?.source !== "raw-dapp-request"
    || verification?.vectorSet !== "wysiwys-v1"
    || verification?.verifiedByVectors !== true
    || !isDigest(verification?.requestDigest)
  ) {
    throw new Error(`${label} did not record raw request verification data`);
  }
  if (signature.kind === "personal_sign") {
    if (verification.kind !== "personal_sign" || verification.algorithm !== "eip191-personal-sign" || !isDigest(verification.messageDigest)) {
      throw new Error(`${label} did not record personal_sign digest data`);
    }
    return;
  }
  if (
    verification.kind !== signature.kind
    || verification.algorithm !== "eip712"
    || !isDigest(verification.finalDigest)
    || !isDigest(verification.domainSeparator)
    || !isDigest(verification.messageHash)
  ) {
    throw new Error(`${label} did not record EIP-712 digest data`);
  }
}

function assertTransactionVerificationData(transaction, label) {
  const verification = transaction?.verification;
  if (
    verification?.kind !== "eth_sendTransaction"
    || verification?.source !== "raw-dapp-request"
    || verification?.algorithm !== "erc8213-calldata-digest"
    || verification?.vectorSet !== "wysiwys-v1"
    || verification?.verifiedByVectors !== true
    || !isDigest(verification?.requestDigest)
    || verification.target !== transaction.to
    || verification.value !== transaction.value
  ) {
    throw new Error(`${label} pending review did not record transaction verification data`);
  }
  if (transaction.data) {
    if (!isDigest(verification.calldataDigest) || verification.dataByteLength <= 0) {
      throw new Error(`${label} pending review did not record calldata digest data`);
    }
  } else if (verification.calldataDigest !== null || verification.dataByteLength !== 0) {
    throw new Error(`${label} pending review recorded unexpected calldata digest data for native transfer`);
  }
}

function isDigest(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

async function queueAndApproveDappTransaction({ context, popupWs, dappWs, label, hashKey, errorKey, tx }) {
  await step(context, `request ${label}`, () => evaluateCdp(dappWs, `(() => {
    const hashKey = ${JSON.stringify(hashKey)};
    const errorKey = ${JSON.stringify(errorKey)};
    const tx = ${JSON.stringify(tx)};
    window[hashKey] = "";
    window[errorKey] = "";
    window.ethereum.request({ method: "eth_sendTransaction", params: [tx] })
      .then((hash) => { window[hashKey] = hash; })
      .catch((error) => { window[errorKey] = error?.message ?? String(error); });
    return "queued";
  })()`, { label: `queue ${label}` }));
  const transaction = await step(context, `wait for pending ${label}`, () =>
    waitForPendingTransaction(popupWs, dappWs, context, `GET_STATE_SUMMARY poll pending ${label}`, `window[${JSON.stringify(errorKey)}] ?? ''`)
  );
  assertSimulationData(transaction, label);
  const transactionId = transaction.id;
  await step(context, `approve ${label}`, () =>
    extensionMessage(popupWs, { type: "APPROVE_DAPP_TRANSACTION", id: transactionId }, context, `APPROVE_DAPP_TRANSACTION (${label})`)
  );
  await step(context, `wait for ${label} hash`, () =>
    waitForCdpExpression(dappWs, `/^0x[0-9a-fA-F]{64}$/.test(window[${JSON.stringify(hashKey)}] || '')`, context.timeoutMs)
  );
  return await step(context, `read ${label} hash`, () => evaluateCdp(dappWs, `window[${JSON.stringify(hashKey)}]`));
}

function abiAddress(address) {
  return `${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function abiUint(value) {
  return value.toString(16).padStart(64, "0");
}

async function collectDappDiagnostics(context) {
  const { cdpHost, debugPort, dappWs, extensionId, popupWs } = context;
  const targets = await listCdpTargets(cdpHost, debugPort)
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  const targetSummary = Array.isArray(targets)
    ? targets.map((target) => ({ type: target.type, title: target.title, url: target.url }))
    : targets;
  const backgroundTarget = Array.isArray(targets) ? findExtensionServiceWorkerTarget(targets, extensionId) : undefined;
  return {
    targets: targetSummary,
    extensionResolution: await extensionResolutionDiagnostics(context),
    popup: await cdpJson(popupWs, `JSON.stringify({
      url: location.href,
      runtimeId: globalThis.chrome?.runtime?.id,
      readyState: document.readyState,
      hasBrowserRuntime: typeof globalThis.browser?.runtime?.sendMessage === "function",
      hasChromeRuntime: typeof globalThis.chrome?.runtime?.sendMessage === "function",
      body: document.body?.innerText?.slice(0, 500) ?? ""
    })`),
    dapp: await cdpJson(dappWs, `JSON.stringify({
      url: location.href,
      output: document.getElementById("output")?.textContent?.slice(0, 500) ?? "",
      status: document.getElementById("smoke-status")?.textContent?.slice(0, 500) ?? ""
    })`),
    background: backgroundTarget ? await cdpJsonForTarget({ host: cdpHost, port: debugPort }, backgroundTarget, `JSON.stringify({
      url: self.location.href,
      runtimeId: chrome.runtime.id,
      hasChromeRuntime: typeof chrome?.runtime?.onMessage?.hasListeners === "function",
      hasRuntimeListener: chrome.runtime.onMessage.hasListeners(),
      hasSessionStorage: typeof chrome.storage?.session?.get === "function",
      hasLocalStorage: typeof chrome.storage?.local?.get === "function"
    })`) : "background target not found",
    backgroundStorageProbe: backgroundTarget ? await cdpJsonForTarget({ host: cdpHost, port: debugPort }, backgroundTarget, `new Promise((resolve) => {
      const done = (value) => resolve(JSON.stringify(value));
      try {
        chrome.storage.session.get(null, (items) => {
          done({
            lastError: chrome.runtime.lastError?.message,
            sessionKeys: items ? Object.keys(items) : []
          });
        });
      } catch (error) {
        done({ error: error?.message ?? String(error) });
      }
    })`, { awaitPromise: true, timeoutMs: 5_000, label: "background storage probe" }) : "background target not found"
  };
}

async function step(context, label, run) {
  const startedAt = Date.now();
  logSmokeStep(context, `start ${label}`);
  try {
    const result = await run();
    logSmokeStep(context, `done ${label} (${Date.now() - startedAt}ms)`);
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logSmokeStep(context, `fail ${label} (${Date.now() - startedAt}ms): ${message}`);
    throw new Error(`${label} failed: ${message}`, { cause });
  }
}

function logSmokeStep(context, message) {
  if (context.smokeFlow !== "dapp" && context.smokeFlow !== "dapp-ui") return;
  console.error(`[smoke:${context.smokeFlow}] ${message}`);
}

// Real-UI connection approval: render the popup card, assert the Connect button
// is genuinely clickable, then click it — under a popup-scoped diagnostics
// socket that fails the run on any Runtime.exceptionThrown / console error while
// the card renders and the click is processed. Phase 3 (the parked
// eth_requestAccounts promise + accountsChanged event) is unchanged.
async function approveConnectionViaUi({ context, cdpHost, debugPort, popupWs, popupTarget }) {
  if (!popupTarget?.id && !popupTarget?.targetId) {
    throw new Error("Real-UI connect requires a popup CDP target id for diagnostics");
  }
  const popupDiagnostics = await step(context, "start popup UI diagnostics", () => startExtensionDiagnostics({
    host: cdpHost,
    port: debugPort,
    target: popupTarget,
    log: process.env.SMOKE_POPUP_DIAGNOSTICS_LOG === "1"
  }));
  try {
    await step(context, "render connection card (real UI)", () => waitForConnectionCard(popupWs, context.timeoutMs, SMOKE_WALLET_PASSWORD));
    await step(context, "assert Connect button clickable (real UI)", () => assertConnectClickable(popupWs));
    if (Array.isArray(context.realUiAccountIndexes) && context.realUiAccountIndexes.length) {
      await step(context, "select extra accounts (real UI)", () => selectConnectionAccounts(popupWs, context.realUiAccountIndexes));
      await step(context, "re-assert Connect button clickable (real UI)", () => assertConnectClickable(popupWs));
    }
    await step(context, "click Connect button (real UI)", () => clickConnect(popupWs));
    // Fail the run on any popup exception/console error observed during the
    // card render + click, mirroring the service-worker diagnostics gate.
    await step(context, "assert popup UI diagnostics clean", () => popupDiagnostics.assertClean());
  } catch (error) {
    const snapshot = popupDiagnostics.snapshot();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; popup diagnostics: ${JSON.stringify(snapshot)}`, { cause: error });
  } finally {
    await popupDiagnostics.stop().catch(() => undefined);
  }
}

async function extensionMessage(wsUrl, message, context, label = message.type) {
  return evaluateCdp(wsUrl, `(async () => {
    const message = ${JSON.stringify(message)};
    const label = ${JSON.stringify(label)};
    const timeoutMs = ${context.messageTimeoutMs};
    const backgroundErrorResponseKey = ${JSON.stringify(context.backgroundErrorResponseKey)};
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label + " timed out after " + timeoutMs + "ms")), timeoutMs);
    });
    const unwrap = (response) => {
      if (response && typeof response === "object" && response[backgroundErrorResponseKey]?.message) {
        throw new Error(response[backgroundErrorResponseKey].message);
      }
      return response;
    };
    const callbackRuntime = globalThis.chrome?.runtime;
    if (callbackRuntime?.sendMessage) return await Promise.race([new Promise((resolve, reject) => {
      callbackRuntime.sendMessage(message, (response) => {
        const error = callbackRuntime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        try {
          resolve(unwrap(response));
        } catch (cause) {
          reject(cause);
        }
      });
    }), timeout]);

    const promiseRuntime = globalThis.browser?.runtime;
    if (promiseRuntime?.sendMessage) return await Promise.race([promiseRuntime.sendMessage(message).then(unwrap), timeout]);
    throw new Error("Extension runtime messaging is unavailable");
  })()`, { awaitPromise: true, timeoutMs: context.messageTimeoutMs + 1_000, label });
}

async function dappProviderRequest(wsUrl, method, params, context, label = method) {
  return evaluateCdp(wsUrl, `(async () => {
    const timeoutMs = ${context.messageTimeoutMs};
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(${JSON.stringify(label)} + " timed out after " + timeoutMs + "ms")), timeoutMs);
    });
    try {
      const result = await Promise.race([
        window.ethereum.request({ method: ${JSON.stringify(method)}, params: ${JSON.stringify(params)} }),
        timeout
      ]);
      return { status: "resolved", result };
    } catch (error) {
      return {
        status: "rejected",
        message: error?.message ?? String(error),
        code: error?.code
      };
    }
  })()`, { awaitPromise: true, timeoutMs: context.messageTimeoutMs + 1_000, label });
}
