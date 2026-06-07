/* Prototype orchestrator: extension popup device, flow router, and the live
   whitelabel control rail (all 8 theming axes). */
const { useState, useEffect, useMemo, useRef } = React;

/* ---- build a live theme spec from preset + per-axis overrides ---- */
function buildSpec(presetId, ov) {
  const base = WDK.THEME_MAP[presetId] || WDK.THEMES[0];
  const t = Object.assign({}, base, { fonts: Object.assign({}, base.fonts), accent: Object.assign({}, base.accent), brand: Object.assign({}, base.brand) });
  if (ov.mode) t.mode = ov.mode;
  if (ov.accent) { t.accent = ov.accent; t.brand.markFill = ov.accent.base; t.brand.markInk = ov.accent.ink; }
  if (ov.shape) t.shape = ov.shape;
  if (ov.density) t.density = ov.density;
  if (ov.nav) t.nav = ov.nav;
  if (ov.fonts) t.fonts = ov.fonts;
  if (ov.icons) t.icons = ov.icons;
  return t;
}

/* ---- the wallet chrome (topbar + body + nav, nav-pattern aware) ---- */
function WalletView(p) {
  const { brand, wallet, tab, subview, nav, badge } = p;
  let body;
  if (subview === "send") body = <SendPanel onBack={p.clearSub} />;
  else if (subview === "receive") body = <ReceivePanel onBack={p.clearSub} />;
  else if (subview === "txDetail") body = <ActivityDetail tx={p.tx} onBack={p.clearSub} />;
  else if (tab === "activity") body = <ActivityBody onOpen={p.openTx} />;
  else if (tab === "sites") body = <SitesBody />;
  else if (tab === "settings") body = <SettingsBody onLock={p.onLock} />;
  else body = <DashboardBody onSend={() => p.setSub("send")} onReceive={() => p.setSub("receive")} />;

  const top = <TopBar brand={brand} wallet={wallet} onSwitch={p.onSwitch} onLock={p.onLock} onRefresh={() => {}} />;
  const navEl = <Nav active={tab} onChange={p.selectTab} badge={badge} />;
  const bodyEl = <div className="shell-body screen-enter" key={(subview || tab)}>{body}</div>;

  if (nav === "rail") {
    return <div className="shell">{top}<div className="layout">{navEl}<div className="main-col">{bodyEl}</div></div></div>;
  }
  return <div className="shell">{top}{bodyEl}{navEl}</div>;
}

/* ---- control-rail building blocks ---- */
function RailGroup({ title, children, hint }) {
  return <div className="cg"><div className="cg-h">{title}{hint ? <span className="cg-hint">{hint}</span> : null}</div>{children}</div>;
}
function OptRow({ options, value, onChange }) {
  return <div className="opts">{options.map((o) => (
    <button key={o.v} className={"opt" + (value === o.v ? " on" : "")} onClick={() => onChange(o.v)}>{o.l}</button>
  ))}</div>;
}

const FLOWS = [
  { id: "onboarding", n: "01", label: "Onboarding", desc: "Create + back up seed", set: { view: "welcome" } },
  { id: "import", n: "02", label: "Import & recovery", desc: "Restore from phrase", set: { view: "import" } },
  { id: "unlock", n: "03", label: "Unlock", desc: "Password gate", set: { view: "unlock", locked: true } },
  { id: "dashboard", n: "04", label: "Dashboard", desc: "Tokens & balances", set: { view: "wallet", tab: "dashboard", subview: null } },
  { id: "send", n: "05", label: "Send", desc: "Asset → review → sent", set: { view: "wallet", tab: "dashboard", subview: "send" } },
  { id: "receive", n: "06", label: "Receive", desc: "QR + address", set: { view: "wallet", tab: "dashboard", subview: "receive" } },
  { id: "activity", n: "07", label: "Activity", desc: "History + detail", set: { view: "wallet", tab: "activity", subview: null } },
  { id: "sites", n: "08", label: "Connected sites", desc: "Manage dApps", set: { view: "wallet", tab: "sites", subview: null } },
  { id: "connect", n: "09", label: "Connect dApp", desc: "Approve connection", set: { view: "connect" } },
  { id: "approveTx", n: "10", label: "Approve transaction", desc: "Decoded swap review", set: { view: "approveTx" } }
];
const BONUS = [
  { id: "sign", label: "Sign message", set: { view: "approveSign" } },
  { id: "settings", label: "Settings & RPC", set: { view: "wallet", tab: "settings", subview: null } },
  { id: "switch", label: "Switch wallet", set: { view: "wallet", tab: "dashboard", subview: null, switcher: true } }
];

