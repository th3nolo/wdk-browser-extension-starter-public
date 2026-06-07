import { installInpageProvider } from "../src/lib/provider/inpage";

export default defineUnlistedScript(() => {
  const script = document.currentScript;
  const encodedBridgeToken = script instanceof HTMLScriptElement
    ? script.dataset.wdkBridgeToken
    : undefined;
  if (!encodedBridgeToken) throw new Error("WDK inpage provider requires a content-script bridge token");
  installInpageProvider(encodedBridgeToken);
});
