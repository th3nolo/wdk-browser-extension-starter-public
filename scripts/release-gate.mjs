import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32" && command === "pnpm",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.error?.message ?? result.signal ?? result.status})`);
  }
  return result.stdout.trim();
}

// A successful audit of another ref is not release evidence. No cached audit,
// skip flag, or best-effort mode is accepted.
export function runReleaseGate({ run = runCommand, expectedCommit = process.env.GITHUB_SHA } = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? "")) {
    throw new Error("The release gate requires the exact event commit in GITHUB_SHA.");
  }
  function verifyInputs() {
    const commit = run("git", ["rev-parse", "HEAD"]);
    if (commit !== expectedCommit) throw new Error("Checked-out commit differs from the audited event commit.");
    // Include staged edits: refreshes must not change code, policy or resolved inputs.
    run("git", ["diff", "--exit-code", "HEAD", "--"]);
  }

  verifyInputs();
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  run("pnpm", ["run", "smoke:lockfile"]);
  verifyInputs();
  run("pnpm", ["run", "smoke:audit", "--", "--all"]);
  run("pnpm", ["run", "smoke:wdk-deps"]);
  verifyInputs();
  return { ok: true, commit: expectedCommit, auditScope: "all" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(runReleaseGate(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
