import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const directPackages = [
  "@tetherto/wdk",
  "@tetherto/wdk-wallet-btc",
  "@tetherto/wdk-wallet-evm",
  "@tetherto/wdk-wallet-solana",
  "@tetherto/wdk-wallet-spark"
];

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const WDK_BASELINE = pkg.dependencies?.["@tetherto/wdk"];
if (!WDK_BASELINE) {
  throw new Error("package.json must pin @tetherto/wdk to the shared WDK baseline version.");
}
const mismatchedDirect = directPackages.filter((name) => pkg.dependencies?.[name] !== WDK_BASELINE);
if (mismatchedDirect.length) {
  throw new Error(`Direct WDK packages must be pinned to ${WDK_BASELINE}: ${mismatchedDirect.join(", ")}`);
}

const workspaceConfig = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
if (!workspaceConfig.includes(`@tetherto/wdk-wallet: ${WDK_BASELINE}`) && !workspaceConfig.includes(`"@tetherto/wdk-wallet": ${WDK_BASELINE}`)) {
  throw new Error(`pnpm-workspace.yaml overrides must pin @tetherto/wdk-wallet to ${WDK_BASELINE}`);
}

const list = spawnSync(
  "pnpm",
  ["list", "@tetherto/wdk-wallet", "--depth", "Infinity", "--json"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" }
);
if ((list.status ?? 1) !== 0) {
  throw new Error(`pnpm list @tetherto/wdk-wallet failed:\n${list.stderr || list.stdout || ""}`.trim());
}

let tree;
try {
  const parsed = JSON.parse(list.stdout);
  tree = Array.isArray(parsed) ? parsed[0] : parsed;
} catch (error) {
  throw new Error(`Unable to parse pnpm list JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const resolvedVersions = new Set();
function walk(deps) {
  if (!deps || typeof deps !== "object") return;
  for (const [name, node] of Object.entries(deps)) {
    if (name === "@tetherto/wdk-wallet" && node?.version) resolvedVersions.add(node.version);
    walk(node?.dependencies);
  }
}
walk(tree.dependencies);

if (resolvedVersions.size !== 1) {
  throw new Error(
    `Expected one resolved @tetherto/wdk-wallet version (${WDK_BASELINE}); found: ${[...resolvedVersions].sort().join(", ") || "none"}`
  );
}

const [resolvedVersion] = resolvedVersions;
if (resolvedVersion !== WDK_BASELINE) {
  throw new Error(`Resolved @tetherto/wdk-wallet is ${resolvedVersion}; expected ${WDK_BASELINE}`);
}

console.log(JSON.stringify({
  ok: true,
  baseline: WDK_BASELINE,
  directPackages: Object.fromEntries(directPackages.map((name) => [name, pkg.dependencies[name]])),
  resolvedWalletVersion: resolvedVersion
}, null, 2));
