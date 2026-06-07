import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const outputGif = join(root, ".output", "showcase", "wdk-browser-extension-showcase.gif");
const docsGif = join(root, "docs", "showcase.gif");
const specPath = join(root, ".output", "showcase", "showcase-frames.json");
const requiredText = [
  "Create a vault",
  "Multi-network accounts",
  "Send flow",
  "Receive assets",
  "Advanced controls"
];

const output = await stat(outputGif).catch(() => undefined);
if (!output?.isFile() || output.size <= 0) throw new Error(`Showcase GIF missing at ${outputGif}`);
const docs = await stat(docsGif).catch(() => undefined);
if (!docs?.isFile() || docs.size <= 0) throw new Error(`Showcase GIF missing at ${docsGif}`);

const spec = JSON.parse(await readFile(specPath, "utf8").catch(() => "{}"));
const specText = JSON.stringify(spec);
const missing = requiredText.filter((entry) => !specText.includes(entry));
if (missing.length) throw new Error(`Showcase GIF spec is missing scenes: ${missing.join("; ")}`);

const probe = spawnSync("ffmpeg", ["-i", docsGif], { cwd: root, encoding: "utf8" });
const ffmpegOutput = `${probe.stdout ?? ""}
${probe.stderr ?? ""}`;
const durationSeconds = parseDuration(ffmpegOutput);
const dimensions = parseDimensions(ffmpegOutput);

if (durationSeconds < 15 || durationSeconds > 30) {
  throw new Error(`Showcase GIF duration ${durationSeconds}s is outside the expected 15-30 second range`);
}
if (dimensions.width !== 1280 || dimensions.height !== 720) {
  throw new Error(`Showcase GIF dimensions must be 1280x720, got ${dimensions.width}x${dimensions.height}`);
}

console.log(JSON.stringify({
  ok: true,
  docsGif,
  outputGif,
  bytes: docs.size,
  durationSeconds,
  dimensions,
  checkedScenes: requiredText.length
}, null, 2));

function parseDuration(output) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Unable to read showcase GIF duration from ffmpeg output");
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseDimensions(output) {
  const match = output.match(/Video:.*?,\s*(\d{3,5})x(\d{3,5})[,\s]/s);
  if (!match) throw new Error("Unable to read showcase GIF dimensions from ffmpeg output");
  return { width: Number(match[1]), height: Number(match[2]) };
}
