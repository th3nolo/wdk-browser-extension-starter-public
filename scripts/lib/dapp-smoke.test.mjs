import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const flow = readFileSync(new URL("./chrome-smoke/dapp-flow.mjs", import.meta.url), "utf8");
const waitCall = flow.match(/await step\(context, "wait for signature result", \(\) => (.+)\);/)?.[1];
assert.ok(waitCall, "The real dApp smoke must wait for the personal_sign result");

function signatureReady(browser) {
  return vm.runInNewContext(waitCall, {
    dappWs: "test-page", context: { timeoutMs: 1000 },
    waitForCdpExpression: (_ws, expression) => vm.runInContext(expression, browser)
  });
}

test("personal_sign smoke survives a real fixture render on provider rediscovery", () => {
  const html = readFileSync(new URL("../../test-dapp.html", import.meta.url), "utf8");
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map();
  const listeners = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: "" });
    return elements.get(id);
  } };
  const window = {
    addEventListener: (event, listener) => listeners.set(event, listener),
    dispatchEvent() {}, setTimeout() {}
  };
  const browser = vm.createContext({ window, document, Event });
  vm.runInContext(script, browser);
  const signature = `0x${"ab".repeat(65)}`;
  window.__wdkSmokeSignature = signature;
  document.getElementById("signature").textContent = signature;
  listeners.get("eip6963:announceProvider")({ detail: { info: { name: "WDK", rdns: "io.tether.wdk.browser-starter" }, provider: {} } });
  assert.equal(document.getElementById("signature").textContent, "none");
  assert.equal(signatureReady(browser), true);
});

test("personal_sign smoke does not accept missing, truncated or malformed signatures", () => {
  for (const signature of [undefined, "", "0x", "0x1234", `0x${"zz".repeat(65)}`]) {
    assert.equal(signatureReady(vm.createContext({ window: { __wdkSmokeSignature: signature } })), false);
  }
});
