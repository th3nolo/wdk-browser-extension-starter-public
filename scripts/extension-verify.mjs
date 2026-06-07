#!/usr/bin/env node
// Dynamic-ish extension verifier: catches the three ways a "fixed" extension
// still shows old behaviour in the browser:
//   1. A forbidden / known-bad RPC host baked into the manifest (regression guard).
//   2. A stale build (source edited but `pnpm build` not re-run).
//   3. Drift between the fresh build and the folder Chrome actually loads
//      (the classic WSL trap: build lands in .output/chrome-mv3, but Chrome on
//      Windows loads a frozen copy under /mnt/c/Users/<you>/Downloads/chrome-mv3).
//
// Usage:
//   node scripts/extension-verify.mjs                 # verify only
//   node scripts/extension-verify.mjs --sync          # also mirror build -> load dir
//   EXT_LOAD_DIR=/mnt/c/Users/Manuel/Downloads/chrome-mv3 node scripts/extension-verify.mjs --sync
//   node scripts/extension-verify.mjs --load-dir=/path/to/loaded --sync
//   node scripts/extension-verify.mjs --allow-stale-build   # downgrade stale-build to a warning

import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(root, ".output", "chrome-mv3");
const MANIFEST = join(BUILD_DIR, "manifest.json");
const REPORT = join(root, ".output", "extension-verify.json");

// Hosts that must NEVER appear: the public Solana RPCs 403 extension-origin traffic.
const FORBIDDEN_HOSTS = ["api.mainnet-beta.solana.com", "api.mainnet.solana.com"];
// Hosts that must be present so we know we are looking at a correct, current build.
const REQUIRED_HOSTS = ["solana-rpc.publicnode.com", "api.sparkscan.io"];

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const optValue = (name) => {
  const prefix = `--${name}=`;
  const entry = args.find((a) => a.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
};

const wantSync = hasFlag("sync");
const allowStaleBuild = hasFlag("allow-stale-build");
const loadDirArg = optValue("load-dir") ?? process.env.EXT_LOAD_DIR;

const failures = [];
const warnings = [];
const notes = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => notes.push(m);

function originOf(value) {
  try {
    return new URL(value.replace(/\/\*$/, "")).origin;
  } catch {
    return undefined;
  }
}
function hostOf(value) {
  try {
    return new URL(value.replace(/\/\*$/, "")).hostname;
  } catch {
    return undefined;
  }
}
function parseConnectSrc(csp) {
  const match = /connect-src\s+([^;]+)/i.exec(csp);
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean);
}
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function newestMtime(paths) {
  let best = { path: undefined, mtime: 0 };
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) visit(join(p, entry));
      return;
    }
    if (st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
  };
  for (const p of paths) visit(p);
  return best;
}
function autodetectLoadDir() {
  const candidates = [];
  // WSL: Windows user Downloads copies are the usual culprit.
  const usersRoot = "/mnt/c/Users";
  try {
    for (const user of readdirSync(usersRoot)) {
      candidates.push(join(usersRoot, user, "Downloads", "chrome-mv3"));
      candidates.push(join(usersRoot, user, "Desktop", "chrome-mv3"));
    }
  } catch {
    // not WSL / no /mnt/c — fine
  }
  candidates.push(join(homedir(), "Downloads", "chrome-mv3"));
  return candidates.find((dir) => existsSync(join(dir, "manifest.json")));
}

// ── 1. Build exists ────────────────────────────────────────────────────────
if (!existsSync(MANIFEST)) {
  fail(`No built extension at ${BUILD_DIR}. Run: pnpm build`);
  report();
}
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const manifestMtime = statSync(MANIFEST).mtimeMs;

// ── 2. Build freshness (source edited but not rebuilt) ─────────────────────
const watched = ["src", "wxt.config.ts", "package.json"].map((p) => join(root, p)).filter(existsSync);
const newest = newestMtime(watched);
if (newest.path && newest.mtime > manifestMtime + 1000) {
  const msg =
    `Build is STALE — ${newest.path.replace(`${root}/`, "")} changed after the last build ` +
    `(${new Date(newest.mtime).toISOString()} > manifest ${new Date(manifestMtime).toISOString()}). Run: pnpm build`;
  allowStaleBuild ? warn(msg) : fail(msg);
} else {
  note("Build is newer than source ✓");
}

// ── 3. Manifest host safety ────────────────────────────────────────────────
const cspString = String(manifest.content_security_policy?.extension_pages ?? manifest.content_security_policy ?? "");
const connectTokens = parseConnectSrc(cspString);
const connectHosts = new Set(connectTokens.map(hostOf).filter(Boolean));
const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
const hostPermHosts = new Set(hostPerms.map(hostOf).filter(Boolean));

