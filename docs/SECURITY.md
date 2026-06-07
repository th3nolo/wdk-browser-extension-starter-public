# Security Notes

## Threat Model

This starter protects against:

- Dapps reading the recovery phrase directly.
- Web pages calling extension APIs directly.
- At-rest recovery phrase disclosure from plain extension storage.
- Accidental signing while the wallet is locked.
- Long-lived unlocked sessions after idle timeout.
- Silent account exposure to unapproved dapp origins.
- Frontend byte-substitution attempts in the supported dApp approval path when the user compares wallet-computed signing details before approval.

Out of scope:

- Malicious browser extensions with broader privileges.
- Compromised browser or operating system.
- Supply-chain attacks in dependencies.
- Phishing pages that trick a user into approving a site or transaction.
- Production-grade chain-specific transaction simulation failures.
- Audit-grade WYSIWYS assurance for arbitrary contract calls, ERC-7730 descriptor trust, or ERC-8176 attestation. The implemented layer is digest verification for the supported paths, not a completed audit.

## Vault Encryption

The recovery phrase is encrypted with:

- AES-256-GCM
- PBKDF2-SHA256
- 600,000 iterations
- random 16-byte salt
- random 12-byte IV

The encrypted payload is stored in extension-local storage. The decrypted phrase is held only in the background session and cleared on lock or timeout. Wallet creation and import require a 12+ character password in both the popup UI and the background controller before vault encryption proceeds.

### Session persistence (convenience, not HSM-grade)

After unlock, the session seed is encrypted with AES-256-GCM and written to `browser.storage.session`. The encryption key is derived via HKDF from a random 32-byte service-worker lifetime secret held only in memory (`session-crypto.ts`). This lets the wallet survive a service-worker restart without forcing re-entry of the vault password, as long as the idle timeout has not elapsed.

After a service-worker restart, persisted ciphertext cannot be decrypted until the user unlocks again because the in-memory lifetime secret is regenerated. That behavior is intentional, but the lifetime secret is **not** hardware-backed — it is not stored in an OS secure enclave or HSM. Treat this model as idle-timeout convenience for a browser extension starter, not production-grade key isolation.

**Hardware wallet / secure enclave evaluation:** Chrome extension MV3 service workers cannot access OS secure enclaves or USB hardware wallets without additional native messaging hosts or platform-specific bridges. Adding Ledger/Trezor or WebAuthn-backed key isolation would require a separate host process, permission model changes, and WDK signing-path refactors. For high-value custody, prefer an external hardware wallet workflow or a native app shell; this starter documents the in-memory tradeoff and keeps vault encryption (PBKDF2 + AES-GCM) as the primary at-rest control.

`getSession()` updates `lastUsedAt` and asynchronously persists the touch on every read (`touchPersistedSession`). That keeps UX responsive but means expiry is evaluated against the in-memory timestamp while storage may lag briefly; the one-minute idle alarm can race with concurrent reads. Lock and explicit timeout paths remain authoritative.

The create-wallet popup shows the freshly generated 24-word recovery phrase once and requires the user to confirm the recovery phrase was saved before the encrypted vault is created. The phrase is then sent to the background controller for validation and encryption, and is not persisted outside the encrypted vault plus the active in-memory session.

## Extension Isolation

The extension uses three layers:

- Inpage provider: page-facing EIP-1193 interface.
- Content script: validates page message shape and relays only well-formed provider requests.
- Background script: vault, session, WDK, and signing authority.

The inpage provider does not know the seed phrase and cannot call WDK directly. The content script validates the page message target, request id, method, and params before forwarding anything to the background runtime. It announces through EIP-6963 and avoids overwriting an existing non-WDK `window.ethereum` provider.

The background records the sender tab/document for each dApp request and uses that target list for provider events instead of discovering tabs by URL, so the manifest does not need `tabs` or broad default host permissions. `eth_accounts` returns an empty list while locked or unapproved, `eth_requestAccounts` queues an origin-scoped connection request, and account access is only returned after the user approves the origin from the popup Sites view. Locking the wallet emits both `accountsChanged([])` and `disconnect` to recorded connected dApp targets; site revocation uses the same events and also removes the stored connection.

`personal_sign` and `eth_signTypedData_v3/v4` use a second explicit Sites-tab approval for each signature request, so a connected site cannot silently sign messages or typed data. Hex-encoded `personal_sign` payloads (`0x...`) are signed as raw decoded bytes under EIP-191; UTF-8 text is shown when decodable, otherwise the canonical hex string is shown. Plain-text payloads are shown and signed as UTF-8. The popup highlights the signing origin, message encoding, byte size, hex semantics, typed-data domain fields, digest details, and phishing warnings.

`eth_sendTransaction` supports native EVM transfers and decoded ERC-20 `transfer` / `approve`, Uniswap V2-style swap, Aave pool action, LayerZero OFT / USDT0-style bridge, and Safe `execTransaction` calldata only after wallet-side gas estimation and `eth_call` preflight. The pending review records simulation status, gas estimate, wallet-derived fee estimate, RPC preflight details, and wallet-computed WYSIWYS digest details. ERC-20 reviews query token metadata plus approval current allowance and delta when available. Unknown calldata, dApp gas/fee overrides, nonces, access lists, failed preflight checks, and native contract-recipient calls are rejected before any popup approval is queued. Approved transaction requests are re-prepared immediately before WDK execution.

