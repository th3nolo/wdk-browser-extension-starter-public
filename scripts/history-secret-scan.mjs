#!/usr/bin/env node
// Full-history secret scanner. This walks EVERY blob across ALL refs because a
// published repository exposes its history, including secrets that were committed
// and later "removed". Wallet-specific: it flags BIP-39 seed phrases
// (checksum-validated to avoid prose false positives) and hex private keys.
//
// Self-contained: uses only git + the repo's bip39 dependency. Exits non-zero on any
// non-allowlisted finding. Run: node scripts/history-secret-scan.mjs

import { execFileSync } from "node:child_process";
import bip39 from "bip39";

const englishWordSet = new Set(bip39.wordlists.english);

// Publicly documented test vectors with no real funds — safe to appear in fixtures.
const ALLOWLISTED_MNEMONICS = new Set([
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  "test test test test test test test test test test test junk",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
]);
const ALLOWLISTED_MNEMONIC_REPLACEMENTS = [...ALLOWLISTED_MNEMONICS].map((phrase) => ({
  phrase,
  re: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
}));

// Well-known public test private keys (Hardhat/Anvil account #0, etc.) — not secrets.
const ALLOWLISTED_HEX = new Set([
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
]);

// Paths where high-entropy/hex hits are integrity hashes, not secrets.
const NOISE_PATHS = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/];

// Paths that legitimately contain TEST credentials/vectors: test files, fixtures,
// and demo/smoke scripts (test passwords, keccak hash vectors, the abandon test
// seed, Chrome-binary checksums). The low-signal heuristic rules in RELAXED_IN_TEST
// are suppressed here — but the HIGH-signal rules (real cloud tokens, PEM keys, and
// checksum-validated non-allowlisted BIP-39 seeds) stay active even in these paths,
// so a real secret committed to a test file would still trip the gate.
const TEST_MATERIAL_PATHS = [
  /\.test\.[tj]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)scripts\/(?:.*-)?smoke[^/]*$/,
  /(^|\/)scripts\/create-[^/]*\.mjs$/,
  /(^|\/)scripts\/chrome-for-testing-manifest\.json$/
];
const RELAXED_IN_TEST = new Set([
  "generic-secret-assign",
  "hex-64-private-key-or-hash",
  "private-key-env-assign"
]);

function isExpectedTestMaterial(rule, paths) {
  if (!RELAXED_IN_TEST.has(rule)) return false;
  return [...paths].every((p) => TEST_MATERIAL_PATHS.some((re) => re.test(p)));
}

const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "woff", "woff2", "ttf", "otf", "eot", "zip", "gz", "tgz", "bz2", "pdf", "mp4", "webm", "mov", "wasm", "node", "br", "map"]);

