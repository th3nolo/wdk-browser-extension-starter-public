import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function startSmokeServer({ root }) {
  const testDapp = await readFile(join(root, "test-dapp.html"), "utf8");
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/test-dapp.html") {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(testDapp.replace("</body>", `${statusScript()}</body>`));
  });

  await new Promise((resolveListen) => server.listen(Number(process.env.SMOKE_PORT ?? 0), "127.0.0.1", resolveListen));
  const serverAddress = server.address();
  if (!serverAddress || typeof serverAddress === "string") throw new Error("Unable to determine smoke test server address");
  return { port: serverAddress.port, server };
}

export function validateStatus(status) {
  if (!status.hasEthereum) throw new Error("window.ethereum WDK provider was not injected");
  const announced = status.announcements.some((entry) => entry?.rdns === "io.tether.wdk.browser-starter");
  if (!announced) throw new Error("EIP-6963 provider announcement was not observed");
  if (!status.hasConnectControl) throw new Error("Test dapp connect control was not rendered");
  if (!status.hasSignControl) throw new Error("Test dapp sign control was not rendered");
}

function statusScript() {
  return `<script>
    window.__wdkAnnouncements = [];
    window.__wdkProviderEvents = [];
    window.__wdkProviderEventAttached = false;
    function attachProviderEvents(provider) {
      if (!provider || window.__wdkProviderEventAttached) return;
      window.__wdkProviderEventAttached = true;
      provider.on?.("connect", event => {
        window.__wdkProviderEvents.push({ event: "connect", chainId: event?.chainId });
        updateSmokeStatus();
      });
      provider.on?.("accountsChanged", accounts => {
        window.__wdkProviderEvents.push({ event: "accountsChanged", accounts });
        updateSmokeStatus();
      });
      provider.on?.("disconnect", error => {
        window.__wdkProviderEvents.push({ event: "disconnect", code: error?.code, message: error?.message });
        updateSmokeStatus();
      });
    }
    function updateSmokeStatus() {
      let status = document.getElementById("smoke-status");
      if (!status) {
        status = document.createElement("pre");
        status.id = "smoke-status";
        document.body.appendChild(status);
      }
      status.textContent = JSON.stringify({
        hasEthereum: Boolean(window.ethereum && window.ethereum.isWDKWallet),
        announcements: window.__wdkAnnouncements,
        providerEvents: window.__wdkProviderEvents,
        hasConnectControl: Boolean(document.getElementById("connect")),
        hasSignControl: Boolean(document.getElementById("sign"))
      });
    }
    window.addEventListener("eip6963:announceProvider", event => {
      window.__wdkAnnouncements.push(event.detail.info);
      attachProviderEvents(event.detail.provider);
      updateSmokeStatus();
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setInterval(() => {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      updateSmokeStatus();
    }, 250);
    updateSmokeStatus();
  </script>`;
}
