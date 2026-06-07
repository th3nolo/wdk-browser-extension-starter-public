import WDK from "@tetherto/wdk";
import WalletManagerBtc from "@tetherto/wdk-wallet-btc";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import WalletManagerSolana from "@tetherto/wdk-wallet-solana";
import WalletManagerSpark from "@tetherto/wdk-wallet-spark";

const seedPhrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const signingMessage = "WDK golden vector";

let wdk = new WDK(seedPhrase);
wdk = wdk.registerWallet("ethereum", WalletManagerEvm, {
  provider: "https://ethereum-rpc.publicnode.com",
  chainId: 1
});
wdk = wdk.registerWallet("bitcoin", WalletManagerBtc, {
  network: "bitcoin",
  client: { type: "blockbook-http", clientConfig: { url: "https://btc1.trezor.io/api" } }
});
wdk = wdk.registerWallet("solana", WalletManagerSolana, {
  provider: "https://solana-rpc.publicnode.com",
  commitment: "confirmed"
});
wdk = wdk.registerWallet("spark", WalletManagerSpark, {
  network: "MAINNET"
});

const expectedAddresses = {
  ethereum: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  bitcoin: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  solana: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
  spark: "spark1pgss85kzu8r3kerhnvxwzzasls3wz3tycfdc4f6d4wgp5trmsel3x8jgad52lz"
};

const expectedSignatures = {
  ethereum: "0x901d61a93dde7da5bacd4aa13004da8dcea1c8cd824ec9bd851be056c327aa567f0b392fff2fa8ed27c33463deb0eaa89dbb4893292f5bf5a36eb0cc5d9b9e7d1c",
  bitcoin: "KHkWs2qWxJKWHxgXrDMfOBqmKNpKL9D9yBhUOBx61j+JMYk3cF5qKtSx5++IAvRW83pcqXAyhXrMKG0DhCrlQjE=",
  solana: "b7d0e4329eabedffecc18e9591d4500dd9bd24bc6fa1d382dbdaae90bcf21cce823f4babfee767f7890cafc4715be176e7aca75cd04d991f6480967a3ec4da0b",
  spark: "3045022100994f68ebc73f1c1e7de9e7e98bcae9295b224fa542a45434f9d8a7b6e924667402204c92c5f9f799c1ed503b04fdde94867ef2f34b37b9254f0a42051b7469e3cca2"
};

const addresses = {};
const signatures = {};
for (const key of Object.keys(expectedAddresses)) {
  const account = await wdk.getAccount(key, 0);
  addresses[key] = await account.getAddress();
  if (addresses[key] !== expectedAddresses[key]) {
    throw new Error(key + " address golden vector mismatch: expected " + expectedAddresses[key] + ", got " + addresses[key]);
  }
  signatures[key] = await account.sign(signingMessage);
  if (signatures[key] !== expectedSignatures[key]) {
    throw new Error(key + " signature golden vector mismatch: expected " + expectedSignatures[key] + ", got " + signatures[key]);
  }
}

wdk.dispose?.();

console.log(JSON.stringify({ ok: true, addresses, signatures }, null, 2));
