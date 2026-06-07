# dApp Integration Scope

This starter includes the browser-extension pieces a WDK dApp wallet needs: injected-provider discovery, origin-scoped account approval, background-only wallet execution, explicit signature approval, decoded transaction review for the supported slice, wallet-computed WYSIWYS verification details, and browser automation for those flows.

It is ready as a browser-extension starter. Teams building deeper protocol workflows can extend the same approval and verification model for their target dApps.

## Supported Provider Surface

The current provider supports:

- `eth_chainId`
- `wallet_switchEthereumChain`
- `wallet_addEthereumChain` for pre-configured networks only
- `eth_accounts`
- `eth_requestAccounts`
- validated read-only EVM RPCs for connected unlocked origins: `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_feeHistory`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, and `eth_getCode`
- `personal_sign` with wallet-computed EIP-191 digest details
- `eth_signTypedData_v3` and `eth_signTypedData_v4` with final digest, domain separator, and message hash details
- `eth_sendTransaction` for native EVM transfers and supported decoded calldata after RPC gas estimation and `eth_call` preflight

Supported decoded transaction reviews currently include ERC-20 `transfer` / `approve`, Uniswap V2-style swap, Aave pool action, LayerZero OFT / USDT0-style bridge, and Safe `execTransaction` calldata. The approval model stores simulation status, gas estimate, wallet-derived EIP-1559 or legacy fee estimate, raw RPC details, and wallet-computed raw-request/calldata digest details.

Unknown calldata, dApp gas overrides, nonces, access lists, failed preflight checks, and unsupported custom networks are rejected before user approval. That is intentional for a starter: unsupported requests should fail closed instead of being shown as opaque approvals.

## Protocol Flow Extensions

Uniswap, Aave, Safe, bridges, and similar dApps can require more than account connection and signing. Depending on the target flow, teams may add:

- additional read-only RPC methods such as log/filter reads;
- broader calldata decoders for more router versions, lending entry points, bridge variants, Safe modules, multicalls, permits, and approval side effects;
- verified spender, token-list, contract, router, recipient, and protocol identity context;
- price context, quote comparison, fee-speed selection, slippage warnings, and chain-specific failure warnings;
- protocol-specific simulation beyond baseline `eth_call` / `eth_estimateGas`;
- Safe transaction-service support when the dApp flow depends on Safe proposal/execution APIs;
- WalletConnect support when a target dApp does not reliably use injected providers.

Those are normal product extensions, not missing setup steps for running this starter.

## WDK Surface Reviewed

WDK exposes a broader platform than this starter uses by default:

- wallet modules for EVM, Bitcoin, Solana, Spark, TON, and Tron;
- protocol modules for swaps, bridges, and lending;
- Velora swaps on EVM;
- USDT0 bridging through LayerZero;
- Aave V3 lending operations;
- MoonPay fiat on/off-ramp support;
- gasless flows for TON, Tron, and ERC-4337-style EVM account abstraction;
- MCP tooling;
- React Native UI Kit components and theming primitives.

This repo currently uses the direct WDK wallet packages for EVM, Bitcoin, Solana, and Spark. It does not expose TON, Tron, protocol modules, fiat modules, MCP tooling, or account-abstraction/gasless modules in the extension runtime.

Additional WDK packages are not runtime dependencies by default. Add them only when the extension actually needs that chain or protocol, then review the dependency tree, confirm the browser bundle still works, and add a small browser smoke for the new flow.

### Optional WDK Modules

The table below is a maintainer checklist for WDK packages this starter does not install by default. Versions were checked on 2026-06-01 against the official WDK docs (`https://docs.wdk.tether.io/llms-full.txt`) and npm registry metadata. Recheck current package versions before changing runtime dependencies.

For CI, the same package list lives in `docs/wdk-surface-evaluation.json`. Run `pnpm run smoke:wdk-surface` after changing WDK dependencies so the docs, dependency list, and runtime surface stay in sync.

| Package | Current note | Add when |
| --- | --- | --- |
| `@tetherto/wdk-wallet-ton` | Version checked: `1.0.0-beta.9`; install was delayed by the minimum-release-age policy | The project needs TON accounts, balances, sends, and testnet coverage |
| `@tetherto/wdk-wallet-tron` | Version checked: `1.0.0-beta.5`; older WDK wallet baseline | The package baseline matches this starter and browser coverage exists |
| `@tetherto/wdk-wallet-evm-erc-4337` | Version checked: `1.0.0-beta.7`; different EVM wallet beta than this repo pins | Account-abstraction UX, bundler/paymaster config, and browser coverage are ready |
| `@tetherto/wdk-protocol-swap-velora-evm` | Version checked: `1.0.0-beta.4`; adds protocol and ERC-4337 dependency surface | Swap quotes, calldata decoding, and browser coverage are ready |
| `@tetherto/wdk-protocol-bridge-usdt0-evm` | Version checked: `1.0.0-beta.4`; adds LayerZero/OFT, TON, Tron, ERC-4337 surface | Bridge quotes, fee handling, calldata decoding, and browser coverage are ready |
| `@tetherto/wdk-protocol-lending-aave-evm` | Version checked: `1.0.0-beta.4`; depends on older wallet package baselines | Market/reserve checks, health-factor review, and browser coverage are ready |
| `@tetherto/wdk-protocol-fiat-moonpay` | Version checked: `1.0.0-beta.2`; optional and API-key dependent | Fiat provider credentials and browser coverage are configured |
| `@tetherto/wdk-wallet-ton-gasless` | Version checked: `1.0.0-beta.5`; older TON wallet baseline | TON baseline and paymaster flow coverage are ready |
| `@tetherto/wdk-wallet-tron-gasfree` | Version checked: `1.0.0-beta.6`; requires service-provider credentials | Tron baseline, provider credentials, and browser coverage are ready |

## Extension Checklist For Deeper dApps

When adding a new protocol or dApp family:

1. Record the expected provider methods with a controlled local fixture.
2. Add only the read-only RPC methods needed by that flow.
3. Decode request calldata from known ABIs.
4. Resolve token, spender, router, pool, bridge, or Safe identity from trusted sources.
5. Run gas estimation and preflight simulation.
6. Show a focused approval screen with action summary, warnings, fees, simulation result, and WYSIWYS digest details.
7. Re-prepare the request immediately before WDK execution.
8. Persist transaction history with decoded metadata.
9. Add browser smoke coverage for connect, approve, reject, and safe-path execution.
