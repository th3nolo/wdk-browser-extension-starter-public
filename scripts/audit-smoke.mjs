import { runProductionAudit } from "./lib/audit-report.mjs";
import { assertReviewedAudit } from "./lib/audit-policy.mjs";

const productionOnly = !process.argv.includes("--all");
const { report, counts } = runProductionAudit({ productionOnly });
assertReviewedAudit(report);

console.log(JSON.stringify({
  ok: true,
  command: `pnpm audit${productionOnly ? " --prod" : ""} --json --audit-level=info`,
  vulnerabilityCounts: counts,
  reviewedAdvisories: Object.values(report.advisories).map((advisory) => advisory.url)
}, null, 2));
