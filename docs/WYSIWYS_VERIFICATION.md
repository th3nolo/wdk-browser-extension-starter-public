# WYSIWYS Verification

This document describes the current WYSIWYS digest verification model, coverage, limits, and follow-up work for the supported dApp approval path.

The starter uses the existing dApp request pipeline for semantic review plus byte-level digest verification on supported approvals. The verification layer is not audited and does not provide arbitrary dApp production safety.

## Current Architecture Anchor

The dApp request path stays inside the existing extension seams:

1. `entrypoints/inpage.ts` receives `window.ethereum.request` from page context.
2. `entrypoints/content.ts` validates and bridges page messages into extension runtime messaging.
3. `entrypoints/background.ts` owns the locked/unlocked wallet boundary, vault session, WDK access, and sender-tab event targeting.
4. `src/lib/background/dapp-rpc.ts` dispatches provider methods and preserves raw request params for verification.
5. `src/lib/background/wallet-execution.ts` is the background-only WDK execution boundary.
6. `src/lib/background/pending-dapp-approvals.ts` is the canonical pending approval store. Do not split the pending approval store; `pending-signatures.ts` and `pending-dapp-transactions.ts` are thin typed facades over that shared union store.
7. `src/ui/SignatureRequestCard.tsx` and `src/ui/DappTransactionRequestCard.tsx` render the approval surfaces.

The page and content contexts remain free of recovery phrases, private keys, digest trust decisions, and descriptor trust decisions.

## Supported Approval Coverage

The supported dApp approval path includes:

- `src/lib/verify/hash.ts`, `calldata.ts`, `typed-data.ts`, `safe.ts`, and `evidence.ts`.
- Direct pinned `@noble/hashes` dependency for Ethereum keccak helpers.
- Raw dApp request params cloned/frozen before parser normalization in `src/lib/background/dapp-rpc.ts`.
- `eth_sendTransaction` approvals carry raw request digest and ERC-8213-style calldata digest when calldata exists.
- `personal_sign` approvals carry raw request digest and EIP-191 message digest.
- `eth_signTypedData_v3` / `eth_signTypedData_v4` approvals carry raw request digest, final EIP-712 digest, domain separator, and message hash.
- The shared pending approval store carries verification data through `browser.storage.session`.
- Approval cards render copyable digest details and second-device verification copy.
- `src/lib/verify/__fixtures__/vectors.ts` and `src/lib/verify/__tests__/vectors.test.ts` gate calldata, typed-data, personal-sign, Safe v1.4.x, Safe pre-1.3.0, nested Safe, and negative vectors.

Current limits:

- ERC-7730 descriptor translation.
- ERC-8176 descriptor attestation and pinned auditor keys.
- Safe transaction-service ingestion beyond generic EIP-712 typed-data digest verification and the standalone `safeTxHash` helper.
- Audit-grade assurance under all malformed or malicious inputs.

## Verification TCB

The verification TCB lives under `src/lib/verify/`:

- `hash.ts`: hex normalization, ABI word helpers, `keccak256`, and byte utilities.
- `calldata.ts`: ERC-8213-style length-prefixed calldata digest with checked-in vectors.
- `typed-data.ts`: EIP-712 verification-data builder.
- `safe.ts`: Safe `SafeTx` hash for fixed Safe transaction structs and version-aware domain separators.
- `evidence.ts`: serializable verification-data shapes consumed by pending approvals and UI.

Do not use Node/Web `crypto.createHash("sha3-*")` for Ethereum hashing. Do not introduce a broad ABI encoder into the digest hot path unless the vector gate proves it is safer than the fixed encoders.

## Verification Flow

For `eth_sendTransaction`, `src/lib/background/dapp-rpc.ts` clones the raw params, parses and prepares the transaction, builds verification data from the raw request plus prepared transaction shape, then queues the pending transaction with verification details attached.

For `personal_sign`, the dispatcher preserves the exact byte payload selected by the parser and records whether those bytes came from raw hex or UTF-8 text.

For `eth_signTypedData_v3` / `eth_signTypedData_v4`, the dispatcher clones raw params before parsing and builds EIP-712 verification data only through the vector-tested implementation.

Serializable verification fields live on the existing approval types:

- `DappTransactionRequest.verification`
- `DappSignatureRequest.verification`

The digest verification is additive. It does not replace semantic review, allowlisted decoders, rejection of unknown calldata, rejection of dApp gas/fee/nonce/access-list overrides, `eth_estimateGas`, `eth_call` preflight, fee reserve estimates, or simulation warnings.

## Safe Scope

Current Safe support is Safe `execTransaction` calldata review inside `eth_sendTransaction`.

Standalone Safe hashing is implemented in `src/lib/verify/safe.ts` and covered by vectors:

- Generic Safe typed-data requests receive normal EIP-712 digest verification.
- The standalone `safeTxHash` helper requires the caller to provide the Safe version needed for the EIP-712 domain shape.
- The helper computes `safeTxHash` from fields, not from a dApp-supplied hash.
- Safe pre-1.3.0 and 1.3.0+ domain separators are covered.
- Nested Safe `approveHash(bytes32)` is covered as a standalone vector.

Full Safe transaction-service compatibility is outside the current Safe `execTransaction` decoder scope.

## UI Requirements

Updated approval surfaces:

- `src/ui/DappTransactionRequestCard.tsx`
- `src/ui/SignatureRequestCard.tsx`

UI rules:

- Show the digest block on supported transaction and signature approvals.
- Keep the full digest copyable.
- Render middle-truncated digest text in monospace with an expand affordance.
- Label unverified or vector-disabled digest details plainly.
- Add a second-device verification affordance for high-value Safe or contract signs.
- Keep descriptor or decoded text escaped as React text. No `dangerouslySetInnerHTML`.
- Never add "remember this dApp" or automatic approval for value-bearing requests.

## Future Descriptor Work

ERC-7730 descriptors and ERC-8176 attestations should remain layered above the digest floor.

When added:

- Fetch descriptors through a background-only path.
- Validate descriptor shape before UI rendering.
- Mark descriptor text trusted only when ERC-8176 attestation verifies against auditor keys pinned in the extension build.
- Require attested chain ID and contract address to match the target exactly.
- Keep showing the digest even when descriptor attestation passes.
- Treat unauthenticated descriptors as untrusted explanatory text, not a security signal.

## Test-Vector Gate

WYSIWYS digest verification is implemented and guarded by checked-in vectors under `src/lib/verify/__fixtures__/` and `src/lib/verify/__tests__/`.

Required vectors:

- ERC-8213-style calldata digest generated from the length-prefixed formula.
- EIP-712 final digest, domain separator, and message hash for real v3/v4 payloads.
- Safe `SafeTx` hash for Safe v1.4.x.
- Safe `SafeTx` hash for pre-1.3.0.
- Nested Safe approval case.
- Negative vectors for malformed calldata, wrong Safe version, and typed-data shape mismatch.

Before this guards meaningful funds, cross-check the calldata vectors with `clearsig` or another external oracle. The checked-in vectors prevent local regressions, but they are not a substitute for an audit.

Required gates:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm run smoke:chrome:dapp
```
