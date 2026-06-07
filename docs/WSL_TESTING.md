# Linux and WSL Testing

This project can be tested from a Linux shell or WSL without driving a Windows browser. Use the Linux/WSL toolchain end to end for automated checks, and reserve branded Chrome/Brave manual loading for a final human install check.

## Prerequisites

- Ubuntu or another Linux distribution with a working shell. WSL2 on Windows is supported.
- Node 22 from the repository `.nvmrc`.
- pnpm 11.0.9, matching `packageManager` in `package.json`.
- `unzip`, used by `pnpm run setup:browser` to unpack Chrome for Testing.
- Network access for the first pinned Chrome for Testing download and for normal dependency installation.

Do not use Windows Chrome or Windows Edge from WSL for the automated extension smoke. Cross-OS browser launches can hit Windows profile locking, path translation, and Chrome DevTools Protocol networking issues. The deterministic CLI path is Linux Chrome for Testing or Linux Chromium.

## First-Time Setup

```bash
nvm use
pnpm install
pnpm run setup:browser
```

`pnpm run setup:browser` installs the pinned Chrome for Testing build from `scripts/chrome-for-testing-manifest.json` into `.output/chrome-for-testing/`, which is intentionally ignored by git. The setup script verifies the pinned SHA-256 checksum and fails closed until the pinned version has been publicly available for the configured 72-hour minimum. To use a shared cache, set `CHROME_FOR_TESTING_DIR=/path/to/cache`. To use an already installed automation-capable browser, set `BROWSER_PATH=/path/to/chrome`.

## Fast Local Checks

Run these before working on browser-specific behavior:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run smoke:manifest
```

These checks do not require a desktop browser window. They validate TypeScript, unit behavior, and Manifest V3 shape.

## Automated Extension Runtime Smoke

Build the extension and run the Chrome for Testing smoke:

```bash
pnpm run build
pnpm run smoke:chrome
```

Expected result: JSON with `"ok": true`, `"browser": "cft"`, `"providerInjected": true`, and at least one EIP-6963 announcement for `io.tether.wdk.browser-starter`.

The same automation target is available as:

```bash
pnpm run smoke:chromium
```

## Browser Matrix

```bash
pnpm run report:browsers
```

Expected result: `.output/browser-verification.json` has `"ok": true` and `"requiredBrowser": "cft"`. Branded Chrome and Brave entries may fail or time out in WSL because those browser builds are optional environment observations, not the deterministic CLI gate.

## Full Local Gate

```bash
pnpm run verify:ci
```

This gate runs lint, typecheck, tests, package creation, WDK derivation and surface checks, lockfile checks, manifest checks, audit checks, and whitespace checks. Browser-specific smoke tests and generated demos are optional checks you can run when the local environment supports them.

## Headed and Manual Checks

If WSLg or a Linux desktop session is available, this opens Chrome for Testing visibly and inspects the page through CDP:

```bash
pnpm run smoke:chrome:headed
```

For final Chrome and Brave confidence, load the built extension manually in the actual browser:

1. Run `pnpm run build`.
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Load unpacked `.output/chrome-mv3`.
5. Confirm the popup opens.
6. Serve `test-dapp.html` and confirm provider discovery, connection approval, account read, signature approval, and revocation.

## Troubleshooting

If `pnpm run smoke:chrome` cannot find a browser, run `pnpm run setup:browser` again or set `BROWSER_PATH` to a Linux Chrome for Testing or Chromium executable. If setup reports that the pinned browser is too new, wait until the eligible timestamp or update `scripts/chrome-for-testing-manifest.json` to a reviewable older pin with a matching checksum.

If branded Chrome fails while Chrome for Testing passes, keep the Chrome for Testing result as the automated signal. Official Chrome-branded builds removed command-line unpacked-extension loading in Chrome 137+, so branded-browser CLI failures are not equivalent to manual install failures.

If a smoke leaves temporary profile directories behind after an interrupted run, remove only generated `wdk-*-profile-*` directories from `/tmp` or the Windows temp directory. Do not remove `.output/chrome-mv3` or `.output/chrome-for-testing` unless you intend to regenerate them.
