/* Flows 8–10 + support: Sites, Wallet switcher, Settings, dApp Connect,
   dApp Transaction & Signature approvals. */
const { useState: useStateD } = React;

/* ---------- Connected sites ---------- */
function SitesBody() {
  const [sites, setSites] = useStateD(WDATA.SITES);
  return (
    <React.Fragment>
      <SectionTitle>Connected sites</SectionTitle>
      <p className="muted">Sites approved to see your address and request signatures. Revoke any time.</p>
      <div className="stack-sm" style={{ marginTop: 4 }}>
        {sites.map((s) => (
          <div className="row-card" key={s.host}>
            <span className="row-lead">
              <span className="coin" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><Icon name="globe" size={16} /></span>
              <span className="row-id"><strong>{s.host}</strong><span className="faint">{s.accounts.length} account{s.accounts.length > 1 ? "s" : ""} · <NetDot id={s.chain} /> {WDATA.NET[s.chain].label}</span></span>
            </span>
            <button className="icon sm danger" title="Revoke" onClick={() => setSites(sites.filter((x) => x.host !== s.host))}><Icon name="trash" size={15} /></button>
          </div>
        ))}
        {sites.length === 0 ? <div className="empty"><Icon name="globe" size={22} style={{ color: "var(--faint)" }} /><p className="muted">No connected sites yet</p></div> : null}
      </div>
    </React.Fragment>
  );
}

/* ---------- Settings / RPC ---------- */
function SettingsBody({ onLock }) {
  const [rpc, setRpc] = useStateD("");
  const [lockMin, setLockMin] = useStateD("10");
  return (
    <React.Fragment>
      <SectionTitle>Settings</SectionTitle>
      <div className="stack-sm">
        <div className="row-card"><span className="row-lead"><Icon name="clock" size={18} style={{ color: "var(--muted)" }} /><span className="row-id"><strong>Auto-lock</strong><span className="faint">Lock after inactivity</span></span></span>
          <select value={lockMin} onChange={(e) => setLockMin(e.target.value)} style={{ width: "auto", minHeight: 34, paddingRight: 30 }}><option value="1">1 min</option><option value="5">5 min</option><option value="10">10 min</option><option value="30">30 min</option></select>
        </div>
        <div className="row-card"><span className="row-lead"><Icon name="layers" size={18} style={{ color: "var(--muted)" }} /><span className="row-id"><strong>Default currency</strong><span className="faint">Display fiat value</span></span></span>
          <select style={{ width: "auto", minHeight: 34, paddingRight: 30 }}><option>USD</option><option>EUR</option><option>GBP</option></select>
        </div>
      </div>
      <SectionTitle>Networks · RPC</SectionTitle>
      <div className="card stack">
        <Field label="Custom RPC for Ethereum"><input className="mono" placeholder="https://rpc.your-node.example" value={rpc} onChange={(e) => setRpc(e.target.value)} /></Field>
        <Banner kind="info" icon="shield">Custom endpoints are validated against the configured chain ID before use. Only pre-approved WDK networks can be added.</Banner>
        <button className="secondary btn-block" disabled={!rpc}>Save endpoint</button>
      </div>
      <SectionTitle>Danger zone</SectionTitle>
      <div className="stack-sm">
        <button className="secondary btn-block" onClick={onLock}><Icon name="lock" size={16} /> Lock wallet now</button>
        <button className="btn-block" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icon name="trash" size={16} /> Remove this wallet</button>
      </div>
    </React.Fragment>
  );
}

/* ---------- Wallet switcher sheet ---------- */
function WalletSwitcher({ activeId, onSwitch, onClose }) {
  return (
    <Sheet title="Wallets" onClose={onClose}>
      <div className="stack-sm">
        {WDATA.WALLETS.map((w) => (
          <button key={w.id} className="row-card tap" onClick={() => { onSwitch(w.id); onClose(); }}
            style={w.id === activeId ? { borderColor: "var(--accent)" } : {}}>
            <span className="row-lead">
              <Avatar c1={w.color1} c2={w.color2} label={w.name[0]} size={38} />
              <span className="row-id"><strong>{w.name}</strong><span className="faint">{w.accounts} account{w.accounts > 1 ? "s" : ""}</span></span>
            </span>
            {w.id === activeId ? <Icon name="checkCircle" size={18} style={{ color: "var(--accent)" }} /> : <Icon name="chevronRight" size={16} style={{ color: "var(--muted)" }} />}
          </button>
        ))}
      </div>
      <div className="stack-sm" style={{ marginTop: 12 }}>
        <button className="secondary btn-block"><Icon name="plus" size={16} /> Add account</button>
        <button className="btn-block"><Icon name="wallet" size={16} /> Create or import wallet</button>
      </div>
    </Sheet>
  );
}

/* ---------- Approval header (focused dApp screens) ---------- */
function ApprovalHeader({ brand }) {
  return (
    <div className="topbar">
      <span className="brand-lockup"><span className="brand-mark">{brand.glyph}</span><span><div className="brand-name">{brand.name}</div><div className="brand-sub">Review request</div></span></span>
      <span className="chip"><Icon name="shield" size={13} /> Secure</span>
    </div>
  );
}

