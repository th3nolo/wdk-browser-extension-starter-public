/* Mock wallet data — mirrors the real WDK chain/asset registry. */
const NETWORKS = [
  { id: "bitcoin", label: "Bitcoin", native: "BTC", color: "#f7931a", short: "BTC" },
  { id: "spark", label: "Lightning · Spark", native: "SATS", color: "#7c3aed", short: "SPK" },
  { id: "ethereum", label: "Ethereum", native: "ETH", color: "#627eea", short: "ETH" },
  { id: "polygon", label: "Polygon", native: "POL", color: "#8247e5", short: "POL" },
  { id: "arbitrum", label: "Arbitrum", native: "ETH", color: "#28a0f0", short: "ARB" },
  { id: "plasma", label: "Plasma", native: "XPL", color: "#10b981", short: "XPL" },
  { id: "solana", label: "Solana", native: "SOL", color: "#14f195", short: "SOL" }
];
const NET = Object.fromEntries(NETWORKS.map((n) => [n.id, n]));

const ASSETS = [
  { sym: "USDt", name: "Tether USD", color: "#26a17b", usd: 12480.5, networks: ["ethereum", "polygon", "arbitrum"],
    breakdown: [["ethereum", "8,200.00"], ["polygon", "3,140.50"], ["arbitrum", "1,140.00"]] },
  { sym: "BTC", name: "Bitcoin", color: "#f7931a", usd: 18920.0, qty: "0.2841", networks: ["bitcoin"],
    breakdown: [["bitcoin", "0.2841"]] },
  { sym: "XAUt", name: "Tether Gold", color: "#b8901f", usd: 9870.0, qty: "4.20", networks: ["ethereum"],
    breakdown: [["ethereum", "4.20"]] },
  { sym: "ETH", name: "Ethereum", color: "#627eea", usd: 6180.0, qty: "1.904", networks: ["ethereum", "arbitrum"],
    breakdown: [["ethereum", "1.204"], ["arbitrum", "0.700"]] },
  { sym: "SOL", name: "Solana", color: "#14f195", usd: 1240.0, qty: "8.10", networks: ["solana"],
    breakdown: [["solana", "8.10"]] }
];
const TOTAL_USD = "48,690.50";

const WALLETS = [
  { id: "w1", name: "Primary wallet", color1: "#2dd4bf", color2: "#6366f1", accounts: 3 },
  { id: "w2", name: "Trading", color1: "#f59e0b", color2: "#ef4444", accounts: 1 },
  { id: "w3", name: "Cold storage", color1: "#60a5fa", color2: "#a78bfa", accounts: 2 }
];

const ACCOUNTS = [
  { i: 0, name: "Account 1", addr: "0x8f3a4b9c2e1d7a6f5b4c3d2e1f0a9b8c7d6e4e1c" },
  { i: 1, name: "Account 2", addr: "0x2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c" },
  { i: 2, name: "Account 3", addr: "0x5e4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1" }
];

const TXNS = [
  { id: "t1", kind: "receive", asset: "USDt", net: "polygon", amt: "+1,500.00", usd: "$1,500.00", status: "ok", when: "Today · 9:14 AM", from: "0x9a…f23b", hash: "0x4c2…a91" },
  { id: "t2", kind: "send", asset: "ETH", net: "ethereum", amt: "-0.250", usd: "$812.40", status: "ok", when: "Today · 8:02 AM", to: "0x77…1d4a", hash: "0x8b1…3e2" },
  { id: "t3", kind: "swap", asset: "USDt → ETH", net: "arbitrum", amt: "500.00", usd: "$500.00", status: "pending", when: "Today · 7:48 AM", to: "Uniswap V2", hash: "0x2f9…c07" },
  { id: "t4", kind: "send", asset: "BTC", net: "bitcoin", amt: "-0.012", usd: "$798.20", status: "ok", when: "Yesterday", to: "bc1q…x8k2", hash: "txid 7a…" },
  { id: "t5", kind: "receive", asset: "XAUt", net: "ethereum", amt: "+1.00", usd: "$2,350.00", status: "ok", when: "May 28", from: "0x41…9cc2", hash: "0x9d0…b14" },
  { id: "t6", kind: "send", asset: "SOL", net: "solana", amt: "-2.50", usd: "$382.50", status: "fail", when: "May 27", to: "5Hn…k29", hash: "sig 3b…" }
];

const SITES = [
  { origin: "https://app.uniswap.org", host: "app.uniswap.org", accounts: [0], chain: "ethereum" },
  { origin: "https://app.aave.com", host: "app.aave.com", accounts: [0, 1], chain: "polygon" },
  { origin: "https://jupiter.ag", host: "jupiter.ag", accounts: [0], chain: "solana" }
];

const SEED = ["ribbon", "harvest", "puzzle", "velvet", "anchor", "fossil", "meadow", "tunnel", " glory".trim(), "spider", "orbit", "cabin"];

const ACCENT_OPTIONS = [
  { name: "Teal", base: "#2dd4bf", strong: "#14b8a6", ink: "#03231f" },
  { name: "Indigo", base: "#6366f1", strong: "#4f46e5", ink: "#ffffff" },
  { name: "Emerald", base: "#10b981", strong: "#059669", ink: "#03231a" },
  { name: "Gold", base: "#d4af37", strong: "#c79a26", ink: "#241a02" },
  { name: "Coral", base: "#fb6a4a", strong: "#ef4f2c", ink: "#ffffff" },
  { name: "Magenta", base: "#e836c6", strong: "#d121b1", ink: "#1a0418" },
  { name: "Blue", base: "#1d6ef0", strong: "#1559cf", ink: "#ffffff" },
  { name: "Violet", base: "#a855f7", strong: "#9333ea", ink: "#ffffff" }
];

const FONT_OPTIONS = [
  { name: "Grotesk", head: "'Space Grotesk', sans-serif", body: "'Space Grotesk', sans-serif", mono: "'JetBrains Mono', monospace" },
  { name: "Humanist", head: "'Hanken Grotesk', sans-serif", body: "'Hanken Grotesk', sans-serif", mono: "'IBM Plex Mono', monospace" },
  { name: "Geometric", head: "'Manrope', sans-serif", body: "'Manrope', sans-serif", mono: "'IBM Plex Mono', monospace" },
  { name: "Editorial", head: "'Spectral', serif", body: "'Hanken Grotesk', sans-serif", mono: "'JetBrains Mono', monospace" },
  { name: "Mono", head: "'JetBrains Mono', monospace", body: "'JetBrains Mono', monospace", mono: "'JetBrains Mono', monospace" }
];

window.WDATA = { NETWORKS, NET, ASSETS, TOTAL_USD, WALLETS, ACCOUNTS, TXNS, SITES, SEED, ACCENT_OPTIONS, FONT_OPTIONS };
