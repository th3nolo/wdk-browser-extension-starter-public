/* Shared wallet UI primitives — all token-driven via wallet.css classes. */
const { useState } = React;

/* Real full-color brand logos (spothq/cryptocurrency-icons). Each SVG carries
   its own colored disc, so no tint is applied. Unknown symbols fall back to a
   generic coin mark. */
const COIN_ICON = { USDt: "usdt", BTC: "btc", XAUt: "xaut", ETH: "eth", SOL: "sol" };

function Coin({ sym, size = 34 }) {
  const file = COIN_ICON[sym] || "generic";
  return <img className="coin" src={`assets/coins/${file}.svg`} alt={sym} title={sym}
    style={{ width: size, height: size, borderRadius: "50%", boxShadow: "none", display: "block", flex: "0 0 auto" }} />;
}

function Avatar({ c1, c2, label, size = 32 }) {
  return <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(140deg, ${c1}, ${c2})`, fontSize: size * 0.36 }}>{label}</span>;
}

function NetDot({ id }) {
  const n = WDATA.NET[id];
  return <span className="net-dot" style={{ background: n ? n.color : "var(--muted)" }} />;
}

function SectionTitle({ children, action }) {
  return <div className="section-title"><h3>{children}</h3>{action}</div>;
}

function SubBar({ title, onBack, right }) {
  return (
    <div className="subbar">
      <button className="icon sm" onClick={onBack} title="Back"><Icon name="arrowLeft" size={16} /></button>
      <h2 className="grow">{title}</h2>
      {right}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map(([id, lbl]) => (
        <button key={id} className={value === id ? "active" : ""} onClick={() => onChange(id)}>{lbl}</button>
      ))}
    </div>
  );
}

function Banner({ kind = "warn", icon = "alert", children }) {
  return <div className={`banner ${kind}`}><Icon name={icon} size={16} /><div>{children}</div></div>;
}

function AddrChip({ addr }) {
  const [copied, setCopied] = useState(false);
  const short = addr.slice(0, 6) + "…" + addr.slice(-4);
  return (
    <button className="addr-chip mono" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      {copied ? "Copied" : short}<Icon name={copied ? "check" : "copy"} size={13} />
    </button>
  );
}

function StatusPill({ status }) {
  const map = { ok: ["ok", "Confirmed"], pending: ["pending", "Pending"], fail: ["fail", "Failed"] };
  const [cls, lbl] = map[status] || map.ok;
  return <span className={`status ${cls}`}>● {lbl}</span>;
}

function TopBar({ brand, wallet, onSwitch, onLock, onRefresh, locked }) {
  return (
    <div className="topbar">
      <button className="wallet-pill" onClick={onSwitch} title="Switch wallet">
        <span className="brand-mark">{brand.glyph}</span>
        <span className="wallet-pill-text">
          <strong>{wallet ? wallet.name : brand.name}</strong>
          <span>{locked ? "Locked" : "Unlocked · 9:32"}</span>
        </span>
        <Icon name="chevronDown" size={15} style={{ color: "var(--muted)" }} />
      </button>
      <div className="actions">
        <button className="icon sm" onClick={onRefresh} title="Refresh"><Icon name="refresh" size={15} /></button>
        <button className="icon sm" onClick={onLock} title="Lock"><Icon name="lock" size={15} /></button>
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { id: "dashboard", label: "Tokens", icon: "coins" },
  { id: "activity", label: "Activity", icon: "history" },
  { id: "sites", label: "Sites", icon: "globe" },
  { id: "settings", label: "Settings", icon: "settings" }
];

function Nav({ active, onChange, badge }) {
  return (
    <nav className="nav">
      {NAV_ITEMS.map((it) => (
        <button key={it.id} className={`nav-item${active === it.id ? " active" : ""}`} onClick={() => onChange(it.id)}>
          <span className="nav-ico">
            <Icon name={it.icon} size={20} />
            {badge && badge[it.id] ? <span className="nav-badge">{badge[it.id]}</span> : null}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head"><h2>{title}</h2><button className="icon sm" onClick={onClose}><Icon name="x" size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

/* Deterministic blocky QR placeholder (not a real code — visual stand-in). */
function QR({ seed = "wdk", size = 168 }) {
  const cells = 21;
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  function on(x, y) {
    // finder patterns
    const fp = (cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7 && (x === cx || x === cx + 6 || y === cy || y === cy + 6 || (x >= cx + 2 && x <= cx + 4 && y >= cy + 2 && y <= cy + 4));
    if (x < 8 && y < 8) return fp(0, 0);
    if (x > cells - 9 && y < 8) return fp(cells - 7, 0);
    if (x < 8 && y > cells - 9) return fp(0, cells - 7);
    const v = (h ^ (x * 73856093) ^ (y * 19349663)) >>> 0;
    return (v % 100) < 48;
  }
  const rects = [];
  const s = size / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) if (on(x, y)) rects.push(<rect key={x + "_" + y} x={x * s} y={y * s} width={s + 0.5} height={s + 0.5} fill="#0a0a0a" />);
  return <svg className="qr" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{rects}</svg>;
}

Object.assign(window, { Coin, Avatar, NetDot, SectionTitle, SubBar, Field, Segmented, Banner, AddrChip, StatusPill, TopBar, Nav, NAV_ITEMS, Sheet, QR });
