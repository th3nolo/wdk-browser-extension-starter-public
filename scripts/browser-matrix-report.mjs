import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const outputPath = join(root, ".output", "browser-verification.json");
const browsers = (process.env.BROWSER_MATRIX ?? "cft,chrome,brave").split(",").map((entry) => entry.trim()).filter(Boolean);
const timeoutMs = Number(process.env.BROWSER_MATRIX_TIMEOUT_MS ?? "25000");
const childTimeoutMs = timeoutMs + 10_000;
const requiredBrowser = process.env.BROWSER_MATRIX_REQUIRED ?? "cft";
const startedAt = new Date().toISOString();
const results = [];

for (const browser of browsers) {
  const result = spawnSync("node", ["scripts/chrome-extension-smoke.mjs", `--browser=${browser}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SMOKE_TIMEOUT_MS: String(timeoutMs) },
    timeout: childTimeoutMs,
    killSignal: "SIGTERM"
  });
  const parsed = parseSmokeJson(result.stdout);
  results.push({
    browser,
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal ?? undefined,
    providerInjected: parsed?.providerInjected ?? false,
    announcements: parsed?.announcements?.length ?? 0,
    browserPath: parsed?.browserPath,
    error: result.status === 0 ? undefined : summarizeError(result.error?.message || result.stderr || result.stdout)
  });
}

const required = results.find((entry) => entry.browser === requiredBrowser);
const report = {
  ok: Boolean(required?.ok),
  startedAt,
  completedAt: new Date().toISOString(),
  requiredBrowser,
  timeoutMs,
  childTimeoutMs,
  results
};

await mkdir(join(root, ".output"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error(`Required browser smoke failed for ${requiredBrowser}`);
}

console.log(JSON.stringify({ ...report, outputPath }, null, 2));

function parseSmokeJson(output) {
  const match = output.match(/\{[\s\S]*\}\s*$/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

function summarizeError(output) {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (!normalized) return "No browser smoke output was captured";
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
}
