import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const manifestPath = join(resolve("."), ".output", "chrome-mv3", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must build as Manifest V3");
if (manifest.background?.service_worker !== "background.js") throw new Error("Manifest must register the background service worker");
if (manifest.action?.default_popup !== "popup.html") throw new Error("Manifest action must point to popup.html");

const permissions = new Set(manifest.permissions ?? []);

for (const permission of ["storage", "alarms"]) {
  if (!permissions.has(permission)) throw new Error(`Missing required permission: ${permission}`);
}

for (const permission of ["activeTab", "tabs", "scripting", "clipboardRead", "clipboardWrite"]) {
  if (permissions.has(permission)) throw new Error(`Unexpected broad permission: ${permission}`);
}

const extensionCsp = manifest.content_security_policy?.extension_pages ?? "";
if (!extensionCsp.includes("script-src 'self'")) throw new Error("Extension CSP must restrict scripts to self");
if (!extensionCsp.includes("object-src 'self'")) throw new Error("Extension CSP must restrict object sources to self");

const contentScript = (manifest.content_scripts ?? []).find((entry) => entry.js?.includes("content-scripts/content.js"));
if (!contentScript) throw new Error("Content script must be declared");
if (contentScript.run_at !== "document_start") throw new Error("Content script must run at document_start");
for (const match of ["http://*/*", "https://*/*"]) {
  if (!contentScript.matches?.includes(match)) throw new Error(`Content script missing match: ${match}`);
}

const inpageResource = (manifest.web_accessible_resources ?? []).find((entry) => entry.resources?.includes("inpage.js"));
if (!inpageResource) throw new Error("inpage.js must be declared as a web-accessible resource");
for (const match of ["http://*/*", "https://*/*"]) {
  if (!inpageResource.matches?.includes(match)) throw new Error(`inpage.js web-accessible resource missing match: ${match}`);
}

const hostPermissions = new Set(manifest.host_permissions ?? []);
const optionalHostPermissions = new Set(manifest.optional_host_permissions ?? []);

if (hostPermissions.has("https://*/*")) {
  throw new Error("Broad https://*/* host permission must not be granted by default; use per-RPC allowlist");
}

for (const hostPermission of ["http://localhost/*", "http://127.0.0.1/*"]) {
  if (!hostPermissions.has(hostPermission)) throw new Error(`Missing local dev host permission: ${hostPermission}`);
}

for (const hostPermission of [
  "https://ethereum-rpc.publicnode.com/*",
  "https://polygon-bor-rpc.publicnode.com/*",
  "https://arbitrum-one-rpc.publicnode.com/*",
  "https://rpc.plasma.to/*",
  "https://solana-rpc.publicnode.com/*",
  "https://blockstream.info/*",
  "https://mempool.space/*",
  "https://api.sparkscan.io/*",
  "https://btc1.trezor.io/*"
]) {
  if (!hostPermissions.has(hostPermission)) throw new Error(`Missing allowlisted RPC host permission: ${hostPermission}`);
}

if (!optionalHostPermissions.has("https://*/*")) {
  throw new Error("Optional https://*/* host permission is required for user RPC overrides");
}

if (extensionCsp.includes("https://*")) {
  throw new Error("Extension CSP connect-src must not allow all HTTPS origins");
}

console.log(JSON.stringify({
  ok: true,
  manifestVersion: manifest.manifest_version,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions,
  background: manifest.background,
  action: manifest.action,
  contentScripts: manifest.content_scripts,
  webAccessibleResources: manifest.web_accessible_resources,
  csp: extensionCsp
}, null, 2));
