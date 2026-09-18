import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const severities = ["info", "low", "moderate", "high", "critical"];

export function runProductionAudit({ productionOnly = true } = {}) {
  const audit = spawnSync("pnpm", ["audit", ...(productionOnly ? ["--prod"] : []), "--json", "--audit-level=info"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const report = parseAuditResult(audit);

  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const directRuntimeDeps = new Set(Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...(productionOnly ? {} : pkg.devDependencies)
  }));
  requireReport(!directRuntimeDeps.size || report.metadata.totalDependencies > 0, "missing dependency coverage");
  const advisories = report.advisories;
  const entries = Object.entries(advisories);
  const names = entries
    .map(([, advisory]) => advisory.module_name)
    .sort();
  const directNames = [...new Set(entries.flatMap(([, advisory]) => directDependenciesForAdvisory(advisory, directRuntimeDeps)))].sort();

  return {
    report,
    vulnerabilities: advisories,
    names,
    directNames,
    counts: report.metadata.vulnerabilities
  };
}

export function parseAuditResult(audit) {
  if (audit.error) throw new Error("pnpm audit subprocess failed", { cause: audit.error });
  if (audit.signal) throw new Error(`pnpm audit subprocess terminated by ${audit.signal}`);
  if (audit.status !== 0 && audit.status !== 1) throw new Error(`pnpm audit subprocess returned unexpected status ${audit.status}`);
  const output = typeof audit.stdout === "string" ? audit.stdout.trim() : "";
  if (!output) throw new Error("pnpm audit did not return JSON output");
  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`Unable to parse pnpm audit JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  // pnpm 11.0.9 emits this advisory schema, not npm's vulnerabilities schema.
  // Metadata counts include filtered/ignored advisories, so exact reconciliation
  // also detects incomplete audit coverage caused by local pnpm configuration.
  requireReport(isRecord(report) && !Object.hasOwn(report, "error") && !Object.hasOwn(report, "vulnerabilities"), "unsupported or error report");
  requireReport(isRecord(report.advisories) && isRecord(report.metadata), "missing advisories or metadata");
  const counts = report.metadata.vulnerabilities;
  requireReport(isRecord(counts) && Object.keys(counts).length === severities.length, "invalid vulnerability counts");
  for (const severity of severities) requireReport(isCount(counts[severity]), `invalid ${severity} count`);
  validateDependencyCounts(report.metadata);

  const actualCounts = Object.fromEntries(severities.map(severity => [severity, 0]));
  const affectedPackages = new Set();
  for (const [id, advisory] of Object.entries(report.advisories)) {
    requireReport(isRecord(advisory) && isCount(advisory.id) && String(advisory.id) === id, "invalid advisory identity");
    requireReport(nonEmptyString(advisory.module_name) && severities.includes(advisory.severity), "invalid advisory name or severity");
    requireReport(Array.isArray(advisory.findings) && advisory.findings.length > 0, "missing advisory findings");
    for (const finding of advisory.findings) {
      requireReport(isRecord(finding) && nonEmptyString(finding.version), "missing finding version");
      requireReport(["dev", "optional", "bundled"].every(key => typeof finding[key] === "boolean"), "invalid finding classification");
      requireReport(Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(validPath), "missing or invalid finding paths");
      affectedPackages.add(`${advisory.module_name}@${finding.version}`);
    }
    actualCounts[advisory.severity]++;
  }
  for (const severity of severities) {
    requireReport(counts[severity] === actualCounts[severity], `incomplete or inconsistent ${severity} advisory coverage`);
  }
  requireReport(affectedPackages.size <= report.metadata.totalDependencies, "inconsistent affected dependency coverage");
  requireReport(audit.status === (Object.keys(report.advisories).length ? 1 : 0), "exit status disagrees with report");
  return report;
}

function validateDependencyCounts(metadata) {
  const keys = ["dependencies", "devDependencies", "optionalDependencies", "totalDependencies"];
  requireReport(keys.every(key => isCount(metadata[key])), "invalid dependency metadata");
  const { dependencies, devDependencies, optionalDependencies, totalDependencies } = metadata;
  // pnpm counts dev-only optional packages in both categories; production
  // packages are disjoint. Do not incorrectly require all three to sum exactly.
  requireReport(
    totalDependencies >= dependencies + Math.max(devDependencies, optionalDependencies) &&
    totalDependencies <= dependencies + devDependencies + optionalDependencies,
    "inconsistent dependency metadata"
  );
}

function requireReport(condition, reason) {
  if (!condition) throw new Error(`Invalid pnpm audit report: ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validPath(path) {
  if (!nonEmptyString(path)) return false;
  const parts = path.split(">");
  return parts.length >= 2 && parts.every(nonEmptyString);
}

function directDependenciesForAdvisory(advisory, directRuntimeDeps) {
  const direct = [];
  for (const finding of advisory.findings) {
    for (const path of finding.paths) {
      const first = path.split(">")[1];
      if (first && directRuntimeDeps.has(first)) direct.push(first);
    }
  }
  return direct;
}
