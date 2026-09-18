import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const steps = [
  { label: "dependency gate tests", command: "node", args: ["--test", "scripts/lib/*.test.mjs", "scripts/release-gate.test.mjs"] },
  { label: "lockfile integrity", command: "pnpm", args: ["run", "smoke:lockfile"] },
  { label: "complete dependency audit", command: "pnpm", args: ["run", "smoke:audit", "--", "--all"] },
  { label: "wdk dependency alignment", command: "pnpm", args: ["run", "smoke:wdk-deps"] },
  { label: "lint", command: "pnpm", args: ["run", "lint"] },
  { label: "typecheck", command: "pnpm", args: ["run", "typecheck"] },
  { label: "tests", command: "pnpm", args: ["test"] },
  { label: "zip", command: "pnpm", args: ["run", "zip"] },
  { label: "zip artifact smoke", command: "pnpm", args: ["run", "smoke:zip"] },
  { label: "wdk smoke", command: "pnpm", args: ["run", "smoke:wdk"] },
  { label: "wdk surface smoke", command: "pnpm", args: ["run", "smoke:wdk-surface"] },
  { label: "manifest smoke", command: "pnpm", args: ["run", "smoke:manifest"] },
  { label: "diff whitespace", command: "git", args: ["diff", "--check"] }
];

const startedAt = Date.now();
const results = [];

for (const step of steps) {
  const stepStartedAt = Date.now();
  console.log(`\n[verify:ci] ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: root, encoding: "utf8", stdio: "inherit",
    shell: process.platform === "win32" && step.command === "pnpm"
  });
  const durationMs = Date.now() - stepStartedAt;
  results.push({ label: step.label, exitCode: result.status, durationMs });
  if ((result.status ?? 1) !== 0) {
    console.error(JSON.stringify({ ok: false, failedStep: step.label, results }, null, 2));
    process.exit(result.status ?? 1);
  }
}

console.log(`\n${JSON.stringify({ ok: true, durationMs: Date.now() - startedAt, results }, null, 2)}`);
