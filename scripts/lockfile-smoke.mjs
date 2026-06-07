import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const lockfilePath = resolve(root, "pnpm-lock.yaml");
const prPolicy = process.argv.includes("--pr-policy");

if (!existsSync(lockfilePath)) {
  throw new Error("pnpm-lock.yaml is missing. Run pnpm install --lockfile-only and commit the lockfile.");
}

const before = readFileSync(lockfilePath, "utf8");
const refresh = spawnSync(
  "pnpm",
  ["install", "--lockfile-only", "--ignore-scripts"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" }
);
if ((refresh.status ?? 1) !== 0) {
  throw new Error(`pnpm install --lockfile-only failed:\n${refresh.stderr ?? refresh.stdout ?? ""}`.trim());
}

const after = readFileSync(lockfilePath, "utf8");
if (before !== after) {
  throw new Error(
    "pnpm-lock.yaml is out of sync with package.json. Run pnpm install --lockfile-only and commit the updated lockfile."
  );
}

if (prPolicy) {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    throw new Error("GITHUB_BASE_REF is required for --pr-policy.");
  }

  const diff = spawnSync(
    "git",
    ["diff", "--name-only", `origin/${baseRef}...HEAD`],
    { cwd: root, encoding: "utf8" }
  );
  if ((diff.status ?? 1) !== 0) {
    throw new Error(`git diff failed:\n${diff.stderr ?? diff.stdout ?? ""}`.trim());
  }

  const changedFiles = diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const packageJsonChanged = changedFiles.includes("package.json");
  const lockfileChanged = changedFiles.includes("pnpm-lock.yaml");

  if (packageJsonChanged && !lockfileChanged) {
    throw new Error(
      "package.json changed without a matching pnpm-lock.yaml update. Run pnpm install --lockfile-only and commit both files."
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  lockfile: "pnpm-lock.yaml",
  prPolicyChecked: prPolicy
}, null, 2));
