import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const showcaseDir = join(root, ".output", "showcase");
const popupDir = join(showcaseDir, "popup");
const outputDir = join(root, ".output", "showcase-video");
const frameDir = join(outputDir, "frames");
const specPath = join(outputDir, "showcase-video-scenes.json");
const videoPath = join(outputDir, "wdk-browser-extension-high-quality-showcase.mp4");
const publicVideoPath = join(root, "docs", "showcase-video.mp4");
const secondsPerScene = Number(process.env.SHOWCASE_VIDEO_SECONDS_PER_SCENE ?? "12");

const captures = {
  onboarding: join(popupDir, "01-onboarding.png"),
  accounts: join(popupDir, "02-accounts.png"),
  send: join(popupDir, "03-send.png"),
  review: join(popupDir, "04-review.png"),
  receive: join(popupDir, "05-receive.png"),
  rpc: join(popupDir, "06-rpc.png")
};

await ensurePopupCaptures();
await mkdir(frameDir, { recursive: true });

const scenes = [
  {
    eyebrow: "Why this starter is different",
    title: "A complete WDK browser wallet, not just a README link",
    subtitle: "This high-quality showcase uses actual popup captures and holds each scene long enough for local inspection.",
    bullets: [
      "Chrome and Brave Manifest V3 starter with WXT, React, TypeScript, and Tether WDK.",
      "1920x1080 MP4 output for public demos and project walkthroughs.",
      "The full-size showcase GIF and MP4 can be regenerated from local captures."
    ],
    note: "Primary output: high-quality showcase MP4",
    image: captures.accounts
  },
  {
    eyebrow: "Wallet creation",
    title: "Recovery phrase backup before vault creation",
    subtitle: "The onboarding surface forces the important wallet step into the visible flow instead of hiding it in docs.",
    bullets: [
      "BIP-39 generation/import is validated before storage.",
      "The user confirms the recovery phrase was saved before creating the encrypted vault.",
      "Seed material stays out of page scripts and content scripts."
    ],
    note: "Actual popup capture: onboarding",
    image: captures.onboarding
  },
  {
    eyebrow: "Vault boundary",
    title: "Encrypted local custody with explicit session behavior",
    subtitle: "The wallet is self-custodial while still keeping the page and content bridge away from secrets.",
    bullets: [
      "AES-256-GCM encrypted vault with PBKDF2-SHA256 password derivation.",
      "Ten-minute idle timeout and lock/unlock workflow.",
      "Background owns WDK execution, signing, session, and vault access."
    ],
    note: "Security docs map this boundary",
    image: captures.onboarding
  },
  {
    eyebrow: "Network coverage",
    title: "WDK account derivation across configured networks",
    subtitle: "The starter covers its configured network list with real WDK module registration.",
    bullets: [
      "Bitcoin and Spark through BTC/Spark wallet modules.",
      "Ethereum, Polygon, Arbitrum, and Plasma through the EVM wallet module.",
      "Solana through the Solana wallet module, with BTC, USDt, and XAUt mappings documented."
    ],
    note: "Actual popup capture: accounts",
    image: captures.accounts
  },
  {
    eyebrow: "Account UX",
    title: "Multi-account wallet view that users can inspect",
    subtitle: "The popup shows chain/account context instead of treating the extension as a backend-only implementation.",
    bullets: [
      "Account records include wallet, chain, index, address, and derivation path.",
      "The UI supports additional accounts and wallet switching.",
      "Balances and account surfaces are isolated to extension UI state."
    ],
    note: "Actual popup capture: accounts",
    image: captures.accounts
  },
  {
    eyebrow: "Send flow",
    title: "Manual recipient entry with network-safe validation",
    subtitle: "The send screen demonstrates the parts users expect from a wallet starter.",
    bullets: [
      "Network, asset, account, recipient, and amount are explicit.",
      "Address validation happens before the confirmation step.",
      "QR recipient scanning is included for the manual demo flow."
    ],
    note: "Actual popup capture: send",
    image: captures.send
  },
  {
    eyebrow: "Transaction approval",
    title: "Two-step confirmation before WDK execution",
    subtitle: "The user sees the transaction intent before the background controller calls WDK send/transfer APIs.",
    bullets: [
      "Recipient, amount, network, and asset are surfaced before broadcast.",
      "The background validates the request again before execution.",
      "Transaction records are persisted for Activity/status review."
    ],
    note: "Actual popup capture: review",
    image: captures.review
  },
  {
    eyebrow: "Receive flow",
    title: "Per-account receive QR and copy-ready addresses",
    subtitle: "The receive surface gives users a concrete wallet flow, not just chain configuration.",
    bullets: [
      "The selected account address is rendered as a QR code.",
      "Copy actions are kept inside the extension UI.",
      "The page context never sees seed phrase or private-key material."
    ],
    note: "Actual popup capture: receive",
    image: captures.receive
  },
  {
    eyebrow: "Dapp bridge",
    title: "Origin-scoped provider approval for dapps",
    subtitle: "The wallet exposes a browser-provider path while keeping account exposure and signing gated by the popup.",
    bullets: [
      "EIP-6963 announcement plus EIP-1193 methods for local dapp testing.",
      "eth_accounts returns [] before approval, while locked, or after revocation.",
      "personal_sign and dapp transactions require explicit pending approval."
    ],
    note: "Test dapp flow covered by smoke:chrome:dapp",
    image: captures.rpc
  },
  {
    eyebrow: "Developer controls",
    title: "RPC and dapp testing tools are visible",
    subtitle: "The starter includes the pieces developers need to validate network and provider behavior locally.",
    bullets: [
      "RPC override surface for controlled local environments.",
      "Manifest smoke verifies CSP, service worker, inpage script, and permissions.",
      "Browser matrix reporting covers Chrome for Testing and headed Chrome/Brave paths."
    ],
    note: "Actual popup capture: RPC controls",
    image: captures.rpc
  },
  {
    eyebrow: "Verification gate",
    title: "Build-backed showcase, not a static mockup",
    subtitle: "The generated walkthroughs are tied to build output and smoke checks instead of hand-maintained screenshots.",
    bullets: [
      "verify:ci covers lint, typecheck, unit tests, WDK derivation smoke, zip smoke, and manifest checks.",
      "Browser matrix reporting records Chrome for Testing and optional branded-browser observations.",
      "Browser smoke checks validate provider injection and dapp approval flows."
    ],
    note: "Build-backed delivery",
    image: captures.accounts
  },
  {
    eyebrow: "Supply-chain hygiene",
    title: "Pinned pnpm delivery with dependency review hooks",
    subtitle: "The project uses stricter dependency hygiene than an npm-range starter package.",
    bullets: [
      "Exact dependency pins, pnpm 11.0.9, minimum release age, trust policy, and WDK baseline override.",
      "Lockfile smoke, resolved lockfile review, production audit smoke, and WDK dependency alignment.",
      "Weekly audit and dependency PR gates are documented for maintainers."
    ],
    note: "Security review surface included",
    image: captures.rpc
  }
];

