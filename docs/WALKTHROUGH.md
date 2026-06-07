# Local Wallet Walkthrough

Use this guide to try the starter locally after setup.

## Build and Load

```bash
nvm use
pnpm install
pnpm run build
```

Open `chrome://extensions` or `brave://extensions`, enable Developer mode, and load `.output/chrome-mv3`.

## Wallet Flow

1. Open the extension popup.
2. Create a wallet with a 12+ character password.
3. Review the generated recovery phrase, confirm it was saved, and create the encrypted vault.
4. Review the dashboard accounts and configured networks.
5. Add a second account.
6. Add or import a second wallet, then switch back to the original wallet after password confirmation.
7. Open Receive and inspect the address QR plus copy action.
8. Open Send and review network, asset, account, recipient, amount, validation, and QR recipient scan.
9. Open Activity and try search, network filtering, status filtering, and status refresh.
10. Lock and unlock the wallet.

## Local Test dApp

Serve the repository root:

```bash
pnpm run serve:test-dapp
```

Open `http://localhost:8080/test-dapp.html`.

The page includes provider discovery, `eth_chainId`, `eth_accounts`, `eth_requestAccounts`, `personal_sign`, `eth_signTypedData_v4`, and decoded ERC-20 approval controls.

Suggested dApp flow:

1. Confirm EIP-6963 provider discovery.
2. Click `Read accounts` and confirm no account is exposed before approval.
3. Trigger `eth_requestAccounts`, then approve the pending origin from the popup Sites tab.
4. Click `Read accounts` again and confirm the approved account appears.
5. Trigger `personal_sign`, then approve or reject the pending signature from the popup Sites tab.
6. Trigger a decoded transaction review and inspect the approval details.
7. Revoke the origin from the Sites tab and confirm the dApp no longer receives accounts.

## Automation

For automated browser checks, see `docs/BROWSER_VERIFICATION.md`.

For Linux or WSL-specific setup, see `docs/WSL_TESTING.md`.
