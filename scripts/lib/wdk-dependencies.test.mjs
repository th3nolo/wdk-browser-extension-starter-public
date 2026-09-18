import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { WDK_DEPENDENCIES, WDK_WALLET_VERSION, assertWdkManifest, assertWdkSourceDependencies } from "./wdk-dependencies.mjs";

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
      return { status: 0, stdout: JSON.stringify(args[2] === "versions" ? ["1.0.0-beta.18"] : { "1.0.0-beta.18": "2020-01-01T00:00:00Z" }) };
    },
    assertWdkManifest
  });
  assert.throws(() => vm.runInContext(source, context), /reviewed WDK matrix/);
  assert.equal(calls.length, 2);
});
