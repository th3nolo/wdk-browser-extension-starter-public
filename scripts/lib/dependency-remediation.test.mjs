import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
const packages = lockfile.split(/\r?\npackages:\r?\n/)[1]?.split(/\r?\nsnapshots:\r?\n/)[0];
assert.ok(packages, "The frozen lockfile must expose its resolved package graph");
const resolved = [...packages.matchAll(/^  ['"]?([^\s].*?)['"]?:$/gm)].map(([, key]) => {
  const separator = key.lastIndexOf("@");
  return { name: key.slice(0, separator), version: key.slice(separator + 1) };
});

test("the browser toolchain excludes the unpatched node-forge and legacy shell-quote chains", () => {
  // GHSA-86w9-cpqp-85rv has no published node-forge fix. Remove its consumer
  // chain instead of substituting a crypto implementation or accepting risk.
  const removed = new Set(["web-ext-run", "@devicefarmer/adbkit", "node-forge", "fx-runner", "shell-quote"]);
  assert.deepEqual(resolved.filter(({ name }) => removed.has(name)), []);
});

// Check every resolved copy, not just a workspace override. These offline
// regressions still catch a restored vulnerable lockfile if the registry is down.
for (const { name, minimum, advisory } of [
  { name: "@grpc/grpc-js", minimum: "1.14.5", advisory: "GHSA-m9gg-hp2v-232j / GHSA-f596-whhp-79r4" },
  { name: "brace-expansion", minimum: "1.1.21", advisory: "GHSA-q2hr-2g5m-vwhr" },
  { name: "brace-expansion", minimum: "5.0.12", advisory: "GHSA-q2hr-2g5m-vwhr" },
  { name: "source-map-js", minimum: "1.2.2", advisory: "GHSA-68fv-2mgg-jv7q" }
]) {
  test(`${name} ${minimum.split(".")[0]}.x stays patched for ${advisory}`, () => {
    const floor = minimum.split(".").map(Number);
    const versions = resolved.filter((entry) => entry.name === name && entry.version.split(".")[0] === String(floor[0]));
    assert.ok(versions.length, `Expected audited ${name} ${floor[0]}.x dependency coverage`);
    for (const { version } of versions) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `Review prerelease ${name}@${version} separately`);
      const [, minor, patch] = version.split(".").map(Number);
      assert.ok(minor > floor[1] || (minor === floor[1] && patch >= floor[2]), `${name}@${version} is affected by ${advisory}`);
    }
  });
}
