import { runProductionAudit } from "./lib/audit-report.mjs";

const knownVulnerabilities = new Set([
  "elliptic",
  "ws"
]);
const knownDirectVulnerabilities = new Set([
  "@tetherto/wdk-wallet-btc",
  "@tetherto/wdk-wallet-evm",
  "ethers"
]);

const { report, names, directNames, counts } = runProductionAudit();
const unknown = names.filter((name) => !knownVulnerabilities.has(name));
const unknownDirect = directNames.filter((name) => !knownDirectVulnerabilities.has(name));
const critical = counts.critical ?? 0;

if (critical > 0) throw new Error(`Production audit reported ${critical} critical vulnerabilities`);
if (unknown.length) throw new Error(`Production audit reported undocumented vulnerabilities: ${unknown.join(", ")}`);
if (unknownDirect.length) throw new Error(`Production audit reported undocumented direct vulnerable dependencies: ${unknownDirect.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  command: "pnpm audit --prod --json",
  vulnerabilityCounts: counts,
  knownVulnerabilities: names,
  knownDirectVulnerabilities: directNames,
  critical,
  auditExitCodeExpected: Object.keys(report.advisories ?? report.vulnerabilities ?? {}).length ? 1 : 0
}, null, 2));