`wallet_addEthereumChain` succeeds only for pre-configured WDK EVM networks; custom RPC endpoints are rejected. Users can delete an encrypted vault from the popup after confirming the wallet password; deletion wipes the vault, wallet record, local transaction history, and site permissions for that wallet from extension storage.

### Supported dApp methods

| Method | Behavior |
| --- | --- |
| `eth_chainId` | Returns the origin's active supported EVM chain ID. |
| `wallet_switchEthereumChain` | Switches the origin to another pre-configured EVM chain. |
| `wallet_addEthereumChain` | No-op success for pre-configured chains; rejects custom networks/RPCs. |
| `eth_accounts` / `eth_requestAccounts` | Origin-scoped connect flow with popup approval. |
| `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_feeHistory`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getCode` | Validated read-only EVM RPC proxy for unlocked connected origins; call/estimate requests cannot spoof another `from` account. |
| `personal_sign` | Popup approval; UTF-8 text signing or raw decoded-byte hex signing with explicit hex display semantics and wallet-computed EIP-191 digest details. |
| `eth_signTypedData_v3/v4` | Popup approval; structured EIP-712 domain/message preview plus final digest, domain separator, and message hash details. |
| `eth_sendTransaction` | Popup approval for native EVM transfers with checksum address validation and EOA recipient verification, plus decoded ERC-20 transfer/approval with RPC token metadata/current-allowance delta when available, Uniswap V2-style swap, Aave pool action, LayerZero OFT / USDT0-style bridge, and Safe execution calldata after wallet-side `eth_estimateGas` and `eth_call` preflight. The approval model stores simulation status, gas estimate, wallet-derived fee estimate, RPC preflight details, raw request digest, and calldata digest before the popup can approve. Unknown calldata, dApp gas controls, nonces, access lists, and failed preflights are rejected before approval. |
| Other methods | Rejected as unsupported. |

## Manifest Permissions

The extension requests only `storage` and `alarms` as Chrome permissions. It does not request broad tab, scripting, or clipboard permissions. `pnpm run smoke:manifest` validates the generated MV3 manifest version, background service worker, popup action, content-script timing and matches, web-accessible inpage script declaration, required host permissions, and extension-page CSP before release.

## Transaction Confirmation

The popup send flow uses a two-step review pattern. The first action validates network, account, recipient, and amount; the confirmation panel then shows the network, asset, source account, destination, and amount. The background controller repeats wallet, account, network, asset, address, and amount validation before calling WDK to submit the transaction. `sendTransaction` (`src/lib/wdk/client.ts`) also runs `assertSendAffordable` to reject sends when the account balance cannot cover the transfer amount plus a conservative per-chain fee reserve (EVM uses `EVM_TRANSFER_MAX_FEE_WEI`; BTC/Spark/Solana use family-specific minimums).

## Address Validation

Recipient checks in `validateAddress` (`src/lib/validation.ts`) delegate to chain-specific checksum validators in `src/lib/address-validation.ts`:

- **EVM** (Ethereum, Polygon, Arbitrum, Plasma): `ethers.isAddress` (EIP-55 mixed-case checksum when present; all-lower/all-upper accepted).
- **Bitcoin**: `bitcoinjs-lib` `address.toOutputScript` against mainnet (base58check and bech32/bech32m).
- **Solana**: `@solana/addresses` `isAddress` (base58 decode plus on-curve public key check).
- **Spark**: bech32m decode with HRP `spark`.

Direct dependencies are pinned in `package.json` (`ethers`, `bitcoinjs-lib`, `bech32`, `@solana/addresses`) rather than relying on WDK transitive copies.

## RPC Layer

`rpcFetch` (`src/lib/rpc-fetch.ts`) retries configured endpoints with a bounded `AbortSignal` timeout and throws structured `RpcFetchError` instances (including `timedOut`) so slow or hanging RPCs do not block the service worker indefinitely during transaction status refresh or other RPC use.

## Required Production Hardening

Before using with real funds:

- Address validation now uses chain-specific checksum and encoding validation in `src/lib/address-validation.ts`; production teams should still add broader chain-specific integration fixtures.
- Expand transaction confirmation screens beyond the current native, ERC-20 metadata/allowance review, wallet-derived fee estimate, and first-wave protocol summaries with verified spender identity, price/quote comparison, richer phishing and malicious-contract intelligence, fee-speed controls, and chain-specific simulation before signing.
- Add hardware wallet and/or OS secure enclave support where available.
- Add per-chain testnet fixtures and integration tests.
- Cross-check the WYSIWYS digest verification implementation in `docs/WYSIWYS_VERIFICATION.md` against external tools such as `clearsig` / `safe-hash-rs` and get audit review before production or real-funds use.
- Pin and audit WDK dependency versions.
- Align direct `@tetherto/wdk*` packages to one beta and override nested `@tetherto/wdk-wallet` to the same baseline.
- Add RPC failover and rate-limit handling.

See `docs/DAPP_PRODUCTION_READINESS.md` for the larger provider, calldata decoding, simulation, protocol-module, and real-dApp harness paths that teams can extend for deeper protocol flows.

## Dependency Audit

Current `pnpm audit --prod --json` production audit findings are tracked by `pnpm run smoke:audit`. The smoke check fails on critical vulnerabilities, undocumented advisory names, or undocumented direct vulnerable dependencies; it passes only when findings match this documented starter risk profile.

Run `pnpm run smoke:audit` before publishing a fork, sharing a release build, or changing dependencies. The allowlist documents currently accepted starter risks and should shrink as WDK/toolchain advisories are patched. The smoke check fails on undocumented direct vulnerable dependencies, undocumented advisory names, or critical findings.

Build tooling (`wxt`, `@vitejs/plugin-react`, and their transitive toolchain) is kept in `devDependencies` so it stays out of the production audit surface.

Direct WDK packages are pinned to `1.0.0-beta.9`, and `pnpm-workspace.yaml` overrides force nested `@tetherto/wdk-wallet` to the same baseline so chain modules do not drift across beta.7-beta.8 copies. The same workspace config enforces pnpm minimum-release-age and trust-downgrade policy; its `trustPolicyExclude` entries are temporary version-specific exceptions for packages that were already present in the pre-migration lockfile and older than 72 hours. Address-validation dependencies (`ethers`, `bitcoinjs-lib`, `bech32`, `@solana/addresses`) are pinned as direct production dependencies aligned with WDK transitive versions. `pnpm run smoke:wdk-deps` verifies the alignment after install, and `pnpm run smoke:wdk-surface` prevents TON, Tron, gasless, ERC-4337, or protocol-module runtime exposure unless the package, browser, and audit coverage is intentionally added. `pnpm run sync:audit-allowlist` refreshes `scripts/audit-smoke.mjs` when the production audit surface changes. `wxt` is kept in `devDependencies` so build tooling stays out of the production audit surface.

## Supply-Chain Automation

Production dependency hygiene is automated in GitHub Actions and Dependabot:

- `.github/dependabot.yml` opens weekly grouped PRs for npm and GitHub Actions updates:
  - `@tetherto/*` in one PR
  - WXT/Vite toolchain in one PR
  - React, lint/test, and remaining runtime packages in separate groups
- `.github/workflows/dependency-pr.yml` runs on dependency PRs and requires `verify:ci` plus resolved lockfile review output.
- `.github/workflows/audit-schedule.yml` runs weekly and on demand: `smoke:lockfile`, `sync:audit-allowlist --check`, `smoke:audit`, and `smoke:wdk-deps`.
- `.github/workflows/wdk-beta-check.yml` is available on demand for a one-shot aligned WDK bump that also refreshes the audit allowlist and opens a PR.
- CI enforces lockfile integrity on every push/PR: `pnpm run smoke:lockfile` verifies `pnpm-lock.yaml` matches `package.json`, pull requests that change `package.json` must also update `pnpm-lock.yaml`, and `pnpm run review:lockfile -- --pr-review` prints resolved version diffs for security review.

### WDK upgrade cadence

When Tether ships a newer beta with patched transitive dependencies:

1. Dependabot should open one grouped `@tetherto/*` PR, or run `node scripts/check-wdk-beta.mjs --apply` manually/on demand.
2. Ensure all five direct `@tetherto/wdk*` pins and the `@tetherto/wdk-wallet` override stay on the same version.
3. Run `pnpm run smoke:wdk-deps`, `pnpm run smoke:audit`, and `pnpm run sync:audit-allowlist` so `scripts/audit-smoke.mjs` shrinks as advisory chains clear.
4. Review the resolved lockfile diff from `pnpm run review:lockfile -- --pr-review` before merging.

Local maintainer commands:

```bash
pnpm run smoke:lockfile
pnpm run smoke:wdk-surface
pnpm run review:lockfile
pnpm run sync:audit-allowlist
pnpm run check:wdk-beta
node scripts/check-wdk-beta.mjs --apply
```

## Repository History Secret Scanning

Publishing a repository exposes the **entire git history**, so a secret that was
committed and later deleted would still leak. Two layers guard against this:

- **`pnpm run verify:secrets:history`** (`scripts/history-secret-scan.mjs`) walks every
  blob across all refs and flags PEM/cloud tokens, hex private keys, and
  **checksum-validated BIP-39 seed phrases** (so prose does not false-positive). It
  allowlists reviewed test material (test passwords, keccak hash vectors, the public
  `abandon … about` test seed, Chrome-binary checksums). Exits non-zero on any other
  hit.
- **`.github/workflows/secret-scan.yml`** runs `gitleaks` (config: `.gitleaks.toml`)
  plus the wallet-specific scan on every push/PR and on a weekly sweep.

If a real secret is ever found: **rotate it first**, then scrub history with
`git filter-repo` (or BFG) — deleting the file in a new commit is not enough. For
public repositories, also enable GitHub's native **Secret scanning + push protection**
(free for public repos) under Settings -> Code security.
