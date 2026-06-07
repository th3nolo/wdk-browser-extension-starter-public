import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export function runProductionAudit() {
  const audit = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const output = `${audit.stdout ?? ""}\n${audit.stderr ?? ""}`.trim();
  if (!output) throw new Error("pnpm audit did not return JSON output");

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`Unable to parse pnpm audit JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const directRuntimeDeps = new Set(Object.keys(pkg.dependencies ?? {}));
  const advisories = report.advisories ?? report.vulnerabilities ?? {};
  const entries = Object.entries(advisories);
  const names = entries
    .map(([name, advisory]) => advisory?.module_name ?? advisory?.name ?? name)
    .sort();
  const directNames = [...new Set(entries.flatMap(([, advisory]) => directDependenciesForAdvisory(advisory, directRuntimeDeps)))].sort();

  return {
    report,
    vulnerabilities: advisories,
    names,
    directNames,
    counts: report.metadata?.vulnerabilities ?? {}
  };
}

function directDependenciesForAdvisory(advisory, directRuntimeDeps) {
  if (advisory?.isDirect && advisory?.name) return [advisory.name];
  const findings = Array.isArray(advisory?.findings) ? advisory.findings : [];
  const direct = [];
  for (const finding of findings) {
    for (const path of finding.paths ?? []) {
      const first = String(path).split(">")[1];
      if (first && directRuntimeDeps.has(first)) direct.push(first);
    }
  }
  return direct;
}
