import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const commit = "a".repeat(40);
function harness(failAt) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args].join(" "));
    if (calls.length === failAt) throw new Error("simulated unavailable or failed check");
    if (args[0] === "rev-parse") return commit;
    return "";
  };
  return { run, calls };
}

test("release gate completes frozen install, lockfile, full audit and WDK checks on the event commit", async () => {
  const { runReleaseGate } = await import("./release-gate.mjs");
  const { run, calls } = harness();
  assert.equal(runReleaseGate({ run, expectedCommit: commit }).commit, commit);
  assert.ok(calls.includes("pnpm install --frozen-lockfile --ignore-scripts"));
  assert.ok(calls.includes("pnpm run smoke:lockfile"));
  assert.ok(calls.includes("pnpm run smoke:audit -- --all"));
  assert.ok(calls.includes("pnpm run smoke:wdk-deps"));
  assert.equal(calls.at(-1), "git diff --exit-code HEAD --");
});

test("every failed or unavailable prerequisite terminates the gate without later checks", async () => {
  const { runReleaseGate } = await import("./release-gate.mjs");
  const baseline = harness();
  runReleaseGate({ run: baseline.run, expectedCommit: commit });
  for (let failAt = 1; failAt <= baseline.calls.length; failAt += 1) {
    const { run, calls } = harness(failAt);
    assert.throws(() => runReleaseGate({ run, expectedCommit: commit }), /simulated/);
    assert.equal(calls.length, failAt);
  }
});

test("wrong or missing event commit blocks before install or audit", async () => {
  const { runReleaseGate } = await import("./release-gate.mjs");
  for (const expectedCommit of [undefined, "", "b".repeat(40), "refs/heads/master"]) {
    const { run, calls } = harness();
    assert.throws(() => runReleaseGate({ run, expectedCommit }), /commit/i);
    assert.ok(calls.length <= 1);
  }
});

test("commit mutation during the audit is rejected", async () => {
  const { runReleaseGate } = await import("./release-gate.mjs");
  const { run } = harness();
  let reads = 0;
  assert.throws(() => runReleaseGate({
    expectedCommit: commit,
    run(command, args) {
      if (args[0] === "rev-parse" && ++reads === 2) return "b".repeat(40);
      return run(command, args);
    }
  }), /commit/i);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("CI artifact path requires gate and verifier success for PR, push, tag and manual runs", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /tags: \["\*\*"\]/);
  assert.match(ci, /workflow_dispatch:/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /id: dependencies\s+uses: \.\/.github\/actions\/dependency-gate/);
  assert.match(ci, /id: verify\s+run: pnpm run verify:ci/);
  assert.match(ci, /if: success\(\) && steps.dependencies.outcome == 'success' && steps.verify.outcome == 'success'/);
  assert.ok(ci.indexOf("id: dependencies") < ci.indexOf("id: verify"));
  assert.match(ci, /if-no-files-found: error/);
  assert.doesNotMatch(ci, /always\(|continue-on-error|paths:/);
});

test("publishing waits on an unconditionally executed gate for the same SHA with read-only audit permissions", () => {
  const pages = read(".github/workflows/pages.yml");
  assert.match(pages, /dependencies:\s+runs-on: ubuntu-24.04\s+steps:/);
  assert.match(pages, /uses: \.\/.github\/actions\/dependency-gate/);
  assert.match(pages, /deploy:\s+needs: dependencies\s+if: success\(\) && needs.dependencies.result == 'success'/);
  assert.equal((pages.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 2);
  assert.match(pages, /permissions:\s+contents: read\s/);
  assert.doesNotMatch(pages.slice(0, pages.indexOf("  deploy:")), /pages: write|id-token: write/);
  assert.doesNotMatch(pages, /always\(|continue-on-error/);
});

test("release actions are immutable and gate has no skip or failure-tolerance switch", () => {
  for (const file of ["ci.yml", "pages.yml", "audit-schedule.yml", "dependency-pr.yml", "wdk-beta-check.yml"]) {
    const workflow = read(`.github/workflows/${file}`);
    for (const [, action] of workflow.matchAll(/uses: ([^\s]+)/g)) {
      assert.ok(action.startsWith("./") || /@[a-f0-9]{40}$/.test(action), `${file}: ${action}`);
    }
    assert.doesNotMatch(workflow, /continue-on-error|always\(/);
  }
  const action = read(".github/actions/dependency-gate/action.yml");
  assert.match(action, /run: node scripts\/release-gate.mjs/);
  assert.doesNotMatch(action, /\n\s+if:|continue-on-error|always\(/);
  assert.match(action, /node-version-file: .nvmrc/);
});

test("local CI verification audits all dependencies before it creates any package", () => {
  const verifier = read("scripts/verify-ci.mjs");
  const audit = verifier.indexOf('args: ["run", "smoke:audit", "--", "--all"]');
  assert.ok(audit !== -1 && audit < verifier.indexOf('args: ["run", "zip"]'));
  assert.match(verifier, /release-gate.test.mjs/);
});

test("actual upload and deployment conditions deny failed, skipped, cancelled and missing gate results", () => {
  const ci = read(".github/workflows/ci.yml");
  const pages = read(".github/workflows/pages.yml");
  const upload = ci.match(/if: (success\(\) && steps.dependencies.outcome[^\n]+)/)[1];
  const deploy = pages.match(/if: (success\(\) && needs.dependencies.result[^\n]+)/)[1];
  const outcomes = ["success", "failure", "skipped", "cancelled", undefined];
  for (const previousSuccess of [true, false]) {
    for (const gate of outcomes) {
      for (const verification of outcomes) {
        assert.equal(runInNewContext(upload, {
          success: () => previousSuccess,
          steps: { dependencies: { outcome: gate }, verify: { outcome: verification } }
        }), previousSuccess && gate === "success" && verification === "success");
      }
      assert.equal(runInNewContext(deploy, {
        success: () => previousSuccess,
        needs: { dependencies: { result: gate } }
      }), previousSuccess && gate === "success");
    }
  }
});
