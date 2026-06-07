/* Flows 4–7: Dashboard, Send, Receive, Activity. Body components placed
   inside the wallet chrome by App. */
const { useState: useStateW } = React;

function Sparkline() {
  const d = "M0,26 L11,22 L22,24 L33,15 L44,19 L55,10 L66,14 L77,5 L88,9 L99,3 L108,6";
  return (
    <svg className="spark" viewBox="0 0 108 32" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="wspg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
        <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
      </linearGradient></defs>
      <path d={d + " L108,32 L0,32 Z"} fill="url(#wspg)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------- Dashboard ---------- */
function AssetGroup({ a, open, onToggle }) {
  return (
    <div className={"asset-group" + (open ? " open" : "")}>
      <button className="asset-head" onClick={onToggle}>
        <span className="row-lead">
          <Coin sym={a.sym} color={a.color} />
          <span className="row-id"><strong>{a.sym}</strong><span className="faint">{a.networks.length > 1 ? a.networks.length + " networks" : WDATA.NET[a.networks[0]].label}</span></span>
        </span>
        <span className="row-amt">
          <strong className="num">${a.usd.toLocaleString()}</strong>
          {a.networks.length > 1 ? <Icon name="chevronDown" size={15} style={{ color: "var(--muted)", marginLeft: 6, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} /> : null}
        </span>
      </button>
      {open && a.networks.length > 1 ? (
        <div className="asset-break">
          {a.breakdown.map(([net, amt]) => (
            <div className="break-row" key={net}><span className="row"><NetDot id={net} /> {WDATA.NET[net].label}</span><span className="num">{amt} {a.sym}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashboardBody({ onSend, onReceive }) {
  const [open, setOpen] = useStateW(null);
  return (
    <React.Fragment>
      <div className="hero">
        <div className="spread">
          <div className="stack-sm">
            <span className="eyebrow">Total balance</span>
            <div className="hero-total"><span className="hero-amount num">${WDATA.TOTAL_USD.split(".")[0]}</span><span className="hero-cur">.{WDATA.TOTAL_USD.split(".")[1]}</span></div>
          </div>
          <span className="delta-chip"><Icon name="send" size={11} /> 2.4%</span>
        </div>
        <Sparkline />
        <div className="spread">
          <AddrChip addr={WDATA.ACCOUNTS[0].addr} />
          <span className="faint">Last 7 days</span>
        </div>
        <div className="quick">
          {[["send","Send",onSend],["receive","Receive",onReceive],["swap","Swap",()=>{}],["plus","Buy",()=>{}]].map(([ic,lbl,fn]) => (
            <button key={lbl} className="quick-btn" onClick={fn}><span className="quick-ico"><Icon name={ic} size={18} /></span>{lbl}</button>
          ))}
        </div>
      </div>
      <SectionTitle action={<button className="ghost" style={{ minHeight: 28, padding: "0 8px", fontSize: 12 }}><Icon name="plus" size={14} />Add</button>}>Assets</SectionTitle>
      <div className="stack-sm">
        {WDATA.ASSETS.map((a) => <AssetGroup key={a.sym} a={a} open={open === a.sym} onToggle={() => setOpen(open === a.sym ? null : a.sym)} />)}
      </div>
    </React.Fragment>
  );
}

/* ---------- Send ---------- */
function SendPanel({ onBack }) {
  const [step, setStep] = useStateW("form");
  const [asset, setAsset] = useStateW(WDATA.ASSETS[0]);
  const [net, setNet] = useStateW(asset.networks[0]);
  const [to, setTo] = useStateW("");
  const [amt, setAmt] = useStateW("");
  const [pickAsset, setPickAsset] = useStateW(false);
  const valid = to.length > 8 && Number(amt) > 0;

  if (step === "success") {
    return (
      <div className="screen-enter stack" style={{ flex: 1, justifyContent: "center", alignItems: "center", textAlign: "center", gap: 16 }}>
        <span className="quick-ico" style={{ width: 64, height: 64, color: "var(--good)", background: "var(--good-soft)" }}><Icon name="check" size={30} /></span>
        <div className="stack-sm center"><h2>Transaction sent</h2><p className="muted">{amt} {asset.sym} to {to.slice(0,6)}…{to.slice(-4)} on {WDATA.NET[net].label}</p></div>
        <span className="status pending">● Broadcasting · check Activity</span>
        <button className="btn-block" onClick={onBack} style={{ marginTop: 8 }}>Done</button>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="screen-enter stack">
        <SubBar title="Review send" onBack={() => setStep("form")} />
        <div className="approval">
          <div className="approval-head"><span className="approval-kind">Sending</span><span className="chip"><NetDot id={net} /> {WDATA.NET[net].label}</span></div>
          <div className="hero-total" style={{ justifyContent: "center", padding: "6px 0" }}><span className="hero-amount num" style={{ fontSize: 30 }}>{amt}</span><span className="hero-cur">{asset.sym}</span></div>
          <dl className="dl">
            <div className="dl-row"><dt>Asset</dt><dd>{asset.name}</dd></div>
            <div className="dl-row"><dt>To</dt><dd className="mono">{to}</dd></div>
            <div className="dl-row"><dt>Network</dt><dd>{WDATA.NET[net].label}</dd></div>
            <div className="dl-row"><dt>Network fee</dt><dd className="mono">~0.00021 {WDATA.NET[net].native}</dd></div>
            <div className="dl-row"><dt>Arrives</dt><dd>~30 sec</dd></div>
          </dl>
          <div className="approval-actions"><button className="secondary" onClick={() => setStep("form")}>Edit</button><button onClick={() => setStep("success")}><Icon name="send" size={16} />Confirm send</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-enter stack">
      <SubBar title="Send" onBack={onBack} />
      <button className="row-card tap" onClick={() => setPickAsset(!pickAsset)}>
        <span className="row-lead"><Coin sym={asset.sym} color={asset.color} /><span className="row-id"><strong>{asset.sym}</strong><span className="faint">{asset.name}</span></span></span>
        <Icon name="chevronDown" size={16} style={{ color: "var(--muted)" }} />
      </button>
      {pickAsset ? (
        <div className="stack-sm">{WDATA.ASSETS.map((a) => (
          <button key={a.sym} className="row-card tap" onClick={() => { setAsset(a); setNet(a.networks[0]); setPickAsset(false); }}>
            <span className="row-lead"><Coin sym={a.sym} color={a.color} size={30} /><span className="row-id"><strong>{a.sym}</strong></span></span>
            <span className="num">${a.usd.toLocaleString()}</span>
          </button>))}
        </div>
      ) : (
        <React.Fragment>
          <Field label="Network">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {asset.networks.map((id) => (
                <button key={id} className={"chip" + (net === id ? "" : "")} onClick={() => setNet(id)}
                  style={{ cursor: "pointer", borderColor: net === id ? "var(--accent)" : "var(--border)", color: net === id ? "var(--ink)" : "var(--muted)", padding: "8px 12px" }}>
                  <NetDot id={id} /> {WDATA.NET[id].label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Recipient">
            <div className="input-wrap">
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={net === "bitcoin" ? "bc1q…" : "0x… or name"} className="mono" style={{ paddingRight: 78 }} />
              <button className="icon" style={{ right: 40 }} title="Paste" onClick={() => setTo("0x77a1c5e2b9f04d3a6e8b1c2d3e4f5a6b7c8d1d4a")}><Icon name="copy" size={15} /></button>
              <button className="icon" title="Scan QR"><Icon name="scan" size={15} /></button>
            </div>
          </Field>
          <Field label="Amount">
            <div className="input-wrap">
              <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" className="num" style={{ paddingRight: 56 }} inputMode="decimal" />
              <button className="chip" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", cursor: "pointer" }} onClick={() => setAmt(asset.qty || "1000")}>MAX</button>
            </div>
          </Field>
          <span className="faint">Available: {asset.qty || asset.usd.toLocaleString()} {asset.sym}</span>
          <div className="grow" />
          <button className="btn-block" disabled={!valid} onClick={() => setStep("review")}>Review <Icon name="chevronRight" size={16} /></button>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- Receive ---------- */
function ReceivePanel({ onBack }) {
  const [net, setNet] = useStateW("ethereum");
  const acct = WDATA.ACCOUNTS[0];
  const addr = net === "bitcoin" ? "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" : acct.addr;
  const [copied, setCopied] = useStateW(false);
  return (
    <div className="screen-enter stack">
      <SubBar title="Receive" onBack={onBack} />
      <Field label="Network">
        <select value={net} onChange={(e) => setNet(e.target.value)}>
          {WDATA.NETWORKS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </Field>
      <div className="stack" style={{ alignItems: "center", textAlign: "center", marginTop: 4 }}>
        <QR seed={addr} />
        <p className="muted">Your {WDATA.NET[net].label} address</p>
        <code className="address">{addr}</code>
        <div className="row" style={{ gap: 8, width: "100%" }}>
          <button className="grow" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }}><Icon name={copied ? "check" : "copy"} size={16} />{copied ? "Copied" : "Copy address"}</button>
          <button className="secondary" title="Share"><Icon name="external" size={16} /></button>
        </div>
      </div>
      <Banner kind="info" icon="shield">Only send {WDATA.NET[net].label} assets to this address. Sending other networks may lose funds.</Banner>
    </div>
  );
}

/* ---------- Activity ---------- */
function ActivityBody({ onOpen }) {
  const [filter, setFilter] = useStateW("all");
  const list = filter === "all" ? WDATA.TXNS : WDATA.TXNS.filter((t) => t.kind === filter || (filter === "send" && t.kind === "swap"));
  const ic = { send: "send", receive: "receive", swap: "swap" };
  return (
    <React.Fragment>
      <SectionTitle>Activity</SectionTitle>
      <div className="row" style={{ gap: 6 }}>
        {[["all", "All"], ["receive", "Received"], ["send", "Sent"]].map(([id, l]) => (
          <button key={id} className="chip" onClick={() => setFilter(id)} style={{ cursor: "pointer", borderColor: filter === id ? "var(--accent)" : "var(--border)", color: filter === id ? "var(--ink)" : "var(--muted)" }}>{l}</button>
        ))}
      </div>
      <div className="stack-sm">
        {list.map((t) => (
          <button key={t.id} className="row-card tap" onClick={() => onOpen(t)}>
            <span className="row-lead">
              <span className="quick-ico" style={{ width: 34, height: 34, color: t.kind === "receive" ? "var(--good)" : "var(--accent)", background: t.kind === "receive" ? "var(--good-soft)" : "var(--accent-soft)" }}><Icon name={ic[t.kind] || "swap"} size={16} /></span>
              <span className="row-id"><strong style={{ textTransform: "capitalize" }}>{t.kind}</strong><span className="faint">{t.when}</span></span>
            </span>
            <span className="row-amt"><strong className="num">{t.amt}</strong><div style={{ marginTop: 2 }}><StatusPill status={t.status} /></div></span>
          </button>
        ))}
      </div>
    </React.Fragment>
  );
}

function ActivityDetail({ tx, onBack }) {
  return (
    <div className="screen-enter stack">
      <SubBar title="Transaction" onBack={onBack} />
      <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "8px 0" }}>
        <span className="quick-ico" style={{ width: 56, height: 56, color: tx.kind === "receive" ? "var(--good)" : "var(--accent)", background: tx.kind === "receive" ? "var(--good-soft)" : "var(--accent-soft)" }}><Icon name={tx.kind === "receive" ? "receive" : tx.kind === "swap" ? "swap" : "send"} size={26} /></span>
        <div className="stack-sm center"><h2 className="num">{tx.amt} {tx.asset}</h2><p className="muted">{tx.usd}</p><StatusPill status={tx.status} /></div>
      </div>
      <dl className="dl">
        <div className="dl-row"><dt>{tx.kind === "receive" ? "From" : "To"}</dt><dd className="mono">{tx.to || tx.from}</dd></div>
        <div className="dl-row"><dt>Network</dt><dd>{WDATA.NET[tx.net].label}</dd></div>
        <div className="dl-row"><dt>Date</dt><dd>{tx.when}</dd></div>
        <div className="dl-row"><dt>Hash</dt><dd className="mono">{tx.hash}</dd></div>
      </dl>
      <button className="secondary btn-block"><Icon name="external" size={16} /> View on explorer</button>
    </div>
  );
}

Object.assign(window, { DashboardBody, SendPanel, ReceivePanel, ActivityBody, ActivityDetail });
