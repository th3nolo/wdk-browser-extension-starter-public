# WDK Browser Extension Wallet

This context describes a browser-extension wallet built on Tether WDK. It owns encrypted wallet vaults, unlocked wallet sessions, account derivation, dApp-origin permissions, explicit user approvals, and transaction submission while keeping secret material out of web pages.

## Language

### Wallet custody

**Wallet**: A user-controlled wallet record backed by one encrypted vault and one or more derived accounts.
_Avoid_: Profile, user, account

**Wallet vault**: The encrypted at-rest storage record that protects a wallet's recovery phrase.
_Avoid_: Store, keychain, secret blob

**Recovery phrase**: The BIP-39 phrase used to create or restore a wallet.
_Avoid_: Seed, mnemonic, private key

**Wallet password**: The user-supplied password required to create, unlock, switch to, or delete a wallet vault.
_Avoid_: PIN, passcode

**Wallet session**: The unlocked, idle-expiring extension session that can derive accounts and authorize WDK operations for the active wallet.
_Avoid_: Login session, browser session

**Wallet execution**: The background-only boundary that turns an unlocked wallet session into account derivation, balance reads, signatures, and transaction submission through WDK.
_Avoid_: WDK plumbing, seed access

### Accounts and networks

**Account**: A chain-specific derived address at a wallet account index.
_Avoid_: User account, site account

**Account index**: The numeric derivation slot selected for a wallet account.
_Avoid_: Address index, wallet number

**Network**: A supported blockchain network exposed by the wallet, such as Ethereum, Polygon, Arbitrum, Plasma, Bitcoin, Spark, or Solana.
_Avoid_: Chain when speaking to users

**Asset**: A supported native coin or token balance/transferrable value on a network.
_Avoid_: Currency, token when native coins are included

**RPC override**: A user-approved replacement RPC endpoint for a supported network.
_Avoid_: Custom network, custom chain

### dApp access

**dApp**: A web page that talks to the wallet through the injected provider.
_Avoid_: Site when describing provider behavior

**Origin**: The normalized web origin used to scope dApp permissions and pending requests.
_Avoid_: URL, domain

**Connected site**: An approved origin-to-wallet/account relationship that allows passive account reads while the wallet is unlocked.
_Avoid_: Permission, trusted site

**Connection request**: A pending user decision to approve or reject an origin's account access.
_Avoid_: Login request, auth request

**Connected site lifecycle**: The background flow that requests, approves, rejects, revokes, switches network for, and closes a connected site's wallet access.
_Avoid_: Site auth flow, dApp session manager

**Provider request**: A dApp-initiated EIP-1193 method call bridged into the extension.
_Avoid_: Background message, RPC command

**Provider event**: A wallet-to-dApp notification such as account, chain, connect, or disconnect state.
_Avoid_: Tab message, content event

### Explicit approvals

**dApp approval**: A user-visible pending decision for a connected dApp action that must be approved or rejected from the popup.
_Avoid_: Popup task, approval item

**Signature request**: A dApp approval for `personal_sign` or EIP-712 typed-data signing.
_Avoid_: Signing job, message task

**Transaction request**: A dApp approval for a connected dApp's EVM transaction, including native transfers and supported decoded contract calldata such as ERC-20, swap, Aave, bridge, or Safe-shaped requests.
_Avoid_: Send request, transaction task

**Pending approval outcome**: The resolved or rejected result delivered back to the waiting provider request.
_Avoid_: Result cache, completion record

### Transactions

**Send request**: A user-initiated popup transfer request for a selected wallet, network, asset, account index, recipient, and amount.
_Avoid_: Transaction request

**Transaction history**: The wallet-local record of submitted transactions and their refreshed status.
_Avoid_: Activity log when discussing persisted records

### Popup state

**Wallet summary**: The popup-facing snapshot of wallet lock state, connected sites, pending requests, accounts, and transaction history.
_Avoid_: Popup model, view state
