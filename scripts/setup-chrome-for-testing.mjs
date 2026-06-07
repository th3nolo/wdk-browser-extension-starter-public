import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const args = new Set(process.argv.slice(2));
const platform = process.env.CHROME_FOR_TESTING_PLATFORM ?? "linux64";
const manifestPath = resolve(process.env.CHROME_FOR_TESTING_MANIFEST ?? join(root, "scripts", "chrome-for-testing-manifest.json"));
const outputRoot = resolve(process.env.CHROME_FOR_TESTING_DIR ?? join(root, ".output", "chrome-for-testing"));
const binaryPath = join(outputRoot, `chrome-${platform}`, platform === "win64" ? "chrome.exe" : "chrome");
const versionPath = join(outputRoot, "VERSION");
const force = args.has("--force");
const dryRun = args.has("--dry-run");
const now = new Date(process.env.CHROME_FOR_TESTING_NOW ?? Date.now());

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const pin = selectPinnedBrowser(manifest, platform, process.env.CHROME_FOR_TESTING_VERSION);
assertPinIsInstallable(pin, manifest.minimumAvailabilityHours, now);
const zipPath = join(outputRoot, basename(new URL(pin.download.url).pathname));

if (existsSync(binaryPath) && !force) {
  await assertExistingInstall(pin, zipPath, versionPath);
  console.log(JSON.stringify({ ok: true, reused: true, browser: manifest.browser, version: pin.version, revision: pin.revision, platform, binaryPath }, null, 2));
  process.exit(0);
}

if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, browser: manifest.browser, version: pin.version, revision: pin.revision, platform, url: pin.download.url }, null, 2));
  process.exit(0);
}

await mkdir(outputRoot, { recursive: true });
await downloadFile(pin.download.url, zipPath);
await assertSha256(zipPath, pin.download.sha256);

await rm(join(outputRoot, `chrome-${platform}`), { recursive: true, force: true });
const unzip = spawnSync("unzip", ["-q", "-o", zipPath, "-d", outputRoot], { encoding: "utf8" });
if (unzip.status !== 0) throw new Error(`Unable to unzip Chrome for Testing. stderr: ${unzip.stderr}`);
if (!existsSync(binaryPath)) throw new Error(`Chrome for Testing binary was not created at ${binaryPath}`);

await writeFile(versionPath, `${pin.version}
`);

console.log(JSON.stringify({
  ok: true,
  reused: false,
  browser: manifest.browser,
  version: pin.version,
  revision: pin.revision,
  platform,
  binaryPath
}, null, 2));

function selectPinnedBrowser(manifest, selectedPlatform, selectedVersion) {
  const versions = Array.isArray(manifest.versions) ? manifest.versions : [];
  const candidates = selectedVersion ? versions.filter((entry) => entry.version === selectedVersion) : versions;
  for (const entry of candidates) {
    const download = entry.platforms?.[selectedPlatform];
    if (!download) continue;
    if (!download.url) throw new Error(`Pinned Chrome for Testing ${entry.version} is missing a ${selectedPlatform} URL`);
    if (!/^[a-f0-9]{64}$/i.test(download.sha256 ?? "")) {
      throw new Error(`Pinned Chrome for Testing ${entry.version} ${selectedPlatform} is missing a SHA-256 checksum`);
    }
    return { ...entry, download };
  }
  const versionText = selectedVersion ? ` version '${selectedVersion}'` : "";
  throw new Error(`No pinned Chrome for Testing${versionText} is configured for platform '${selectedPlatform}'`);
}

function assertPinIsInstallable(pin, minimumAvailabilityHours, now) {
  if (!pin.version || !pin.revision) throw new Error("Pinned Chrome for Testing entry must include version and revision");
  if (!pin.availableAt) throw new Error(`Pinned Chrome for Testing ${pin.version} is missing availableAt`);
  const availableAt = new Date(pin.availableAt);
  if (Number.isNaN(availableAt.getTime())) throw new Error(`Pinned Chrome for Testing ${pin.version} has an invalid availableAt timestamp`);
  const minimumMs = Number(minimumAvailabilityHours ?? 72) * 60 * 60 * 1000;
  const ageMs = now.getTime() - availableAt.getTime();
  if (ageMs < minimumMs) {
    const eligibleAt = new Date(availableAt.getTime() + minimumMs).toISOString();
    throw new Error(`Pinned Chrome for Testing ${pin.version} is too new for dependency policy; eligible after ${eligibleAt}`);
  }
}

async function assertExistingInstall(pin, zipPath, versionPath) {
  const installedVersion = await readFile(versionPath, "utf8").then((value) => value.trim()).catch(() => "");
  if (installedVersion !== pin.version) {
    throw new Error(`Existing Chrome for Testing install is ${installedVersion || "unknown"}, expected pinned ${pin.version}. Re-run with --force.`);
  }
  if (!existsSync(zipPath)) {
    throw new Error(`Existing Chrome for Testing install cannot be verified because ${zipPath} is missing. Re-run with --force.`);
  }
  await assertSha256(zipPath, pin.download.sha256);
}

async function assertSha256(path, expected) {
  const actual = await sha256File(path);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, got ${actual}`);
}

function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", rejectHash)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
}

function downloadFile(url, path) {
  return new Promise((resolveDownload, rejectDownload) => {
    get(url, (response) => {
      if (isRedirect(response.statusCode) && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), path).then(resolveDownload, rejectDownload);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`Download failed for ${url}: HTTP ${response.statusCode}`));
        return;
      }
      const file = createWriteStream(path, { mode: 0o755 });
      response.pipe(file);
      file.on("finish", () => file.close(resolveDownload));
      file.on("error", rejectDownload);
    }).on("error", rejectDownload);
  });
}

function isRedirect(statusCode) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}
