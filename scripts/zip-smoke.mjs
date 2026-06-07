import { stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { EXTENSION_ZIP_NAME } from "./lib/extension-artifact.mjs";

const root = resolve(".");
const zipPath = join(root, ".output", EXTENSION_ZIP_NAME);
const minZipBytes = 100_000;
const requiredExactEntries = [
  "manifest.json",
  "background.js",
  "popup.html",
  "inpage.js",
  "content-scripts/content.js"
];
const requiredEntryPrefixes = [
  "chunks/popup-",
  "assets/popup-"
];

const file = await stat(zipPath).catch(() => undefined);
if (!file?.isFile()) throw new Error(`Extension zip was not found at ${zipPath}`);
if (file.size < minZipBytes) throw new Error(`Extension zip is unexpectedly small: ${file.size} bytes`);

const unzip = spawnSync("unzip", ["-l", zipPath], { cwd: root, encoding: "utf8" });
if (unzip.status !== 0) throw new Error(`Unable to list extension zip:
${unzip.stdout}
${unzip.stderr}`);

const entries = parseEntries(unzip.stdout);
for (const entry of requiredExactEntries) {
  if (!entries.includes(entry)) throw new Error(`Extension zip missing required entry: ${entry}`);
}
for (const prefix of requiredEntryPrefixes) {
  if (!entries.some((entry) => entry.startsWith(prefix))) throw new Error(`Extension zip missing entry with prefix: ${prefix}`);
}
for (const forbiddenPrefix of ["node_modules/", ".git/", ".output/", ".wxt/"]) {
  if (entries.some((entry) => entry.startsWith(forbiddenPrefix))) {
    throw new Error(`Extension zip includes forbidden local/build directory: ${forbiddenPrefix}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  zipPath,
  bytes: file.size,
  entries
}, null, 2));

function parseEntries(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/)?.[1])
    .filter(Boolean);
}
