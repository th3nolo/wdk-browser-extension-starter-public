import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const videoPath = join(root, ".output", "showcase-video", "wdk-browser-extension-high-quality-showcase.mp4");
const publicVideoPath = join(root, "docs", "showcase-video.mp4");
const specPath = join(root, ".output", "showcase-video", "showcase-video-scenes.json");
const requiredText = [
  "1920x1080 MP4 output",
  "actual popup captures",
  "Origin-scoped provider approval",
  "Pinned pnpm delivery",
  "Build-backed showcase, not a static mockup"
];
const minDurationSeconds = 120;
const maxDurationSeconds = 300;

const file = await stat(videoPath).catch(() => undefined);
if (!file?.isFile()) throw new Error(`High-quality showcase video was not found at ${videoPath}`);
if (file.size <= 0) throw new Error("High-quality showcase video is empty");
const publicFile = await stat(publicVideoPath).catch(() => undefined);
if (!publicFile?.isFile()) throw new Error(`Public showcase video was not found at ${publicVideoPath}`);
if (publicFile.size !== file.size) throw new Error("Public showcase video does not match the generated output size");

const spec = JSON.parse(await readFile(specPath, "utf8").catch(() => "{}"));
if (!Array.isArray(spec.scenes) || spec.scenes.length < 10) {
  throw new Error("High-quality showcase video requires at least 10 viewer-readable scenes");
}
const specText = JSON.stringify(spec);
const missing = requiredText.filter((snippet) => !specText.includes(snippet));
if (missing.length) throw new Error(`High-quality showcase spec is missing required text: ${missing.join("; ")}`);

const probe = spawnSync("ffmpeg", ["-i", videoPath], { cwd: root, encoding: "utf8" });
const output = `${probe.stdout ?? ""}
${probe.stderr ?? ""}`;
const durationSeconds = parseDuration(output);
const dimensions = parseDimensions(output);

if (durationSeconds < minDurationSeconds || durationSeconds > maxDurationSeconds) {
  throw new Error(`High-quality showcase video duration ${durationSeconds}s is outside the required 2-5 minute range`);
}
if (dimensions.width !== 1920 || dimensions.height !== 1080) {
  throw new Error(`High-quality showcase video dimensions must be 1920x1080, got ${dimensions.width}x${dimensions.height}`);
}

console.log(JSON.stringify({
  ok: true,
  videoPath,
  publicVideoPath,
  bytes: file.size,
  durationSeconds,
  durationRangeSeconds: [minDurationSeconds, maxDurationSeconds],
  dimensions,
  scenes: spec.scenes.length,
  secondsPerScene: spec.secondsPerScene
}, null, 2));

function parseDuration(output) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Unable to read high-quality showcase video duration from ffmpeg output");
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseDimensions(output) {
  const match = output.match(/Video:.*?,\s*(\d{3,5})x(\d{3,5})[,\s]/s);
  if (!match) throw new Error("Unable to read high-quality showcase video dimensions from ffmpeg output");
  return { width: Number(match[1]), height: Number(match[2]) };
}
