// The legacy package allowlist had no advisory-specific owner or expiry.
// Add entries only after a maintainer reviews the exact advisory and versions.
export const reviewedExceptions = [];

const ghsaPattern = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

export function assertReviewedAudit(report, exceptions = reviewedExceptions, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid audit policy clock");
  if (!Array.isArray(exceptions)) throw new Error("Audit exceptions must be an array");
  for (const exception of exceptions) {
    if (!exception || !ghsaPattern.test(exception.advisoryId) || !nonempty(exception.package) ||
        !Array.isArray(exception.versions) || !exception.versions.length ||
        !exception.versions.every((version) => typeof version === "string" && versionPattern.test(version)) ||
        !nonempty(exception.rationale) || !nonempty(exception.owner) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(exception.expiresAt) ||
        !Number.isFinite(Date.parse(exception.expiresAt)) ||
        new Date(exception.expiresAt).toISOString() !== exception.expiresAt.replace("Z", ".000Z")) {
      throw new Error("Audit exception requires a GHSA ID, package, exact versions, rationale, owner and UTC expiry");
    }
    if (Date.parse(exception.expiresAt) <= now.getTime()) {
      throw new Error(`Expired audit exception: ${exception.advisoryId} (${exception.package})`);
    }
  }
  if (!report?.advisories || typeof report.advisories !== "object" || Array.isArray(report.advisories)) {
    throw new Error("Audit policy requires a validated pnpm advisory report");
  }
  if (report.metadata?.vulnerabilities?.critical > 0) throw new Error("Critical audit findings cannot be excepted");
  const unreviewed = [];
  for (const advisory of Object.values(report.advisories)) {
    if (advisory?.severity === "critical") throw new Error("Critical audit findings cannot be excepted");
    const advisoryId = typeof advisory?.url === "string"
      ? advisory.url.match(/^https:\/\/github\.com\/advisories\/(GHSA-[^/]+)$/)?.[1] : undefined;
    const versions = Array.isArray(advisory?.findings) ? [...new Set(advisory.findings.map((finding) => finding?.version))] : [];
    const reviewed = ghsaPattern.test(advisoryId) && versions.length > 0 && versions.every((version) =>
      typeof version === "string" && versionPattern.test(version) && exceptions.some((exception) =>
        exception.advisoryId === advisoryId && exception.package === advisory.module_name && exception.versions.includes(version)));
    if (!reviewed) unreviewed.push(`${advisoryId ?? "unknown advisory"} ${advisory?.module_name ?? "unknown package"}@${versions.join(",") || "unknown version"}`);
  }
  if (unreviewed.length) throw new Error(`Unreviewed audit findings (manual review required): ${unreviewed.join("; ")}`);
}
