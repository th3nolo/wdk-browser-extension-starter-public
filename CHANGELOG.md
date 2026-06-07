# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/). `package.json` `version` is the single
source of truth — the MV3 manifest and the `*-chrome.zip` artifact name both derive
from it.

## [0.2.4] — 2026-06-07
### Changed
- Renamed old signing and RPC labels to verification details/data so wallet
  confirmations read like product UI.
- Removed tool-specific workspace metadata from the tracked public tree.

## [0.2.3] — 2026-06-07
### Fixed
- Pending dApp approval outcomes are validated before delivery from
  `browser.storage.session`, so malformed session data is ignored instead of being
  handed to approval consumers.
### Changed
- Public documentation, package scripts, generated showcase wording, and repository
  metadata now focus on developer use of the WDK starter instead of packaging
  workflows.
- Removed optional demo/live-testnet helper scripts from the tracked public command
  surface while preserving the current user-facing showcase GIF and MP4 generator.

## [0.2.2] — 2026-06-04
### Fixed
- **Rail navigation** (`aurum`, `terminal` skins) rendered as a stranded strip at the
  bottom of the popup instead of a sidebar. The shell is now a `[64px rail | content]`
  grid for `data-nav="rail"`, so the rail is a proper full-height left sidebar.
### Changed
- `verify:themes` captures each skin at the real 600px popup viewport instead of the
  full scroll height, so the screenshots reflect what users actually see (the pinned
  bottom nav and the shell-relative pill/rail navs are no longer stranded in captures).

## [0.2.1] — 2026-06-03
### Fixed
- The Tokens hero counted every supported asset/chain pair ("11 assets held") and
  flashed "0" while loading. It now counts only non-zero holdings ("1 asset held")
  and shows "Loading balances…" during the initial fetch.
### Changed
- Decluttered the Tokens tab: zero-balance tokens are hidden behind a "Show all N
  tokens" toggle, and the per-chain Accounts list is collapsed by default (kept in
  the DOM so address tooling and tests keep working).

## [0.2.0] — 2026-06-02
### Added
- **White-label theme engine**, live. The UI renders entirely from a semantic token
  contract; 12 ready-made skins (3 Base + 9 Brand) are driven by one engine.
- **Settings → Appearance** skin selector — applied live and persisted client-side.
- Bundled self-hosted fonts (`@fontsource`, CSP-safe) and real coin icons.
- `verify:themes` — per-skin render + control-reachability verification with a
  screenshot per skin.
- Open-source **showcase site** (`website/`) plus a GitHub Pages workflow, and the
  theme-engine module (`src/ui/theme`).
### Notes
- Strictly UI-layer: the headless core (`src/lib`), the SDK (`src/sdk`), and the
  background controller are untouched. Swapping a skin fully rebrands the wallet —
  the white-label boundary holds (ESLint-enforced, real-UI smoke green).

## [0.1.x] — White-label containerization & UX
### Added
- Three-layer architecture: headless **core** (`src/lib`), typed **SDK** (`src/sdk`),
  swappable **UI** (`src/ui`); the lib↔ui boundary is ESLint-enforced.
- Real-UI extension smoke (`verify:extension:ui`) that drives the actual popup DOM and
  clicks the real Connect button.
- Add-account confirmation, a dedicated jsQR scanner window, faster unlock, and a
  single-source version pipeline.
- Grouped multi-chain balances, multi-account dApp scoping, and a dark redesign.
### Fixed
- dApp connect now resolves on approval (EIP-1102), Solana public-RPC 403s, and the
  WSL stale-build trap (`verify:extension` / `--sync`).

## [0.1.0] — Initial reference implementation
- Manifest V3 Chrome/Brave wallet built with WXT + React + TypeScript.
- AES-256-GCM vault with PBKDF2-SHA256 in `browser.storage.local`; the web page never
  sees seed or private-key material.
- BIP-39 seed generation / import / validation; multi-account HD derivation.
- EIP-1193 / EIP-6963 dApp provider with origin-scoped approvals and decoded
  transaction / signature review (WYSIWYS).
- Bitcoin, Ethereum, Polygon, Arbitrum, Plasma, Solana, and Spark (Lightning) via
  Tether WDK module registration; receive QR codes, send flows, transaction history.
