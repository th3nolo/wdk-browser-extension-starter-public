import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function createBrowserContext({ root, browserName, browserPath }) {
  const extensionPath = join(root, ".output", "chrome-mv3");
  const isWindowsBrowser = browserPath.endsWith(".exe");
  const profileRoot = isWindowsBrowser ? windowsTempDir() : "/tmp";
  const userDataDir = await mkdtemp(join(profileRoot, `wdk-${browserName}-profile-`));
  const extensionLoadPath = isWindowsBrowser
    ? await copyExtensionForWindowsBrowser(extensionPath, userDataDir)
    : extensionPath;
  const browserExtensionPath = isWindowsBrowser ? toWindowsPath(extensionLoadPath) : extensionLoadPath;
  const browserUserDataDir = isWindowsBrowser ? toWindowsPath(userDataDir) : userDataDir;

  return {
    browserExtensionPath,
    browserUserDataDir,
    extensionLoadPath,
    extensionPath,
    isWindowsBrowser,
    userDataDir
  };
}

export async function runBrowser(path, args, tempDir, timeout) {
  if (!path.endsWith(".exe")) return runDirectBrowser(path, args, timeout);

  const stdoutPath = join(tempDir, "browser-stdout.txt");
  const stderrPath = join(tempDir, "browser-stderr.txt");
  const command = [
    `$p = Start-Process -FilePath ${psQuote(toWindowsPath(path))}`,
    `-ArgumentList ${psQuote(args.map(windowsArg).join(" "))}`,
    `-RedirectStandardOutput ${psQuote(toWindowsPath(stdoutPath))}`,
    `-RedirectStandardError ${psQuote(toWindowsPath(stderrPath))}`,
    "-NoNewWindow -PassThru;",
    `$deadline = (Get-Date).AddMilliseconds(${timeout});`,
    "while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 };",
    "if (-not $p.HasExited) { Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; exit 124 };",
    "exit $p.ExitCode"
  ].join(" ");
  const runner = spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] });
  let powershellStdout = "";
  let powershellStderr = "";
  runner.stdout.on("data", chunk => { powershellStdout += chunk.toString(); });
  runner.stderr.on("data", chunk => { powershellStderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => runner.on("exit", resolveExit));
  const stdout = await readFile(stdoutPath, "utf8").catch(() => powershellStdout);
  const stderr = [await readFile(stderrPath, "utf8").catch(() => ""), powershellStderr].filter(Boolean).join("\n");
  return { code, stdout, stderr, timedOut: code === 124 };
}

export async function launchCdpBrowser(path, args) {
  if (!path.endsWith(".exe")) {
    const browser = spawn(path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    browser.stderr.on("data", chunk => { stderr += chunk.toString(); });
    return {
      kill: async () => {
        if (!browser.killed) browser.kill("SIGKILL");
      },
      stderr: () => stderr
    };
  }

  const command = [
    `$p = Start-Process -FilePath ${psQuote(toWindowsPath(path))}`,
    `-ArgumentList ${psQuote(args.map(windowsArg).join(" "))}`,
    "-PassThru;",
    "Write-Output $p.Id"
  ].join(" ");
  const runner = spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  runner.stdout.on("data", chunk => { stdout += chunk.toString(); });
  runner.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => runner.on("exit", resolveExit));
  if (code !== 0) throw new Error(`Unable to launch browser for CDP smoke. stderr: ${stderr}`);
  const pid = Number(stdout.trim().split(/\s+/).at(-1));
  if (!Number.isFinite(pid)) throw new Error(`Unable to parse browser process id from '${stdout.trim()}'`);
  return {
    kill: async () => {
      const killCommand = [
        `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };`,
        `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
      ].join(" ");
      await new Promise((resolveExit) => {
        spawn("powershell.exe", ["-NoProfile", "-Command", killCommand], { stdio: "ignore" }).on("exit", resolveExit);
      });
    },
    stderr: () => stderr
  };
}

export function detectBrowser(root, name) {
  const chromeForTestingPath = join(root, ".output", "chrome-for-testing", "chrome-linux64", "chrome");
  const candidates = {
    cft: [
      chromeForTestingPath,
      "/opt/chrome-for-testing/chrome-linux64/chrome",
      "chrome-for-testing",
      "chromium",
      "chromium-browser"
    ],
    chromium: [
      chromeForTestingPath,
      "/opt/chrome-for-testing/chrome-linux64/chrome",
      "chromium",
      "chromium-browser"
    ],
    chrome: [
      "google-chrome-stable",
      "google-chrome",
      "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
      "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "chromium",
      "chromium-browser"
    ],
    brave: [
      "/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      "/mnt/c/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe",
      "brave-browser",
      "brave"
    ],
    edge: [
      "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
      "msedge",
      "microsoft-edge"
    ]
  }[name];
  if (!candidates) throw new Error(`Unsupported browser '${name}'. Use cft, chromium, chrome, brave, or edge.`);
  for (const candidate of candidates) {
    if (existsSync(candidate) || commandExists(candidate)) return candidate;
  }
  if (name === "cft" || name === "chromium") {
    throw new Error(`Unable to find ${name}. Run pnpm run setup:browser or set BROWSER_PATH to a Chrome for Testing/Chromium executable.`);
  }
  throw new Error(`Unable to find ${name}. Set BROWSER_PATH or CHROME_PATH to a Chromium-compatible browser executable.`);
}

export function windowsHostIp() {
  const resolvConf = readFileSync("/etc/resolv.conf", "utf8");
  return resolvConf.match(/^nameserver\s+(\S+)/m)?.[1] ?? "127.0.0.1";
}

export function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'");
}

function runDirectBrowser(path, args, timeout) {
  const browser = spawn(path, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  browser.stdout.on("data", chunk => { stdout += chunk.toString(); });
  browser.stderr.on("data", chunk => { stderr += chunk.toString(); });
  return new Promise((resolveExit) => {
    const timeoutId = setTimeout(() => browser.kill("SIGKILL"), timeout);
    browser.on("exit", code => {
      clearTimeout(timeoutId);
      resolveExit({ code: code ?? 124, stdout, stderr, timedOut: code === null });
    });
  });
}

function commandExists(command) {
  if (command.includes("/")) return false;
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function copyExtensionForWindowsBrowser(extensionPath, userDataDir) {
  const target = join(userDataDir, "extension");
  await cp(extensionPath, target, { recursive: true, force: true });
  return target;
}

function windowsTempDir() {
  const windowsTemp = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[IO.Path]::GetTempPath()"], { encoding: "utf8" }).trim();
  return execFileSync("wslpath", ["-u", windowsTemp], { encoding: "utf8" }).trim();
}

function toWindowsPath(path) {
  return execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function windowsArg(value) {
  return `"${value.replaceAll('"', '\\"')}"`;
}
