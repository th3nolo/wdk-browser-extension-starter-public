import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mock, test } from "node:test";
import { parseAuditResult, runProductionAudit } from "./audit-report.mjs";

// Shape emitted by pnpm 11.0.9's bulkResponseToAuditReport. Counts are per
// advisory, not per finding/path; dependency categories can overlap.
function cleanReport() {
  return {
    advisories: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      dependencies: 2, devDependencies: 0, optionalDependencies: 0, totalDependencies: 2
    }
  };
}

function advisoryReport(severity = "high") {
  const report = cleanReport();
  report.advisories[123] = {
    id: 123, module_name: "example", severity,
    title: "Example advisory", vulnerable_versions: "<2.0.0",
    github_advisory_id: "GHSA-2345-6789-cfgh",
    url: "https://github.com/advisories/GHSA-2345-6789-cfgh",
    findings: [{ version: "1.0.0", paths: [".>example"], dev: false, optional: false, bundled: false }]
  };
  report.metadata.vulnerabilities[severity] = 1;
  return report;
}

function result(report, status = Object.keys(report.advisories ?? {}).length ? 1 : 0) {
  return { stdout: JSON.stringify(report), stderr: "", status, signal: null };
}

test("accepts the pinned pnpm clean report", () => {
  const report = cleanReport();
  assert.deepEqual(parseAuditResult(result(report)), report);
});

for (const severity of ["info", "low", "moderate", "high", "critical"]) {
  test(`accepts complete ${severity} advisory reports with exit 1`, () => {
    const report = advisoryReport(severity);
    report.advisories[123].findings[0].paths.push(".>parent>example");
    report.advisories[123].findings.push({ ...report.advisories[123].findings[0], version: "1.1.0" });
    assert.deepEqual(parseAuditResult(result(report)), report);
  });
}

test("allows diagnostic stderr without treating it as report JSON", () => {
  const audit = result(cleanReport());
  audit.stderr = "pnpm diagnostic warning\n";
  assert.deepEqual(parseAuditResult(audit), cleanReport());
});

for (const [label, audit] of [
  ["service error", result({ error: { code: "E503", message: "Unavailable" } }, 1)],
  ["service error with zero exit", result({ error: { code: "E503" } }, 0)],
  ["empty object", result({})],
  ["null report", { stdout: "null", status: 0 }],
  ["array report", { stdout: "[]", status: 0 }],
  ["empty stdout", { stdout: "", status: 0 }],
  ["stderr-only JSON", { stdout: "", stderr: JSON.stringify(cleanReport()), status: 0 }],
  ["malformed JSON", { stdout: "{", status: 0 }],
  ["spawn failure with valid stdout", { ...result(cleanReport()), error: new Error("ENOENT") }],
  ["signal with valid stdout", { ...result(cleanReport()), signal: "SIGTERM" }],
  ["null status", { ...result(cleanReport()), status: null }],
  ["missing status", { stdout: JSON.stringify(cleanReport()) }],
  ["unexpected status", result(cleanReport(), 2)],
  ["clean exit 1", result(cleanReport(), 1)],
  ["advisories exit 0", result(advisoryReport(), 0)],
  ["unsupported npm schema", result({ auditReportVersion: 2, vulnerabilities: {}, metadata: cleanReport().metadata })]
]) {
  test(`rejects ${label}`, () => assert.throws(() => parseAuditResult(audit), /pnpm audit/i));
}

