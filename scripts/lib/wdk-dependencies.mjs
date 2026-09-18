// WDK modules are independently versioned. These releases declare the same
// base wallet; matching their beta numbers would force incompatible source pins.
export const WDK_WALLET_VERSION = "1.0.0-beta.17";
export const WDK_DEPENDENCIES = Object.freeze({
  "@tetherto/wdk": "1.0.0-beta.17",
  "@tetherto/wdk-wallet-btc": "1.0.0-beta.14",
  "@tetherto/wdk-wallet-evm": "1.0.0-beta.17",
  "@tetherto/wdk-wallet-solana": "1.0.0-beta.13",
  "@tetherto/wdk-wallet-spark": "1.0.0-beta.23"
});

export function assertWdkManifest(dependencies) {
  for (const [name, version] of Object.entries(WDK_DEPENDENCIES)) {
    if (dependencies?.[name] !== version) {
      throw new Error(`${name} must match the reviewed WDK matrix: ${version}`);
    }
  }
}

export function assertWdkSourceDependencies(name, dependencies) {
  const expected = name === "@tetherto/wdk" ? "^1.0.0-beta.15" : WDK_WALLET_VERSION;
  if (dependencies?.["@tetherto/wdk-wallet"] !== expected) {
    throw new Error(`${name} has an unreviewed base-wallet source constraint`);
  }
}
