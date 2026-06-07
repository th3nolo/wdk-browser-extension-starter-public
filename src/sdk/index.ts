/**
 * The curated white-label SDK. The UI shell imports the wallet core ONLY
 * through this surface: the typed command client, the wire/error contract, and
 * the UI-facing view types + display helpers. The core never imports the UI.
 */
export * from "./contract";
export * from "./wallet-client";
export * from "./view-types";