const RULES = [
  { id: "pem-private-key", severity: "critical", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "aws-access-key-id", severity: "critical", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", severity: "critical", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: "slack-token", severity: "high", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: "stripe-secret-key", severity: "critical", re: /\bsk_live_[0-9A-Za-z]{24,}\b/ },
  { id: "npm-token", severity: "high", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "jwt", severity: "medium", re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/ },
  { id: "alchemy-url-key", severity: "high", re: /(?:g\.alchemy\.com|alchemyapi\.io)\/v2\/[A-Za-z0-9_\-]{20,}/ },
  { id: "infura-url-key", severity: "high", re: /infura\.io\/v3\/[0-9a-fA-F]{32}/ },
  { id: "generic-secret-assign", severity: "medium", re: /(?:secret|passwd|password|api[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i },
  { id: "private-key-env-assign", severity: "high", re: /(?:PRIVATE_KEY|MNEMONIC|SEED_PHRASE)\s*=\s*\S{8,}/ }
];

function redact(match) {
  if (match.length <= 12) return `${match.slice(0, 2)}…${match.slice(-2)}`;
  return `${match.slice(0, 6)}…${match.slice(-4)} (len ${match.length})`;
}

function isNoisePath(paths) {
  return [...paths].every((p) => NOISE_PATHS.some((re) => re.test(p)));
}

function maskAllowlistedMnemonics(text) {
  let masked = text;
  for (const { phrase, re } of ALLOWLISTED_MNEMONIC_REPLACEMENTS) {
    masked = masked.replace(re, " ".repeat(phrase.length));
  }
  return masked;
}

// blobSha -> Set(paths). rev-list --objects lists blobs/trees with a path; commits without.
const blobPaths = new Map();
const objectLines = execFileSync("git", ["rev-list", "--all", "--objects"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\n");
for (const line of objectLines) {
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const sha = line.slice(0, sp);
  const path = line.slice(sp + 1);
  if (!blobPaths.has(sha)) blobPaths.set(sha, new Set());
  blobPaths.get(sha).add(path);
}

const findings = [];
let scannedBlobs = 0;
let skippedBinary = 0;

for (const [sha, paths] of blobPaths) {
  const ext = ([...paths][0].split(".").pop() || "").toLowerCase();
  if (BINARY_EXT.has(ext)) { skippedBinary += 1; continue; }
  let type;
  try {
    type = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    continue;
  }
  if (type !== "blob") continue;
  let content;
  try {
    content = execFileSync("git", ["cat-file", "blob", sha], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    continue;
  }
  if (content.length > 4 * 1024 * 1024) continue; // oversized; almost certainly not a hand-written secret
  if (content.includes(0)) { skippedBinary += 1; continue; } // NUL => binary
  const text = content.toString("utf8");
  scannedBlobs += 1;

  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m && !isExpectedTestMaterial(rule.id, paths)) {
      findings.push({ rule: rule.id, severity: rule.severity, sha, paths: [...paths], sample: redact(m[0]) });
    }
  }

  // Hex private keys (64 hex) — skip integrity-hash files; allowlist known test keys.
  if (!isNoisePath(paths) && !isExpectedTestMaterial("hex-64-private-key-or-hash", paths)) {
    for (const m of text.matchAll(/\b(?:0x)?([0-9a-fA-F]{64})\b/g)) {
      const hex = m[1].toLowerCase();
      if (ALLOWLISTED_HEX.has(hex)) continue;
      findings.push({ rule: "hex-64-private-key-or-hash", severity: "review", sha, paths: [...paths], sample: redact(m[0]) });
    }
  }

  // BIP-39 mnemonics — checksum-validated so prose doesn't false-positive.
  const mnemonicScanText = maskAllowlistedMnemonics(text);
  if (/\b[a-z]{3,8}(?:\s+[a-z]{3,8}){10,}/.test(mnemonicScanText)) {
    const words = mnemonicScanText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      for (const len of [12, 15, 18, 21, 24]) {
        if (i + len > words.length) break;
        const window = words.slice(i, i + len);
        if (!window.every((w) => englishWordSet.has(w))) continue;
        const phrase = window.join(" ");
        if (bip39.validateMnemonic(phrase) && !ALLOWLISTED_MNEMONICS.has(phrase)) {
          findings.push({ rule: "bip39-mnemonic", severity: "critical", sha, paths: [...paths], sample: `${window.slice(0, 2).join(" ")} … ${window.slice(-1)[0]} (${len} words)` });
        }
      }
    }
  }
}

// De-dupe identical (rule, sha) pairs.
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.rule}:${f.sha}:${f.sample}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const ok = unique.length === 0;
console.log(JSON.stringify({
  ok,
  scope: "full-git-history",
  commits: Number(execFileSync("git", ["rev-list", "--all", "--count"], { encoding: "utf8" }).trim()),
  scannedBlobs,
  skippedBinary,
  findings: unique
}, null, 2));

if (!ok) {
  console.error(`\n[history-secret-scan] ${unique.length} potential secret(s) found in git history.`);
  console.error("Review each. If a real secret was ever committed, rotate it AND scrub history (git filter-repo / BFG) before publishing - deleting the file in a later commit is NOT enough.");
  process.exit(1);
}
console.log("\n[history-secret-scan] clean — no secrets detected across full history.");