/* ---------- dApp connection approval ---------- */
function ConnectApproval({ brand, onResolve }) {
  const [sel, setSel] = useStateD([0]);
  const toggle = (i) => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]);
  return (
    <div className="shell approval-active">
      <ApprovalHeader brand={brand} />
      <div className="shell-body screen-enter">
        <div className="approval">
          <div className="approval-head"><span className="approval-kind">Connection request</span><span className="origin-pill">app.uniswap.org</span></div>
          <div className="approval-origin">
            <span className="coin" style={{ background: "var(--surface-soft)", color: "var(--muted)", width: 40, height: 40 }}><Icon name="globe" size={20} /></span>
            <div className="row-id"><strong>app.uniswap.org</strong><span className="faint">wants to connect to your wallet</span></div>
          </div>
          <Banner kind="warn" icon="alert">This site will see your selected addresses and can request transactions &amp; signatures. It cannot move funds without your approval.</Banner>
          <div className="stack-sm">
            <span className="eyebrow">Select accounts</span>
            {WDATA.ACCOUNTS.map((a) => (
              <button key={a.i} className="row-card tap" onClick={() => toggle(a.i)} style={sel.includes(a.i) ? { borderColor: "var(--accent)" } : {}}>
                <span className="row-lead"><Avatar c1="#2dd4bf" c2="#6366f1" label={String(a.i + 1)} size={32} /><span className="row-id"><strong>{a.name}</strong><span className="faint mono">{a.addr.slice(0, 8)}…{a.addr.slice(-4)}</span></span></span>
                <Icon name={sel.includes(a.i) ? "checkCircle" : "chevronRight"} size={18} style={{ color: sel.includes(a.i) ? "var(--accent)" : "var(--muted)" }} />
              </button>
            ))}
          </div>
          <div className="approval-actions"><button className="secondary" onClick={() => onResolve("reject")}><Icon name="x" size={16} />Reject</button><button disabled={!sel.length} onClick={() => onResolve("approve")}><Icon name="check" size={16} />Connect</button></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- dApp transaction approval (decoded swap) ---------- */
function TxApproval({ brand, onResolve }) {
  return (
    <div className="shell approval-active">
      <ApprovalHeader brand={brand} />
      <div className="shell-body screen-enter">
        <div className="approval">
          <div className="approval-head"><span className="approval-kind">Transaction request</span><span className="origin-pill">app.uniswap.org</span></div>
          <h2>Swap on Uniswap V2</h2>
          <p className="muted">Requested by <strong style={{ color: "var(--ink)" }}>https://app.uniswap.org</strong> · Account 1</p>
          <Banner kind="warn" icon="alert">Only approve if you trust this site. Unknown calldata and custom gas are blocked; this call passed RPC estimation &amp; simulation.</Banner>
          <dl className="dl">
            <div className="dl-row"><dt>Network</dt><dd>Ethereum</dd></div>
            <div className="dl-row"><dt>Protocol</dt><dd>Uniswap V2 Router</dd></div>
            <div className="dl-row"><dt>Token in</dt><dd className="mono">500.00 USDt</dd></div>
            <div className="dl-row"><dt>Token out</dt><dd className="mono">≈ 0.1942 ETH</dd></div>
            <div className="dl-row"><dt>Min output</dt><dd className="mono">0.1923 ETH</dd></div>
            <div className="dl-row"><dt>Router</dt><dd className="mono">0x7a25…488d</dd></div>
            <div className="dl-row"><dt>Gas estimate</dt><dd className="mono">142,800</dd></div>
            <div className="dl-row"><dt>Max fee</dt><dd className="mono">0.00212 ETH</dd></div>
          </dl>
          <Banner kind="good" icon="checkCircle">RPC preflight passed · eth_estimateGas + eth_call at latest block</Banner>
          <div className="approval-actions"><button className="secondary" onClick={() => onResolve("reject")}><Icon name="x" size={16} />Reject</button><button onClick={() => onResolve("approve")}><Icon name="shield" size={16} />Approve</button></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- dApp signature approval (personal_sign) ---------- */
function SignApproval({ brand, onResolve }) {
  const msg = "Welcome to Uniswap!\n\nSign this message to verify ownership of your wallet. This request will not trigger a transaction or cost gas.\n\nNonce: 8f31c0a2-44e1";
  return (
    <div className="shell approval-active">
      <ApprovalHeader brand={brand} />
      <div className="shell-body screen-enter">
        <div className="approval">
          <div className="approval-head"><span className="approval-kind">Signature request</span><span className="origin-pill">app.uniswap.org</span></div>
          <h2>Sign message</h2>
          <p className="muted">Requested by <strong style={{ color: "var(--ink)" }}>https://app.uniswap.org</strong> · Account 1</p>
          <Banner kind="info" icon="shield">Signing proves you own this address. It does not move funds or cost gas — but never sign messages you don't understand.</Banner>
          <div className="stack-sm">
            <span className="eyebrow">Message</span>
            <code className="address" style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 }}>{msg}</code>
          </div>
          <div className="approval-actions"><button className="secondary" onClick={() => onResolve("reject")}><Icon name="x" size={16} />Reject</button><button onClick={() => onResolve("approve")}><Icon name="check" size={16} />Sign</button></div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SitesBody, SettingsBody, WalletSwitcher, ConnectApproval, TxApproval, SignApproval, ApprovalHeader });
