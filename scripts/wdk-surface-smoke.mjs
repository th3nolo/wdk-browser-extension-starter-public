import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const docs = readFileSync("docs/DAPP_PRODUCTION_READINESS.md", "utf8");
const evaluation = JSON.parse(readFileSync("docs/wdk-surface-evaluation.json", "utf8"));
const chains = readFileSync("src/lib/chains.ts", "utf8");
const types = readFileSync("src/lib/types.ts", "utf8");

const allowedRuntimeWdkPackages = evaluation.allowedRuntimeWdkPackages ?? [];
const evaluatedNonRuntimePackages = evaluation.evaluatedNonRuntimePackages ?? [];
const blockedRuntimeTerms = evaluation.blockedRuntimeTerms ?? [];

const failures = [];
const runtimeDeps = pkg.dependencies ?? {};
const scripts = pkg.scripts ?? {};
const runtimeWdkPackages = Object.keys(runtimeDeps).filter((name) => name.startsWith("@tetherto/"));
const unexpectedRuntimeWdkPackages = runtimeWdkPackages.filter((name) => !allowedRuntimeWdkPackages.includes(name));

if (evaluation.schemaVersion !== 1) {
  failures.push("docs/wdk-surface-evaluation.json must use schemaVersion 1");
}

if (evaluation.officialDocs !== "https://docs.wdk.tether.io/llms-full.txt") {
  failures.push("docs/wdk-surface-evaluation.json must cite the official llms-full source");
}

if (!Array.isArray(allowedRuntimeWdkPackages) || allowedRuntimeWdkPackages.length === 0) {
  failures.push("docs/wdk-surface-evaluation.json must list allowed runtime WDK packages");
}

if (!Array.isArray(evaluatedNonRuntimePackages) || evaluatedNonRuntimePackages.length === 0) {
  failures.push("docs/wdk-surface-evaluation.json must list evaluated non-runtime packages");
}

if (!docs.includes("docs/wdk-surface-evaluation.json")) {
  failures.push("docs/DAPP_PRODUCTION_READINESS.md must point readers to docs/wdk-surface-evaluation.json");
}

if (unexpectedRuntimeWdkPackages.length > 0) {
  failures.push(`Unexpected runtime WDK package(s) exposed without this smoke being updated: ${unexpectedRuntimeWdkPackages.join(", ")}`);
}

for (const name of allowedRuntimeWdkPackages) {
  if (!runtimeDeps[name]) failures.push(`Missing expected runtime WDK package ${name}`);
}

for (const item of evaluatedNonRuntimePackages) {
  if (!item.name || !item.registryVersion || !item.decision || !Array.isArray(item.blockers) || item.blockers.length === 0) {
    failures.push(`Invalid WDK surface evaluation item: ${JSON.stringify(item)}`);
    continue;
  }
  if (runtimeDeps[item.name]) {
    failures.push(`${item.name} is installed but the surface evaluation still marks it as ${item.decision}`);
  }
  if (!docs.includes(item.name)) {
    failures.push(`docs/DAPP_PRODUCTION_READINESS.md does not mention ${item.name}`);
  }
  for (const phrase of item.requiredDocs) {
    if (!docs.includes(phrase)) {
      failures.push(`docs/DAPP_PRODUCTION_READINESS.md missing required package note for ${item.name}: ${phrase}`);
    }
  }
}

if (!docs.includes("https://docs.wdk.tether.io/llms-full.txt")) {
  failures.push("WDK surface docs must cite the official llms-full source");
}

if (!docs.includes("review the dependency tree")) {
  failures.push("WDK surface docs must explain how to add optional WDK packages");
}

if (/"ton"|'ton'|"tron"|'tron'/.test(types) || /id:\s*["'](?:ton|tron)["']/.test(chains)) {
  failures.push("TON/Tron chains are exposed in runtime types or chain registry without package/browser coverage");
}

for (const item of evaluatedNonRuntimePackages) {
  const runtimeReferences = findRuntimeReferences(item.name);
  if (runtimeReferences.length > 0) {
    failures.push(`${item.name} appears in runtime source without passing the WDK surface gate: ${runtimeReferences.join(", ")}`);
  }
}

for (const term of blockedRuntimeTerms) {
  const runtimeReferences = findRuntimeTermReferences(term);
  if (runtimeReferences.length > 0) {
    failures.push(`Unsupported WDK surface term "${term}" appears in runtime source without package/browser coverage: ${runtimeReferences.join(", ")}`);
  }
}

if (scripts["smoke:wdk-surface"] !== "node scripts/wdk-surface-smoke.mjs") {
  failures.push("package.json must expose smoke:wdk-surface");
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  runtimeWdkPackages,
  packageNotes: "docs/wdk-surface-evaluation.json",
  evaluatedNonRuntimePackages: evaluatedNonRuntimePackages.map(({ name, decision }) => ({ name, decision }))
}, null, 2));

function findRuntimeReferences(pattern) {
  const roots = ["entrypoints", "src"];
  const matches = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(pattern)) matches.push(file);
    }
  }
  return matches;
}

function findRuntimeTermReferences(term) {
  const roots = ["entrypoints", "src"];
  const matches = [];
  const pattern = termPattern(term);
  for (const root of roots) {
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      if (pattern.test(text)) matches.push(file);
    }
  }
  return matches;
}

function termPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[A-Za-z0-9]+$/.test(term)) return new RegExp(`\\b${escaped}\\b`, "g");
  return new RegExp(escaped, "g");
}

function walk(path) {
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path)
    .flatMap((entry) => walk(join(path, entry)))
    .filter((file) => /\.(ts|tsx|js|jsx|mjs)$/.test(file));
}