await writeFile(specPath, `${JSON.stringify({ secondsPerScene, scenes }, null, 2)}\n`);
run("python3", ["scripts/render-showcase-video-frames.py", specPath, frameDir]);

const ffmpeg = spawnSync("ffmpeg", [
  "-y",
  "-framerate",
  `1/${secondsPerScene}`,
  "-i",
  join(frameDir, "frame-%02d.png"),
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
  "-vf",
  "format=yuv420p",
  "-movflags",
  "+faststart",
  videoPath
], { cwd: root, encoding: "utf8" });
if (ffmpeg.status !== 0) {
  throw new Error(`ffmpeg showcase video encode failed:\n${ffmpeg.stderr}`);
}
await copyFile(videoPath, publicVideoPath);

const smoke = runJson("node", ["scripts/showcase-video-smoke.mjs"]);
console.log(JSON.stringify({
  ok: true,
  videoPath,
  publicVideoPath,
  specPath,
  scenes: scenes.length,
  secondsPerScene,
  calculatedDurationSeconds: scenes.length * secondsPerScene,
  smoke
}, null, 2));

async function ensurePopupCaptures() {
  const missing = [];
  for (const file of Object.values(captures)) {
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) missing.push(file);
  }
  if (!missing.length) return;
  run("pnpm", ["run", "demo:gif"]);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function runJson(command, args) {
  const result = run(command, args);
  const output = result.stdout.trim();
  if (!output) return { ok: true };
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { ok: true, output };
  return JSON.parse(output.slice(start, end + 1));
}
