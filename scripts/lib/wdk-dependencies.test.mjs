import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { WDK_DEPENDENCIES, WDK_WALLET_VERSION, assertWdkManifest, assertWdkSourceDependencies } from "./wdk-dependencies.mjs";

function runUpdater({ invalidPackage, invalidField, missingOverride = false, changedPackage = "@tetherto/wdk" } = {}) {
  const source = readFileSync(new URL("../check-wdk-beta.mjs", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  const current = { ...WDK_DEPENDENCIES, [changedPackage]: "1.0.0-beta.16" };
  const files = new Map([
    ["./package.json", JSON.stringify({ dependencies: current })],
    ["./pnpm-workspace.yaml", missingOverride ? "overrides: {}\n" : `overrides:\n  @tetherto/wdk-wallet: ${WDK_WALLET_VERSION}\n`],
    ["./docs/SECURITY.md", "The reviewed WDK matrix is documented here.\n"]
  ]);
  const writes = [];
  const installs = [];
  const context = vm.createContext({
    process: { argv: ["node", "check-wdk-beta.mjs", "--apply"], env: {}, platform: "linux", exit: () => assert.fail("unexpected early exit") },
    console: { log: () => undefined },
    resolve: (...parts) => parts.join("/"),
    readFileSync: (path) => {
      assert.ok(files.has(path), `unexpected read: ${path}`);
      return files.get(path);
    },
    writeFileSync: (path, contents) => { writes.push(path); files.set(path, contents); },
    appendFileSync: () => assert.fail("unexpected GitHub output"),
    spawnSync: (command, args) => {
      if (args[0] !== "view") {
        installs.push([command, ...args]);
        return { status: 0, stdout: "" };
      }
      const name = Object.keys(WDK_DEPENDENCIES).find((entry) => args[1] === entry || args[1].startsWith(`${entry}@`));
      assert.ok(name, `unexpected registry request: ${args[1]}`);
      const version = WDK_DEPENDENCIES[name];
      let value;
      if (args[2] === "versions") value = [version];
      else if (args[2] === "time") value = { [version]: invalidPackage === name && invalidField === "age" ? new Date().toISOString() : "2020-01-01T00:00:00Z" };
      else value = {
        name: invalidPackage === name && invalidField === "identity" ? "unexpected-package" : name,
        version,
        dependencies: { "@tetherto/wdk-wallet": invalidPackage === name && invalidField === "wallet" ? "1.0.0-beta.99" : name === "@tetherto/wdk" ? "^1.0.0-beta.15" : WDK_WALLET_VERSION },
        dist: { tarball: invalidPackage === name && invalidField === "source" ? "https://untrusted.example/package.tgz" : "https://registry.npmjs.org/package.tgz", integrity: "sha512-reviewed" }
      };
      return { status: 0, stdout: JSON.stringify(value) };
    },
    WDK_DEPENDENCIES, WDK_WALLET_VERSION, assertWdkManifest, assertWdkSourceDependencies
  });
  return { execute: () => vm.runInContext(source, context), files, writes, installs };
}

test("manual beta updater applies independently reviewed versions and accepts an unchanged base-wallet override", () => {
  const updater = runUpdater();
  updater.execute();
  assert.deepEqual(JSON.parse(updater.files.get("./package.json")).dependencies, WDK_DEPENDENCIES);
  assert.ok(updater.installs.some(([, command]) => command === "install"));
  assert.equal(updater.files.get("./pnpm-workspace.yaml"), `overrides:\n  @tetherto/wdk-wallet: ${WDK_WALLET_VERSION}\n`);
});

test("manual beta updater applies a reviewed chain update when the orchestrator is already current", () => {
  const updater = runUpdater({ changedPackage: "@tetherto/wdk-wallet-btc" });
  updater.execute();
  assert.deepEqual(JSON.parse(updater.files.get("./package.json")).dependencies, WDK_DEPENDENCIES);
  assert.ok(updater.installs.some(([, command]) => command === "install"));
});

for (const invalidField of ["age", "identity", "wallet", "source"]) {
  test(`manual beta updater rejects invalid module ${invalidField} before writing or installing`, () => {
    const updater = runUpdater({ invalidPackage: "@tetherto/wdk-wallet-spark", invalidField });
    const errors = { age: /72-hour/, identity: /identity mismatch/, wallet: /source constraint/, source: /registry source/ };
    assert.throws(updater.execute, errors[invalidField]);
    assert.deepEqual(updater.writes, []);
    assert.deepEqual(updater.installs, []);
  });
}

test("manual beta updater rejects a missing base-wallet override before mutation", () => {
  const updater = runUpdater({ missingOverride: true });
  assert.throws(updater.execute, /override/);
  assert.deepEqual(updater.writes, []);
  assert.deepEqual(updater.installs, []);
});

test("rejects an identical-beta bump across independently released WDK modules", () => {
  const dependencies = Object.fromEntries(Object.keys(WDK_DEPENDENCIES).map((name) => [name, WDK_WALLET_VERSION]));
  assert.throws(() => assertWdkManifest(dependencies), /reviewed WDK matrix/);
});

test("rejects missing, floating and unreviewed WDK package pins", () => {
  for (const name of Object.keys(WDK_DEPENDENCIES)) {
    for (const version of [undefined, "^" + WDK_DEPENDENCIES[name], "1.0.0-beta.9"]) {
      assert.throws(() => assertWdkManifest({ ...WDK_DEPENDENCIES, [name]: version }), /reviewed WDK matrix/);
    }
  }
});

test("checks upstream source constraints before accepting a forced base wallet", () => {
  for (const name of Object.keys(WDK_DEPENDENCIES)) {
    assert.throws(() => assertWdkSourceDependencies(name, { "@tetherto/wdk-wallet": "1.0.0-beta.9" }), /source constraint/);
    assert.throws(() => assertWdkSourceDependencies(name, {}), /source constraint/);
    assertWdkSourceDependencies(name, { "@tetherto/wdk-wallet": name === "@tetherto/wdk" ? "^1.0.0-beta.15" : WDK_WALLET_VERSION });
  }
  assertWdkManifest(WDK_DEPENDENCIES);
});

test("manual beta updater refuses an unreviewed bulk bump before writing or installing", () => {
  const source = readFileSync(new URL("../check-wdk-beta.mjs", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  const calls = [];
  const context = vm.createContext({
    process: { argv: ["node", "check-wdk-beta.mjs", "--apply"], env: {}, platform: "linux" },
    resolve: (...parts) => parts.join("/"),
    readFileSync: () => JSON.stringify({ dependencies: WDK_DEPENDENCIES }),
    writeFileSync: () => assert.fail("unreviewed bump wrote a file"),
    appendFileSync: () => assert.fail("unexpected GitHub output"),
    spawnSync: (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, "pnpm");
      assert.equal(args[0], "view");
      return { status: 0, stdout: JSON.stringify(args[2] === "versions" ? ["1.0.0-beta.99"] : { "1.0.0-beta.99": "2020-01-01T00:00:00Z" }) };
    },
    WDK_DEPENDENCIES, WDK_WALLET_VERSION, assertWdkManifest, assertWdkSourceDependencies
  });
  assert.throws(() => vm.runInContext(source, context), /reviewed WDK matrix/);
  assert.equal(calls.length, 2);
});
