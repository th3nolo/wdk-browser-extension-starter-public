// Single source of truth for the extension version + packaged zip name, derived
// from package.json. Bumping `version` in package.json is now the ONLY edit a
// version bump needs — wxt derives the manifest version from package.json, and
// every script computes the zip name from here.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export const EXTENSION_NAME = pkg.name;
export const EXTENSION_VERSION = pkg.version;
/** Matches the `wxt zip` output: <name>-<version>-chrome.zip */
export const EXTENSION_ZIP_NAME = `${pkg.name}-${pkg.version}-chrome.zip`;
