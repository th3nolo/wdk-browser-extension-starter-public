import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertReviewedAudit } from "./audit-policy.mjs";

const source = readFileSync(new URL("../audit-smoke.mjs", import.meta.url), "utf8");

test("a new high advisory on previously listed ws is blocked", () => {
  const advisory = {
    module_name: "ws", severity: "high",
    url: "https://github.com/advisories/GHSA-2222-3333-4444",
    findings: [{ version: "8.18.0", paths: [".>ethers>ws"] }]
  };
  const report = { advisories: { 1: advisory }, metadata: { vulnerabilities: { high: 1, critical: 0 } } };
  const audit = { report, names: ["ws"], directNames: ["ethers"], counts: report.metadata.vulnerabilities };
  // Execute the real CLI body with a deterministic audit boundary, never a registry or wallet.
  const context = vm.createContext({
    runProductionAudit: () => audit,
    assertReviewedAudit,
    process: { argv: [] },
    console: { log() {} }
  });
  assert.throws(() => vm.runInContext(source.replace(/^import .*;\r?\n/gm, ""), context), /Unreviewed audit findings/);
});

const now = new Date("2026-09-18T00:00:00Z");
const exception = {
  advisoryId: "GHSA-2222-3333-4444", package: "ws", versions: ["8.18.0"],
  rationale: "Synthetic reviewed fixture only; never a real risk acceptance.",
  owner: "test-fixture", expiresAt: "2026-10-01T00:00:00Z"
};
function report(overrides = {}) {
  return { advisories: { 1: {
    module_name: "ws", severity: "high", url: `https://github.com/advisories/${exception.advisoryId}`,
    findings: [{ version: "8.18.0" }], ...overrides
  } }, metadata: { vulnerabilities: { critical: 0 } } };
}

test("exact reviewed advisory, package and version passes before expiry", () => {
  assert.doesNotThrow(() => assertReviewedAudit(report(), [exception], now));
});
test("another advisory on the same reviewed package fails", () => {
  const audit = report();
  audit.advisories[2] = { ...audit.advisories[1], url: "https://github.com/advisories/GHSA-5555-6666-7777" };
  assert.throws(() => assertReviewedAudit(audit, [exception], now), /Unreviewed/);
});
test("expiry is exclusive, including exact UTC boundary", () => {
  for (const expiresAt of ["2026-09-17T23:59:59Z", now.toISOString().replace(".000Z", "Z")]) {
    assert.throws(() => assertReviewedAudit(report(), [{ ...exception, expiresAt }], now), /Expired/);
  }
});
test("every installed affected version must match exactly", () => {
  for (const findings of [[{ version: "8.17.1" }], [{ version: "8.18.0" }, { version: "8.17.1" }]]) {
    assert.throws(() => assertReviewedAudit(report({ findings }), [exception], now), /Unreviewed/);
  }
});
test("package identity cannot be reused", () => {
  assert.throws(() => assertReviewedAudit(report({ module_name: "other" }), [exception], now), /Unreviewed/);
});
test("critical findings never receive exceptions", () => {
  assert.throws(() => assertReviewedAudit(report({ severity: "critical" }), [exception], now), /Critical/);
  const audit = report();
  audit.metadata.vulnerabilities.critical = 1;
  assert.throws(() => assertReviewedAudit(audit, [exception], now), /Critical/);
});
test("missing review metadata, version ranges and invalid dates fail closed", () => {
  for (const change of [
    { owner: " " }, { rationale: "" }, { advisoryId: "ws" }, { package: "" },
    { versions: [] }, { versions: ["^8.18.0"] }, { expiresAt: "2026-10-01" },
    { expiresAt: "2026-02-30T00:00:00Z" }
  ]) {
    assert.throws(() => assertReviewedAudit(report(), [{ ...exception, ...change }], now), /requires/);
  }
});
test("unknown advisory identity or missing findings cannot be reviewed", () => {
  for (const change of [{ url: "https://example.com/GHSA-2222-3333-4444" }, { findings: [] }, { findings: [{}] }]) {
    assert.throws(() => assertReviewedAudit(report(change), [exception], now), /Unreviewed/);
  }
});
test("clean audit passes with no exceptions", () => {
  assert.doesNotThrow(() => assertReviewedAudit({ advisories: {}, metadata: { vulnerabilities: { critical: 0 } } }, [], now));
});
test("CLI requests all dependencies only when explicitly selected", () => {
  for (const all of [false, true]) {
    let options;
    vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, ""), {
      runProductionAudit: (value) => { options = value; return { report: { advisories: {} }, counts: {} }; },
      assertReviewedAudit, process: { argv: all ? ["--all"] : [] }, console: { log() {} }
    });
    assert.equal(options.productionOnly, !all);
  }
});

test("sync modes cannot approve findings or rewrite policy and documentation", () => {
  const paths = ["audit-smoke.mjs", "lib/audit-policy.mjs", "../docs/SECURITY.md"].map((path) => new URL(`../${path}`, import.meta.url));
  const before = paths.map((path) => readFileSync(path, "utf8"));
  const fixture = `export function runProductionAudit() { return ${JSON.stringify({ report: report(), counts: { high: 1 } })}; }`;
  const dataUrl = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
  const loader = `export function resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/lib/audit-report.mjs')) return {url: ${JSON.stringify(dataUrl(fixture))}, shortCircuit: true};
    return nextResolve(specifier, context);
  }`;
  const preload = `import {register} from 'node:module'; register(${JSON.stringify(dataUrl(loader))});`;
  for (const args of [[], ["--check"], ["--", "--check"]]) {
    const result = spawnSync(process.execPath, [
      "--import", dataUrl(preload), fileURLToPath(new URL("../sync-audit-allowlist.mjs", import.meta.url)), ...args
    ], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unreviewed audit findings/);
    assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), before);
  }
});
