import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const apply = process.argv.includes("--apply");
const directPackages = [
  "@tetherto/wdk",
  "@tetherto/wdk-wallet-btc",
  "@tetherto/wdk-wallet-evm",
  "@tetherto/wdk-wallet-solana",
  "@tetherto/wdk-wallet-spark"
];
const MINIMUM_RELEASE_AGE_MS = 72 * 60 * 60 * 1000;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr ?? result.stdout ?? ""}`.trim());
  }
  return `${result.stdout ?? ""}`.trim();
}

function compareBetaVersions(left, right) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(version);
    if (!match) return null;
    return match.slice(1).map(Number);
  };

  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function appendGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

function isPublishedLongEnough(version, timeMetadata, now = Date.now()) {
  const publishedAt = Date.parse(timeMetadata?.[version] ?? "");
  return Number.isFinite(publishedAt) && now - publishedAt >= MINIMUM_RELEASE_AGE_MS;
}

const pkgPath = resolve(root, "package.json");
const securityDocPath = resolve(root, "docs/SECURITY.md");
const workspaceConfigPath = resolve(root, "pnpm-workspace.yaml");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.dependencies["@tetherto/wdk"];
if (!current) {
  throw new Error("package.json is missing @tetherto/wdk dependency.");
}

const versions = JSON.parse(run("pnpm", ["view", "@tetherto/wdk", "versions", "--json"]));
const timeMetadata = JSON.parse(run("pnpm", ["view", "@tetherto/wdk", "time", "--json"]));
const betaVersions = versions
  .filter((version) => /-beta\./.test(version))
  .sort(compareBetaVersions);
const latest = betaVersions.at(-1);
const eligibleBetaVersions = betaVersions.filter((version) => isPublishedLongEnough(version, timeMetadata));
const candidate = eligibleBetaVersions.at(-1);

if (!latest) {
  throw new Error("No beta versions found for @tetherto/wdk.");
}

appendGithubOutput("current", current);
appendGithubOutput("latest", latest);
if (candidate) appendGithubOutput("latest_eligible", candidate);

if (!candidate) {
  appendGithubOutput("updated", "false");
  appendGithubOutput("blocked_by_minimum_release_age", "true");
  console.log(JSON.stringify({ ok: true, updated: false, current, latest, latestEligible: null, blockedByMinimumReleaseAge: true }, null, 2));
  process.exit(0);
}

const skippedByMinimumReleaseAge = latest !== candidate;
if (compareBetaVersions(candidate, current) <= 0) {
  appendGithubOutput("updated", "false");
  if (skippedByMinimumReleaseAge) appendGithubOutput("blocked_by_minimum_release_age", "true");
  console.log(JSON.stringify({ ok: true, updated: false, current, latest, latestEligible: candidate, skippedByMinimumReleaseAge }, null, 2));
  process.exit(0);
}

if (!apply) {
  appendGithubOutput("updated", "false");
  appendGithubOutput("update_available", "true");
  if (skippedByMinimumReleaseAge) appendGithubOutput("blocked_by_minimum_release_age", "true");
  console.log(JSON.stringify({ ok: true, updated: false, updateAvailable: true, current, latest, latestEligible: candidate, skippedByMinimumReleaseAge }, null, 2));
  process.exit(0);
}

for (const name of directPackages) {
  pkg.dependencies[name] = candidate;
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
const workspaceConfig = readFileSync(workspaceConfigPath, "utf8");
const updatedWorkspaceConfig = workspaceConfig.replace(/@tetherto\/wdk-wallet:\s*\S+/, `@tetherto/wdk-wallet: ${candidate}`);
if (updatedWorkspaceConfig === workspaceConfig) {
  throw new Error("pnpm-workspace.yaml is missing the @tetherto/wdk-wallet override.");
}
writeFileSync(workspaceConfigPath, updatedWorkspaceConfig, "utf8");

run("pnpm", ["install", "--ignore-scripts"]);
run("node", ["scripts/sync-audit-allowlist.mjs"]);
run("pnpm", ["run", "smoke:wdk-deps"]);
run("pnpm", ["run", "smoke:audit"]);

const securityDoc = readFileSync(securityDocPath, "utf8");
const updatedSecurityDoc = securityDoc.replace(
  /Direct WDK packages are pinned to `[^`]+`/,
  `Direct WDK packages are pinned to \`${candidate}\``
);
if (updatedSecurityDoc !== securityDoc) {
  writeFileSync(securityDocPath, updatedSecurityDoc, "utf8");
}

appendGithubOutput("updated", "true");
appendGithubOutput("version", candidate);
console.log(JSON.stringify({ ok: true, updated: true, current, latest, latestEligible: candidate, skippedByMinimumReleaseAge }, null, 2));
