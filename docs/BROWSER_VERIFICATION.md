# Browser Verification

This starter targets Chrome and Brave through the shared Chromium Manifest V3 extension model. Automated CLI verification uses Chrome for Testing because official Chrome-branded builds removed command-line unpacked-extension loading in Chrome 137+, while Chrome for Testing keeps that development workflow available.

## Browser Setup

```bash
pnpm run setup:browser
```

This installs the pinned Chrome for Testing build from `scripts/chrome-for-testing-manifest.json` into the ignored `.output/chrome-for-testing/` directory. The script verifies SHA-256 and enforces the 72-hour dependency-age rule before download or reuse. Set `CHROME_FOR_TESTING_DIR` to use a different cache location, or set `BROWSER_PATH` to an existing Chrome for Testing or Chromium executable. For the complete Linux/WSL command sequence, see `docs/WSL_TESTING.md`.

## Automated Chromium-Family Smoke

```bash
pnpm run smoke:chrome
# equivalent alias:
pnpm run smoke:chromium
```

This command launches Chrome for Testing with a temporary profile, loads the unpacked `.output/chrome-mv3` extension, opens `test-dapp.html`, and verifies provider injection through Chrome DevTools Protocol. The smoke checks `window.ethereum.isWDKWallet`, the EIP-6963 announcement, and the connect/sign controls used by the local dApp fixture.

For deeper dApp-flow automation, run:

```bash
pnpm run smoke:chrome:dapp
```

That variant opens the test dApp through a mapped non-local host, creates a temporary wallet in the extension popup, installs a provider-method recorder on the dApp page, approves `eth_requestAccounts`, verifies provider events reach the dApp without broad tab discovery permissions, verifies the read-only EVM RPC proxy methods through intercepted service-worker RPC, approves a `personal_sign` request, confirms unsafe dApp transaction gas overrides are rejected before approval, approves decoded ERC-20, swap, Aave, bridge, and Safe transaction requests after RPC preflight, and approves a native dApp transaction.

## Browser Matrix Report

```bash
pnpm run report:browsers
```

This writes `.output/browser-verification.json` with the current local outcome for Chrome for Testing, branded Chrome, and Brave using the same provider-injection smoke runner. The report requires the deterministic Chrome for Testing check to pass and records branded Chrome/Brave as environment-specific observations. Set `BROWSER_MATRIX_TIMEOUT_MS` to adjust the per-browser timeout, or set `BROWSER_MATRIX` and `BROWSER_MATRIX_REQUIRED` to override the matrix.

## Explicit Chrome and Brave Smoke Commands

```bash
pnpm run smoke:chrome:real
pnpm run smoke:brave
```

These commands select Google Chrome or Brave directly. They are intentionally separate from the required automated gate because branded browser builds may block or vary command-line unpacked-extension behavior. Set `BROWSER_PATH` or `CHROME_PATH` if the browser is installed in a non-standard location.

## Headed CDP Smoke Commands

```bash
pnpm run smoke:chrome:headed
pnpm run smoke:chrome:real:headed
pnpm run smoke:brave:headed
```

The headed CDP commands open a visible browser window with a temporary profile, load `.output/chrome-mv3`, and inspect `test-dapp.html` through Chrome DevTools Protocol. `smoke:chrome:headed` uses Chrome for Testing; the `:real:` and Brave variants are optional final-machine checks.

Before publishing or sharing a build, also run a manual Chrome and Brave load check from `.output/chrome-mv3`:

1. Run `pnpm run build`.
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Load unpacked `.output/chrome-mv3`.
5. Confirm the popup opens.
6. Serve `test-dapp.html` and confirm provider discovery, connection approval, account read, signature approval, and revocation.

Do not treat a branded-browser headless failure as a manual extension-loading failure; it is a limitation of command-line/headless extension loading on that local browser build.
