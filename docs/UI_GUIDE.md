# UI Implementation Guide

This guide keeps visual work intentional, reviewable, and separate from wallet authority. The popup is a security surface: polish is welcome, but visual changes must not hide, rewrite, reorder, or soften approval-critical data.

## Scope

Use this guide when changing:

- Popup screens and shared UI components in `src/ui/`.
- Visual styling in `src/ui/styles.css`.
- Browser demo surfaces such as `test-dapp.html`.
- Static showcase assets in `website/` and `docs/showcase.gif`.

Do not put wallet execution, vault, session, provider, signing, transaction, or WDK integration logic in visual-only work. Those changes belong in the background/controller/storage/WDK layers with their own tests and security review.

## Visual Isolation Rule

Distortion and presentation effects are allowed only on the visual part of the UI:

- Allowed: shadows, gradients, subtle borders, hover states, focus rings, spacing, color tokens, capture framing, cursor overlays, scene pacing, and purely decorative visual treatment.
- Not allowed: changing origin text, addresses, amounts, network names, calldata, signature payloads, warning copy, approval/rejection semantics, button meaning, request ordering, or RPC behavior as part of a visual pass.
- Not allowed: using CSS or layout tricks that truncate, obscure, blur, fade, or visually de-emphasize security-critical details in confirmation screens.

If a change makes an approval easier to misunderstand, it is not a visual improvement.

## Design Tokens

Centralize color, typography, spacing, radius, and shadow choices in `src/ui/styles.css` under `:root`. Prefer semantic variables such as `--text`, `--muted`, `--surface`, `--border`, `--accent`, `--danger`, `--warning`, and `--success` over one-off component colors.

Keep the palette balanced. The current direction uses a quiet wallet palette with teal as the main action color, blue for informational states, amber for warnings, red for destructive/risky states, and neutral surfaces for dense wallet data. Avoid drifting into a one-hue theme.

Use stable dimensions for fixed-format surfaces:

- Popup shell: constrained width and minimum height.
- Icon buttons: fixed square dimensions.
- Segmented tabs: stable track and selected state.
- Confirmation cards: stable spacing so warnings and actions do not jump when request data changes.

Do not scale fonts with viewport width. Use fixed font sizes and responsive layout constraints instead.

## Component Structure

Use components for semantic hierarchy, not decoration. A visual-only change should usually touch `styles.css`; component changes should be limited to adding meaningful wrappers, headings, labels, accessibility names, or stable layout hooks.

Preferred patterns:

- Brand lockup: icon mark plus wallet name and session status.
- Wallet dashboard: dense, scan-friendly panels with compact controls.
- Repeated data: cards are acceptable.
- Page sections: use full-width bands or unframed layouts, not card-inside-card compositions.
- Buttons: use icon+text only for clear commands; icon-only controls need `title` and `aria-label`.
- Risk states: use visible warning/danger styling plus clear copy.

Avoid:

- Decorative cards around every section.
- Nested cards.
- Oversized marketing typography inside compact wallet panels.
- Visible instructional text that explains the app rather than presenting the workflow.
- Hiding controls behind purely decorative interactions.

## Confirmation UX

dApp approvals should feel like a focused wallet confirmation, not a settings panel.

Every dApp approval card must show:

- Request kind, such as connection, signature, typed data, or transaction.
- Origin as the user-facing trust boundary.
- Wallet/account/network context when relevant.
- The exact message, typed-data summary, recipient, amount, or transaction detail the user is approving.
- A warning when the request can create risk.
- Reject action before the approving action.

The `Sites` tab can still manage connected origins, but when there is an active pending request, the pending confirmation should take focus first. Management UI can return after the pending request is settled.

For contract transaction support, do not show raw calldata as the primary confirmation. The current ERC-20, swap, Aave, bridge, and Safe screens must lead with decoder-backed action details, simulation status, RPC preflight result, spender/router/pool/bridge/Safe fields, gas estimates, and wallet-derived fee estimates; ERC-20 transfer/approval cards must also show RPC token metadata and current-allowance delta when available. Raw calldata stays secondary technical detail. Future protocol screens should follow the same pattern for additional routers, lending entry points, bridges, and Safe payloads.

## Test dApp Styling

`test-dapp.html` is the browser-page fixture for provider discovery and dApp approval flows. Keep it polished enough to demonstrate the wallet without looking like a throwaway debug page.

The smoke scripts depend on stable element IDs. Do not remove or rename these without updating the browser smoke and demo scripts:

- `provider`
- `provider-detail`
- `chain-id`
- `chain-id-detail`
- `account`
- `account-detail`
- `signature`

The page may be visually redesigned, but it must continue to exercise provider discovery, account reads, connection approval, signature approval, and output logging from a real browser page.

## Visual QA Checklist

Before treating UI polish as done:

1. Inspect the popup at onboarding, unlocked dashboard, connected-sites management, and each pending approval type.
2. Inspect `test-dapp.html` in a browser viewport close to the popup and dApp fixture sizes.
3. Confirm long origins, addresses, and messages wrap without overlapping buttons or adjacent content.
4. Confirm warning and destructive states remain visually distinct.
5. Run the UI and verification commands required by the change scope.

For normal UI changes, run:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

For changes that affect dApp approvals or `test-dapp.html`, also run:

```bash
pnpm run smoke:chrome:dapp
```

For static showcase asset changes, also run:

```bash
pnpm run demo:gif
pnpm run smoke:demo:gif
```