const corruptions = [
  ["missing metadata", r => delete r.metadata],
  ["missing advisories", r => delete r.advisories],
  ["array advisories", r => { r.advisories = []; }],
  ["error alongside report", r => { r.error = { code: "E503" }; }],
  ["missing severity count", r => delete r.metadata.vulnerabilities.low],
  ["string count", r => { r.metadata.vulnerabilities.high = "1"; }],
  ["negative count", r => { r.metadata.vulnerabilities.low = -1; }],
  ["fractional count", r => { r.metadata.vulnerabilities.low = 0.5; }],
  ["unsafe count", r => { r.metadata.vulnerabilities.low = Number.MAX_SAFE_INTEGER + 1; }],
  ["unknown severity count", r => { r.metadata.vulnerabilities.unknown = 1; }],
  ["filtered advisories", r => { r.advisories = {}; }],
  ["underreported count", r => { r.metadata.vulnerabilities.high = 0; }],
  ["wrong severity count", r => { r.metadata.vulnerabilities.high = 0; r.metadata.vulnerabilities.low = 1; }],
  ["missing dependency count", r => delete r.metadata.totalDependencies],
  ["zero dependency coverage", r => { r.metadata.dependencies = 0; r.metadata.totalDependencies = 0; }],
  ["impossible dependency count", r => { r.metadata.dependencies = 3; }],
  ["null advisory", r => { r.advisories[123] = null; }],
  ["missing advisory id", r => delete r.advisories[123].id],
  ["inconsistent advisory id", r => { r.advisories[123].id = 456; }],
  ["missing module name", r => delete r.advisories[123].module_name],
  ["unknown advisory severity", r => { r.advisories[123].severity = "unknown"; }],
  ["missing findings", r => delete r.advisories[123].findings],
  ["empty findings", r => { r.advisories[123].findings = []; }],
  ["missing version", r => delete r.advisories[123].findings[0].version],
  ["empty paths", r => { r.advisories[123].findings[0].paths = []; }],
  ["malformed path", r => { r.advisories[123].findings[0].paths = ["example"]; }],
  ["empty path segment", r => { r.advisories[123].findings[0].paths = [".>>example"]; }],
  ["missing finding classification", r => delete r.advisories[123].findings[0].dev]
];

for (const [label, corrupt] of corruptions) {
  test(`rejects ${label}`, () => {
    const report = advisoryReport();
    corrupt(report);
    assert.throws(() => parseAuditResult(result(report, 1)), /pnpm audit/i);
  });
}

test("accepts overlapping dev and optional dependency categories", () => {
  const report = cleanReport();
  report.metadata = { ...report.metadata, dependencies: 0, devDependencies: 2, optionalDependencies: 2 };
  assert.deepEqual(parseAuditResult(result(report)), report);
});

test("accepts a genuinely empty dependency report", () => {
  const report = cleanReport();
  report.metadata.dependencies = 0;
  report.metadata.totalDependencies = 0;
  assert.deepEqual(parseAuditResult(result(report)), report);
});

function withAuditProcess(audit, run) {
  const spawn = mock.method(childProcess, "spawnSync", () => audit);
  syncBuiltinESMExports();
  try {
    run(spawn);
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
}

test("runProductionAudit rejects service errors before returning a clean result", () => {
  withAuditProcess(result({ error: { code: "E503" } }, 1), () => {
    assert.throws(() => runProductionAudit(), /unsupported or error report/);
  });
});

for (const productionOnly of [true, false]) {
  test(`runProductionAudit preserves the caller API and requests full severity coverage (productionOnly=${productionOnly})`, () => {
    const report = advisoryReport();
    report.advisories[123].findings[0].paths = [".>ethers>example"];
    withAuditProcess(result(report), spawn => {
      const parsed = productionOnly ? runProductionAudit() : runProductionAudit({ productionOnly });
      assert.deepEqual(parsed, {
        report, vulnerabilities: report.advisories, names: ["example"], directNames: ["ethers"],
        counts: report.metadata.vulnerabilities
      });
      assert.deepEqual(spawn.mock.calls[0].arguments.slice(0, 2), [
        "pnpm", ["audit", ...(productionOnly ? ["--prod"] : []), "--json", "--audit-level=info"]
      ]);
    });
  });
}

test("runProductionAudit rejects zero coverage for this nonempty project", () => {
  const report = cleanReport();
  report.metadata.dependencies = 0;
  report.metadata.totalDependencies = 0;
  withAuditProcess(result(report), () => {
    assert.throws(() => runProductionAudit(), /missing dependency coverage/);
  });
});

test("full audit includes direct development dependencies in the caller API", () => {
  const report = advisoryReport();
  report.advisories[123].findings[0].paths = [".>vitest>example"];
  withAuditProcess(result(report), () => {
    assert.deepEqual(runProductionAudit({ productionOnly: false }).directNames, ["vitest"]);
  });
});