function App() {
  const [presetId, setPresetId] = useState("evolved");
  const [ov, setOv] = useState({});
  const [flowId, setFlowId] = useState("dashboard");
  const [view, setView] = useState("wallet");
  const [tab, setTab] = useState("dashboard");
  const [subview, setSubview] = useState(null);
  const [tx, setTx] = useState(null);
  const [switcher, setSwitcher] = useState(false);
  const [walletId, setWalletId] = useState("w1");
  const [toast, setToast] = useState(null);
  const [importBack, setImportBack] = useState("welcome");

  const spec = useMemo(() => buildSpec(presetId, ov), [presetId, ov]);
  const popupRef = useRef(null);

  useEffect(() => { WDK.loadFonts(); }, []);
  useEffect(() => { if (popupRef.current) WDK.applySpec(popupRef.current, spec); }, [spec]);

  const brand = spec.brand;
  const wallet = WDATA.WALLETS.find((w) => w.id === walletId);

  function launch(f) {
    setFlowId(f.id);
    const s = f.set;
    setImportBack("welcome");
    setView(s.view);
    if ("tab" in s) setTab(s.tab);
    if ("subview" in s) setSubview(s.subview);
    setSwitcher(!!s.switcher);
  }
  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 1900); }
  function complete() { setView("wallet"); setTab("dashboard"); setSubview(null); }
  function resolve(kind, label, dest) {
    flash(kind === "approve" ? `${label} approved` : `${label} rejected`);
    setView("wallet"); setSubview(null); setTab(dest || "dashboard");
  }

  /* current popup screen */
  let screen;
  if (view === "welcome") screen = <WelcomeScreen brand={brand} go={(v) => { if (v === "import") setImportBack("welcome"); setView(v); }} />;
  else if (view === "create") screen = <CreateScreen go={(v) => { if (v === "import") setImportBack("welcome"); setView(v); }} back={() => setView("welcome")} />;
  else if (view === "backup") screen = <BackupScreen go={(v) => setView(v)} back={() => setView("create")} />;
  else if (view === "verify") screen = <VerifyScreen go={(v) => setView(v)} back={() => setView("backup")} complete={() => { complete(); flash("Wallet created"); }} />;
  else if (view === "import") screen = <ImportScreen go={(v) => setView(v)} back={() => setView(importBack)} complete={() => { complete(); flash("Wallet imported"); }} />;
  else if (view === "unlock") screen = <UnlockScreen brand={brand} onForgot={() => { setImportBack("unlock"); setView("import"); }} complete={() => { complete(); flash("Unlocked"); }} />;
  else if (view === "connect") screen = <ConnectApproval brand={brand} onResolve={(k) => resolve(k, "Connection", "sites")} />;
  else if (view === "approveTx") screen = <TxApproval brand={brand} onResolve={(k) => resolve(k, "Transaction", "activity")} />;
  else if (view === "approveSign") screen = <SignApproval brand={brand} onResolve={(k) => resolve(k, "Signature", "sites")} />;
  else screen = (
    <WalletView brand={brand} wallet={wallet} tab={tab} subview={subview} nav={spec.nav}
      badge={{ sites: 0 }} tx={tx}
      setSub={(s) => setSubview(s)} clearSub={() => setSubview(null)}
      selectTab={(t) => { setSubview(null); setTab(t); }}
      openTx={(t) => { setTx(t); setSubview("txDetail"); }}
      onSwitch={() => setSwitcher(true)} onLock={() => { setView("unlock"); }} />
  );

  /* current axis values (read from merged spec) */
  const curAccent = spec.accent.base;

  return (
    <div className="proto">
      {/* ---------------- control rail ---------------- */}
      <aside className="rail">
        <div className="rail-brand"><span className="rb-mark">◈</span><div><div className="rb-t">WDK Wallet</div><div className="rb-s">Whitelabel prototype</div></div></div>

        <RailGroup title="Flows" hint="10 core">
          <div className="flow-list">
            {FLOWS.map((f) => (
              <button key={f.id} className={"flow" + (flowId === f.id ? " on" : "")} onClick={() => launch(f)}>
                <span className="flow-n">{f.n}</span>
                <span className="flow-tx"><span className="flow-l">{f.label}</span><span className="flow-d">{f.desc}</span></span>
              </button>
            ))}
          </div>
          <div className="flow-bonus">{BONUS.map((f) => (
            <button key={f.id} className={"bchip" + (flowId === f.id ? " on" : "")} onClick={() => launch(f)}>{f.label}</button>
          ))}</div>
        </RailGroup>

        <RailGroup title="Brand preset" hint="8">
          <div className="presets">
            {WDK.THEMES.map((t) => (
              <button key={t.id} className={"preset" + (presetId === t.id ? " on" : "")} onClick={() => { setPresetId(t.id); setOv({}); }}>
                <span className="pdot" style={{ background: t.accent.base }} />
                <span className="ptx"><span className="pn">{t.name}</span><span className="pg">{t.group}</span></span>
              </button>
            ))}
          </div>
        </RailGroup>

        <RailGroup title="Customize" hint="live">
          <div className="ctl"><span className="ctl-l">Mode</span>
            <OptRow value={spec.mode} onChange={(v) => setOv({ ...ov, mode: v })} options={[{ v: "light", l: "Light" }, { v: "dark", l: "Dark" }]} />
          </div>
          <div className="ctl"><span className="ctl-l">Accent</span>
            <div className="swatches">{WDATA.ACCENT_OPTIONS.map((a) => (
              <button key={a.name} title={a.name} className={"sw2" + (curAccent === a.base ? " on" : "")} style={{ background: a.base }} onClick={() => setOv({ ...ov, accent: a })} />
            ))}</div>
          </div>
          <div className="ctl"><span className="ctl-l">Shape</span>
            <OptRow value={spec.shape} onChange={(v) => setOv({ ...ov, shape: v })} options={WDK.SHAPE_KEYS.map((k) => ({ v: k, l: k }))} />
          </div>
          <div className="ctl"><span className="ctl-l">Density</span>
            <OptRow value={spec.density} onChange={(v) => setOv({ ...ov, density: v })} options={WDK.DENSITY_KEYS.map((k) => ({ v: k, l: k }))} />
          </div>
          <div className="ctl"><span className="ctl-l">Navigation</span>
            <OptRow value={spec.nav} onChange={(v) => setOv({ ...ov, nav: v })} options={[{ v: "bottom", l: "Bar" }, { v: "pill", l: "Pill" }, { v: "rail", l: "Rail" }]} />
          </div>
          <div className="ctl"><span className="ctl-l">Type</span>
            <OptRow value={spec.fonts.head} onChange={(v) => setOv({ ...ov, fonts: WDATA.FONT_OPTIONS.find((f) => f.head === v) })}
              options={WDATA.FONT_OPTIONS.map((f) => ({ v: f.head, l: f.name }))} />
          </div>
          <button className="reset" onClick={() => setOv({})}><Icon name="refresh" size={13} /> Reset to preset</button>
        </RailGroup>

        <a className="rail-link" href="design-system.html"><Icon name="layers" size={14} /> Open the design system</a>
      </aside>

      {/* ---------------- stage ---------------- */}
      <main className="stage">
       <div className="scene">
        <div className="popup-zone">
          <div className="popup">
            <div className="popup-bar"><span className="pb-d" /><span className="pb-t">{brand.name} — Extension popup</span></div>
            <div className="popup-screen wlt" ref={popupRef}>
              {screen}
              {switcher ? <WalletSwitcher activeId={walletId} onSwitch={(id) => setWalletId(id)} onClose={() => setSwitcher(false)} /> : null}
            </div>
          </div>
          {toast ? <div className="toast"><Icon name="checkCircle" size={15} /> {toast}</div> : null}
        </div>
       </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
