# Store Listing Maintainer Kit

Everything needed to publish the extension to the Chrome Web Store (CWS) and the
Brave/Edge stores. Copy the fields below into the developer dashboard. The packaged
artifact is `.output/wdk-browser-extension-starter-<version>-chrome.zip`
(`pnpm run zip`).

> ⚠️ **Crypto-wallet policy.** Google applies extra scrutiny to wallets/financial
> extensions. Keep the single-purpose statement tight, disclose that no user data is
> collected, and expect a longer review. A **privacy policy URL is required** — host
> `docs/PRIVACY.md` (or a page on the showcase site) and paste the URL in the
> Privacy tab.

## Identity

| Field | Value |
| --- | --- |
| Product name (≤45) | `WDK Browser Wallet Starter` |
| Summary / short description (≤132) | `Self-custodial Chrome/Brave wallet starter powered by Tether WDK. Your keys stay encrypted on your device — the page never sees them.` |
| Category | Developer Tools |
| Language | English |
| Icon | 128×128 (already in the build: `public/` → manifest `icons`) |

## Detailed description (paste into "Description")

```
WDK Browser Wallet Starter is an open-source (MIT), self-custodial wallet
reference implementation for Chrome and Brave, built on the Tether Wallet
Development Kit (WDK).

KEYS NEVER LEAVE YOUR DEVICE
• Your seed phrase and private keys are encrypted with AES-256-GCM (PBKDF2-SHA256)
  and stored only in your browser's local extension storage.
• Signing happens in an isolated background context. Web pages and dApps never
  receive seed or private-key material — only the addresses you explicitly share.

MULTI-CHAIN, MULTI-ACCOUNT
• Bitcoin, Ethereum, Polygon, Arbitrum, Plasma, Solana, and Spark (Lightning).
• BIP-39 seed generation, import, and validation with a create-time backup step.
• Multiple accounts per wallet, with balances grouped by asset across chains.

dApp CONNECTIONS YOU CONTROL
• EIP-1193 / EIP-6963 provider with origin-scoped approvals — each site only sees
  the accounts you grant it.
• Decoded transaction and signature review (what-you-see-is-what-you-sign) before
  anything is signed.

WHITE-LABEL BY DESIGN
• 12 built-in themes and a live skin selector. The UI is fully separated from the
  wallet engine, so a team can completely rebrand the look without touching the
  vault, signing, or dApp logic.

This is a reference/starter implementation. Review the source before using it with
real funds: https://github.com/th3nolo/wdk-browser-extension-starter
Showcase URL: [replace with verified public showcase URL]
```

## Single-purpose statement (paste into "Single purpose")

```
A self-custodial cryptocurrency wallet: it generates and encrypts keys locally,
displays balances, and lets the user review and approve transactions and dApp
connection requests.
```

## Permission justifications (paste into "Privacy practices" → per-permission)

| Permission | Justification to paste |
| --- | --- |
| `storage` | Stores the AES-256-GCM-encrypted vault and user settings locally in the browser. No data is sent anywhere. |
| `alarms` | Drives the auto-lock session timer so the wallet re-locks after a period of inactivity. |
| Host permissions (RPC/explorer hosts) | The wallet reads balances and broadcasts user-initiated transactions directly to the public blockchain RPC/explorer endpoints listed in the manifest (Bitcoin, Ethereum, Polygon, Arbitrum, Plasma, Solana, Spark/Lightning). It does **not** use a broad `<all_urls>` permission. |

> The manifest requests only `storage` + `alarms` and a **fixed allow-list** of RPC
> hosts — no `<all_urls>`, no `tabs`, no `webRequest`. The CSP restricts `connect-src`
> to the same hosts. Emphasize this minimalism in review.

## Data-use disclosures (Privacy tab checkboxes)

- **Does this item collect user data?** → The extension does **not** transmit user
  data to the developer or any third party. Keys and settings stay in local browser
  storage; network calls go only to public blockchain RPC endpoints to fetch balances
  and broadcast transactions the user initiates.
- Do **not** check any "sells data / uses data for purposes unrelated to core
  functionality / creditworthiness" boxes.
- Certify compliance with the Developer Program Policies.

## Screenshots & promo assets

CWS requires 1–5 screenshots at **1280×800** or **640×400** (PNG/JPEG).
Framed 1280×800 examples are committed in [`store-assets/`](store-assets/)
(`store-<skin>-1280x800.png`), generated from `.output/theme-shots/<skin>.png` with
`ffmpeg` (centered popup on a `#0b0b12` backdrop).

Before submitting, regenerate screenshots with a production-safe wallet name and include the two flow screens below. Avoid screenshots that expose local test wallet labels, faucet state, or unpublished URLs.

Recommended set (frame the best onto 1280×800):

1. `evolved.png` — default dark wallet (Tokens screen)
2. `arctic.png` — light theme (shows theming range)
3. `aurum.png` — rail-nav skin (sidebar layout)
4. A dApp connection approval (origin-scoped, account checkboxes)
5. The decoded transaction review (WYSIWYS)

Optional promo tiles: small **440×280**, marquee **1400×560**. The showcase site's
hero/design-system pages are good source material.

## Pre-submit checklist

- [ ] `pnpm run verify:secrets:history` clean (full git-history secret scan before making the repo public)
- [ ] `pnpm run verify:ci` green
- [ ] `pnpm run zip` → `.output/wdk-browser-extension-starter-<version>-chrome.zip`
- [ ] Privacy policy hosted; URL ready for the Privacy tab
- [ ] Screenshots framed to 1280×800
- [ ] Single-purpose + permission justifications pasted
- [ ] Data-use disclosures answered (no data collected)
- [ ] Tested via "Load unpacked" on `.output/chrome-mv3` in a clean profile

## Brave / Edge

- **Brave** uses the Chrome Web Store listing directly, so no separate listing flow is needed.
- **Edge** Add-ons accepts the same MV3 zip via Partner Center (separate account).
