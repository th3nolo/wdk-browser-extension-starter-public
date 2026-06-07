import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "wxt";
import react from "@vitejs/plugin-react";
import { buildConnectSrcDirective, buildHostPermissions } from "./src/lib/rpc-endpoints";

const rootDir = dirname(fileURLToPath(import.meta.url));
// Single source of truth for the version: package.json (mirrored by scripts/lib/extension-artifact.mjs).
const packageVersion = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")).version as string;
const hostPermissions = buildHostPermissions();
const connectSrc = buildConnectSrcDirective();

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [react()],
    define: {
      "process.env": {}
    },
    resolve: {
      alias: {
        "sodium-universal": resolve(rootDir, "src/shims/sodium-universal.ts")
      }
    }
  }),
  manifest: {
    name: "WDK Browser Wallet Starter",
    description: "Self-custodial Chrome/Brave wallet starter powered by Tether WDK.",
    version: packageVersion,
    permissions: ["storage", "alarms"],
    optional_host_permissions: ["https://*/*"],
    web_accessible_resources: [
      {
        resources: ["inpage.js"],
        matches: ["http://*/*", "https://*/*"]
      }
    ],
    host_permissions: hostPermissions,
    action: {
      default_title: "WDK Wallet"
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; ${connectSrc}`
    }
  }
});
