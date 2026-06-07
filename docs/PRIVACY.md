# Privacy Policy — WDK Browser Wallet Starter

_Last updated: 2026-06-04_

WDK Browser Wallet Starter ("the extension") is an open-source, self-custodial
cryptocurrency wallet. This policy describes exactly what the extension does and does
not do with your information.

## We do not collect your data

The extension has **no backend server** and **no analytics, telemetry, or tracking**.
The developer does not receive, store, or have access to any of your information —
including your seed phrase, private keys, passwords, addresses, or balances.

## What is stored, and where

- **Encrypted vault.** Your seed phrase is encrypted with **AES-256-GCM** using a key
  derived from your password via **PBKDF2-SHA256**, and stored only in your browser's
  local extension storage (`storage.local`) on your own device.
- **Settings.** Local preferences (such as the selected theme and any RPC overrides)
  are stored locally in the browser.
- Nothing in either category is transmitted to the developer or any third party.

Your password is never stored. Private keys are decrypted only in memory, inside the
isolated background context, for the moment a signature is produced.

## Network connections

To function as a wallet, the extension connects **only** to the public blockchain
RPC and explorer endpoints listed in its manifest (`host_permissions`), and only to:

- read public balances and transaction history for your addresses, and
- broadcast transactions that **you** explicitly approve.

These third-party RPC providers may, like any network service, observe the IP address
and request data inherent to an RPC call. The extension requests no broad host access
(no `<all_urls>`) and its Content-Security-Policy restricts outbound connections to
that same fixed list of endpoints.

## What web pages and dApps can see

Web pages never receive your seed phrase or private keys. A connected dApp can see
**only** the specific account addresses you explicitly grant it (origin-scoped), and
every transaction or signature request is shown to you for review and approval before
anything is signed.

## Permissions

- `storage` — store the encrypted vault and local settings on your device.
- `alarms` — run the auto-lock inactivity timer.
- Host permissions — connect to the public blockchain RPC/explorer endpoints above.

## Your control

You can remove all locally stored data at any time by removing the extension from
your browser. Because the wallet is self-custodial, **you are solely responsible for
backing up your recovery phrase** — it is the only way to recover your funds.

## Open source

The full source is available under the MIT license at
<https://github.com/th3nolo/wdk-browser-extension-starter>. You can audit exactly how
keys are handled before trusting the extension with real funds.

## Contact

For questions about this policy, open an issue on the GitHub repository above.
