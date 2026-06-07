import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const prReview = process.argv.includes("--pr-review");
const lockfilePath = resolve(root, "pnpm-lock.yaml");

function gitShow(ref, file) {
  return spawnSync("git", ["show", `${ref}:${file}`], {
    cwd: root,
    encoding: "utf8"
  });
}

function refHasFile(ref, file) {
  const result = spawnSync("git", ["cat-file", "-e", `${ref}:${file}`], {
    cwd: root,
    encoding: "utf8"
  });
  return (result.status ?? 1) === 0;
}

function readFileFromRef(ref, file) {
  const result = gitShow(ref, file);
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Unable to read ${file} from ${ref}:\n${result.stderr ?? result.stdout ?? ""}`.trim());
  }
  return result.stdout;
}

function normalizeLockKey(key) {
  if (!key) return key;
  const first = key.charCodeAt(0);
  const last = key.charCodeAt(key.length - 1);
  if ((first === 34 && last === 34) || (first === 39 && last === 39)) return key.slice(1, -1);
  return key;
}

function normalizePackageEntry(name, version) {
  if (!name || !version) return undefined;
  return `${name}@${version}`;
}

function normalizePnpmPackageKey(key) {
  const withoutPeerSuffix = key.replace(/\(.+$/, "");
  const withoutLeadingSlash = withoutPeerSuffix.startsWith("/") ? withoutPeerSuffix.slice(1) : withoutPeerSuffix;
  const versionSeparator = withoutLeadingSlash.lastIndexOf("@");
  if (versionSeparator <= 0) return undefined;
  const name = withoutLeadingSlash.slice(0, versionSeparator);
  const version = withoutLeadingSlash.slice(versionSeparator + 1);
  return normalizePackageEntry(name, version);
}

function extractPnpmResolvedEntries(lockfileText) {
  const resolved = new Map();
  let section = "";
  for (const line of lockfileText.split(/\r?\n/)) {
    if (/^[a-zA-Z][^:]*:$/.test(line)) {
      section = line.slice(0, -1);
      continue;
    }
    if (section !== "packages" && section !== "snapshots") continue;
    const match = /^  ([^ ].+):$/.exec(line);
    if (!match) continue;
    const key = normalizeLockKey(match[1]);
    if (!key || key.startsWith(".")) continue;
    const entry = normalizePnpmPackageKey(key);
    if (entry) resolved.set(entry, entry);
  }
  return resolved;
}

function extractPackageLockResolvedEntries(lockfileText) {
  const lockfile = JSON.parse(lockfileText);
  const resolved = new Map();
  for (const [installPath, meta] of Object.entries(lockfile.packages ?? {})) {
    if (!installPath || !meta?.version) continue;
    const marker = "node_modules/";
    const markerIndex = installPath.lastIndexOf(marker);
    if (markerIndex === -1) continue;
    const name = installPath.slice(markerIndex + marker.length);
    const entry = normalizePackageEntry(name, meta.version);
    if (entry) resolved.set(entry, entry);
  }
  return resolved;
}

function readResolvedEntriesFromRef(ref) {
  if (refHasFile(ref, "pnpm-lock.yaml")) {
    return {
      lockfile: "pnpm-lock.yaml",
      entries: extractPnpmResolvedEntries(readFileFromRef(ref, "pnpm-lock.yaml"))
    };
  }
  if (refHasFile(ref, "package-lock.json")) {
    return {
      lockfile: "package-lock.json",
      entries: extractPackageLockResolvedEntries(readFileFromRef(ref, "package-lock.json"))
    };
  }
  throw new Error(`Unable to find pnpm-lock.yaml or package-lock.json in ${ref}.`);
}

function diffResolvedEntries(baseEntries, headEntries) {
  const keys = [...new Set([...baseEntries.keys(), ...headEntries.keys()])].sort();
  const changes = [];

  for (const key of keys) {
    const inBase = baseEntries.has(key);
    const inHead = headEntries.has(key);
    if (inBase && inHead) continue;
    changes.push({ key, change: inHead ? "added" : "removed" });
  }

  return changes;
}

function lockfileChangedInPr(baseRef) {
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", `origin/${baseRef}...HEAD`],
    { cwd: root, encoding: "utf8" }
  );
  if ((diff.status ?? 1) !== 0) {
    throw new Error(`git diff failed:\n${diff.stderr ?? diff.stdout ?? ""}`.trim());
  }

  const changedFiles = diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim());
  return changedFiles.includes("pnpm-lock.yaml") || changedFiles.includes("package-lock.json");
}

if (prReview) {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    throw new Error("GITHUB_BASE_REF is required for --pr-review.");
  }

  if (!lockfileChangedInPr(baseRef)) {
    console.log(JSON.stringify({ ok: true, mode: "pr-review", lockfileChanged: false }, null, 2));
    process.exit(0);
  }
}

if (!existsSync(lockfilePath)) {
  throw new Error("pnpm-lock.yaml is missing.");
}

const headLockfile = "pnpm-lock.yaml";
const headEntries = extractPnpmResolvedEntries(readFileSync(lockfilePath, "utf8"));

let baseLockfile;
let baseEntries = new Map();
if (prReview) {
  const baseRef = process.env.GITHUB_BASE_REF;
  const base = readResolvedEntriesFromRef(`origin/${baseRef}`);
  baseLockfile = base.lockfile;
  baseEntries = base.entries;
} else if (process.argv.includes("--base")) {
  const baseIndex = process.argv.indexOf("--base");
  const baseRef = process.argv[baseIndex + 1];
  if (!baseRef) throw new Error("--base requires a git ref.");
  const base = readResolvedEntriesFromRef(baseRef);
  baseLockfile = base.lockfile;
  baseEntries = base.entries;
}

const changes = diffResolvedEntries(baseEntries, headEntries);

console.log(`\nResolved lockfile entry changes (${baseLockfile ?? "empty baseline"} -> ${headLockfile}):\n`);
if (!changes.length) {
  console.log("No resolved lockfile entry changes detected.");
} else {
  for (const entry of changes) {
    console.log(`- ${entry.key}: ${entry.change}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: prReview ? "pr-review" : "local",
  lockfileChanged: prReview ? true : undefined,
  baseLockfile,
  headLockfile,
  changeCount: changes.length,
  changes
}, null, 2));
