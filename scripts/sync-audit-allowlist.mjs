import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProductionAudit } from "./lib/audit-report.mjs";

const root = resolve(".");
const checkOnly = process.argv.includes("--check");
const auditSmokePath = resolve(root, "scripts/audit-smoke.mjs");
const securityDocPath = resolve(root, "docs/SECURITY.md");

const { names, directNames, counts } = runProductionAudit();

function readAllowlist(source) {
  const knownMatch = source.match(/const knownVulnerabilities = new Set\(\[([\s\S]*?)\]\);/);
  const directMatch = source.match(/const knownDirectVulnerabilities = new Set\(\[([\s\S]*?)\]\);/);
  if (!knownMatch || !directMatch) {
    throw new Error("Unable to parse allowlists from scripts/audit-smoke.mjs");
  }

  const parseEntries = (body) =>
    [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();

  return {
    known: parseEntries(knownMatch[1]),
    direct: parseEntries(directMatch[1])
  };
}

function formatSet(name, entries) {
  const lines = entries.map((entry) => `  "${entry}"`).join(",\n");
  return `const ${name} = new Set([\n${lines}\n]);`;
}

function setsEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const auditSmokeSource = readFileSync(auditSmokePath, "utf8");
const current = readAllowlist(auditSmokeSource);
const knownChanged = !setsEqual(current.known, names);
const directChanged = !setsEqual(current.direct, directNames);

if (checkOnly) {
  if (knownChanged || directChanged) {
    throw new Error(
      "scripts/audit-smoke.mjs allowlist is out of sync with pnpm audit. Run pnpm run sync:audit-allowlist."
    );
  }

  console.log(JSON.stringify({ ok: true, mode: "check", knownVulnerabilities: names, directVulnerabilities: directNames }, null, 2));
  process.exit(0);
}

let updatedAuditSmoke = auditSmokeSource;
if (knownChanged) {
  updatedAuditSmoke = updatedAuditSmoke.replace(
    /const knownVulnerabilities = new Set\(\[[\s\S]*?\]\);/,
    formatSet("knownVulnerabilities", names)
  );
}
if (directChanged) {
  updatedAuditSmoke = updatedAuditSmoke.replace(
    /const knownDirectVulnerabilities = new Set\(\[[\s\S]*?\]\);/,
    formatSet("knownDirectVulnerabilities", directNames)
  );
}

if (knownChanged || directChanged) {
  writeFileSync(auditSmokePath, updatedAuditSmoke, "utf8");
}

const securityDoc = readFileSync(securityDocPath, "utf8");
const summaryLine =
  `The current audit summary is ${counts.total ?? names.length} known advisories: ` +
  `${counts.low ?? 0} low, ${counts.moderate ?? 0} moderate, ${counts.high ?? 0} high, and ${counts.critical ?? 0} critical.`;
const updatedSecurityDoc = securityDoc.replace(
  /The current audit summary is \d+ known advisories: \d+ low, \d+ moderate, \d+ high, and \d+ critical\./,
  summaryLine
);

if (updatedSecurityDoc !== securityDoc) {
  writeFileSync(securityDocPath, updatedSecurityDoc, "utf8");
}

console.log(JSON.stringify({
  ok: true,
  mode: "sync",
  updatedAllowlist: knownChanged || directChanged,
  updatedSecurityDoc: updatedSecurityDoc !== securityDoc,
  vulnerabilityCounts: counts,
  knownVulnerabilities: names,
  knownDirectVulnerabilities: directNames
}, null, 2));