for (const host of FORBIDDEN_HOSTS) {
  if (connectHosts.has(host)) fail(`Forbidden host in CSP connect-src: ${host} (403s extension-origin traffic)`);
  if (hostPermHosts.has(host)) fail(`Forbidden host in host_permissions: ${host}`);
}
for (const host of REQUIRED_HOSTS) {
  if (!connectHosts.has(host)) fail(`Required host missing from CSP connect-src: ${host}`);
  if (!hostPermHosts.has(host)) fail(`Required host missing from host_permissions: ${host}`);
}
if (!failures.length) note(`Manifest hosts safe ✓ (${connectHosts.size} connect-src, ${hostPermHosts.size} host_permissions)`);

// connect-src and host_permissions should agree for every https origin, or a
// background fetch / page fetch can be silently CSP-blocked at runtime.
const httpsConnect = new Set([...connectHosts].filter((h) => connectTokens.some((t) => t === `https://${h}`)));
const httpsHostPerm = new Set([...hostPermHosts].filter((h) => hostPerms.some((t) => t.startsWith(`https://${h}`))));
for (const h of httpsConnect) if (!httpsHostPerm.has(h)) warn(`https://${h} is in connect-src but NOT host_permissions (background fetch may be blocked)`);
for (const h of httpsHostPerm) if (!httpsConnect.has(h)) warn(`https://${h} is in host_permissions but NOT connect-src (page fetch may be CSP-blocked)`);

// ── 4. Sync + drift detection against the folder Chrome loads ───────────────
const loadDir = loadDirArg ?? autodetectLoadDir();
let loadedInSync = null;
if (loadDir) {
  if (wantSync) {
    cpSync(BUILD_DIR, loadDir, { recursive: true, force: true });
    note(`Synced fresh build → ${loadDir}`);
  }
  const loadManifest = join(loadDir, "manifest.json");
  if (!existsSync(loadManifest)) {
    warn(`Load dir has no manifest.json yet: ${loadDir} (run with --sync to populate it)`);
  } else if (sha256(MANIFEST) === sha256(loadManifest)) {
    loadedInSync = true;
    note(`Loaded copy is in sync ✓ → ${loadDir}`);
  } else {
    loadedInSync = false;
    fail(
      `Loaded copy is STALE → ${loadDir}\n` +
      `   Its manifest differs from the fresh build, so Chrome is running old code.\n` +
      `   Fix: EXT_LOAD_DIR=${loadDir} pnpm run verify:extension:sync   (then reload the extension)`
    );
    try {
      const loadCsp = String(JSON.parse(readFileSync(loadManifest, "utf8")).content_security_policy?.extension_pages ?? "");
      for (const host of FORBIDDEN_HOSTS) if (loadCsp.includes(host)) note(`   ↳ loaded copy still allows forbidden host ${host}`);
      for (const host of REQUIRED_HOSTS) if (!loadCsp.includes(host)) note(`   ↳ loaded copy is missing required host ${host}`);
    } catch {
      // ignore parse issues on the stale copy
    }
  }
} else {
  note("No external load dir found. Load .output/chrome-mv3 directly, or set EXT_LOAD_DIR to your Windows copy and re-run with --sync.");
}

writeFileSync(
  REPORT,
  `${JSON.stringify(
    {
      ok: failures.length === 0,
      buildDir: BUILD_DIR,
      manifestSha256: sha256(MANIFEST),
      manifestMtime: new Date(manifestMtime).toISOString(),
      forbiddenHosts: FORBIDDEN_HOSTS,
      requiredHosts: REQUIRED_HOSTS,
      connectSrcHosts: [...connectHosts].sort(),
      hostPermissionHosts: [...hostPermHosts].sort(),
      loadDir: loadDir ?? null,
      loadedInSync,
      synced: wantSync && Boolean(loadDir),
      failures,
      warnings
    },
    null,
    2
  )}\n`
);

report();

function report() {
  for (const n of notes) console.log(`  • ${n}`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  if (failures.length) {
    console.error(`\n✗ extension-verify FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`\nLoad-unpacked path for Chrome: ${loadDirArg ?? BUILD_DIR}`);
    console.error(`Report: ${REPORT}`);
    process.exit(1);
  }
  console.log("\n✓ extension-verify PASSED");
  console.log(`  Load-unpacked path for Chrome: ${loadDirArg ?? autodetectLoadDir() ?? BUILD_DIR}`);
  console.log(`  Report: ${REPORT}`);
  process.exit(0);
}
