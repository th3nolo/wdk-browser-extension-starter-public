/* Flows 1–3: Onboarding, Import / recovery, Unlock. */
const { useState: useStateA } = React;

function strengthScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5);
}
function Strength({ pw }) {
  const s = strengthScore(pw);
  const cls = s <= 2 ? "weak" : s === 3 ? "mid" : "";
  const label = ["Too short", "Weak", "Fair", "Good", "Strong", "Excellent"][s];
  return (
    <div className="stack-sm">
      <div className="strength">{[0,1,2,3,4].map((i) => <span key={i} className={i < s ? `on ${cls}` : ""} />)}</div>
      {pw ? <span className="faint">Strength: {label}</span> : <span className="faint">Use four or more unrelated words. Encrypts your vault offline.</span>}
    </div>
  );
}

/* ---------- Welcome ---------- */
function WelcomeScreen({ brand, go }) {
  return (
    <div className="shell-body auth-body screen-enter" style={{ justifyContent: "center", gap: 18, textAlign: "center", alignItems: "center" }}>
      <span className="brand-mark" style={{ width: 64, height: 64, fontSize: 28, borderRadius: "var(--radius)" }}>{brand.glyph}</span>
      <div className="stack-sm center">
        <h1 style={{ whiteSpace: "nowrap" }}>{brand.name}</h1>
        <p className="muted" style={{ maxWidth: 280 }}>A self-custodial wallet for Bitcoin, Lightning, Ethereum, and more — keys never leave your device.</p>
      </div>
      <div className="stack" style={{ width: "100%", marginTop: 8 }}>
        <button className="btn-block" onClick={() => go("create")}><Icon name="plus" size={16} /> Create a new wallet</button>
        <button className="btn-block secondary" onClick={() => go("import")}><Icon name="download" size={16} /> I already have a wallet</button>
      </div>
      <span className="faint" style={{ marginTop: 4 }}>Non-custodial · BIP-39 · AES-256-GCM vault</span>
    </div>
  );
}

/* ---------- Create: name + password ---------- */
function CreateScreen({ go, back }) {
  const [name, setName] = useStateA("Primary wallet");
  const [pw, setPw] = useStateA("");
  const ok = pw.length >= 8 && name.trim();
  return (
    <div className="shell-body auth-body screen-enter">
      <SubBar title="Create wallet" onBack={back} />
      <Segmented value="create" options={[["create", "Create"], ["import", "Import"]]} onChange={(v) => v === "import" && go("import")} />
      <Field label="Wallet name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••" /></Field>
      <Strength pw={pw} />
      <div className="grow" />
      <button className="btn-block" disabled={!ok} onClick={() => go("backup")}>Continue <Icon name="chevronRight" size={16} /></button>
    </div>
  );
}

/* ---------- Backup seed ---------- */
function BackupScreen({ go, back }) {
  const [revealed, setRevealed] = useStateA(false);
  const [saved, setSaved] = useStateA(false);
  return (
    <div className="shell-body auth-body screen-enter">
      <SubBar title="Recovery phrase" onBack={back} />
      <Banner kind="warn" icon="alert"><strong>Write this down.</strong> It's the only way to recover this wallet. Never share it.</Banner>
      <div className="seed-grid" style={{ position: "relative" }}>
        {WDATA.SEED.map((w, i) => (
          <div key={i} className={"seed-word" + (revealed ? "" : " seed-blur")}><i>{i + 1}</i>{w}</div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="secondary grow" onClick={() => setRevealed(!revealed)}><Icon name={revealed ? "eyeOff" : "eye"} size={16} />{revealed ? "Hide" : "Reveal phrase"}</button>
        <button className="secondary" onClick={() => {}}><Icon name="copy" size={16} />Copy</button>
      </div>
      <label className="check-row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved my recovery phrase somewhere safe</label>
      <div className="grow" />
      <button className="btn-block" disabled={!saved} onClick={() => go("verify")}>Continue <Icon name="chevronRight" size={16} /></button>
    </div>
  );
}

/* ---------- Verify ---------- */
function VerifyScreen({ go, back, complete }) {
  const target = 6; // verify word #7 (index 6)
  const correct = WDATA.SEED[target];
  const choices = [correct, "harbor", "velvet"].sort();
  const [pick, setPick] = useStateA(null);
  const done = pick === correct;
  return (
    <div className="shell-body auth-body screen-enter">
      <SubBar title="Confirm backup" onBack={back} />
      <p className="muted">Select word <strong style={{ color: "var(--ink)" }}>#{target + 1}</strong> from your recovery phrase to confirm you saved it.</p>
      <div className="stack" style={{ marginTop: 4 }}>
        {choices.map((c) => (
          <button key={c} className={"row-card tap" + (pick === c ? "" : " secondary")} onClick={() => setPick(c)}
            style={pick === c ? { borderColor: done ? "var(--good)" : "var(--danger)", background: "var(--surface)" } : {}}>
            <span className="row-lead"><span className="mono" style={{ fontSize: 14 }}>{c}</span></span>
            {pick === c ? <Icon name={done ? "checkCircle" : "x"} size={18} style={{ color: done ? "var(--good)" : "var(--danger)" }} /> : null}
          </button>
        ))}
      </div>
      {pick && !done ? <span className="error">Not quite — check your written phrase.</span> : null}
      <div className="grow" />
      <button className="btn-block" disabled={!done} onClick={complete}><Icon name="checkCircle" size={16} /> Create wallet</button>
    </div>
  );
}

/* ---------- Import ---------- */
function ImportScreen({ go, back, complete }) {
  const [len, setLen] = useStateA("12");
  const [seed, setSeed] = useStateA("");
  const [show, setShow] = useStateA(false);
  const [name, setName] = useStateA("Imported wallet");
  const [pw, setPw] = useStateA("");
  const words = seed.trim().split(/\s+/).filter(Boolean).length;
  const ok = words === Number(len) && pw.length >= 8 && name.trim();
  return (
    <div className="shell-body auth-body screen-enter">
      <SubBar title="Import wallet" onBack={back} />
      <Segmented value="import" options={[["create", "Create"], ["import", "Import"]]} onChange={(v) => v === "create" && go("create")} />
      <Segmented value={len} options={[["12", "12 words"], ["24", "24 words"]]} onChange={setLen} />
      <Field label="Recovery phrase">
        <div className="input-wrap">
          <textarea rows={show ? 4 : 3} className={show ? "" : "masked"} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="word1 word2 word3 …" />
          <button className="icon" onClick={() => setShow(!show)}><Icon name={show ? "eyeOff" : "eye"} size={16} /></button>
        </div>
      </Field>
      <span className="faint">{words}/{len} words {words === Number(len) ? "· valid length" : ""}</span>
      <Field label="Wallet name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="New password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••" /></Field>
      <div className="grow" />
      <button className="btn-block" disabled={!ok} onClick={complete}><Icon name="download" size={16} /> Import wallet</button>
    </div>
  );
}

/* ---------- Unlock ---------- */
function UnlockScreen({ brand, complete, onForgot }) {
  const [pw, setPw] = useStateA("");
  const [err, setErr] = useStateA(false);
  function submit() { if (pw.length >= 4) complete(); else setErr(true); }
  return (
    <div className="shell-body auth-body screen-enter" style={{ justifyContent: "center", gap: 18, alignItems: "center" }}>
      <span className="brand-mark" style={{ width: 60, height: 60, fontSize: 26, borderRadius: "var(--radius)" }}>{brand.glyph}</span>
      <div className="stack-sm center"><h1 style={{ fontSize: 20 }}>Welcome back</h1><p className="muted">{brand.name} is locked</p></div>
      <div className="stack" style={{ width: "100%" }}>
        <Field label="Password">
          <input type="password" value={pw} autoFocus onChange={(e) => { setPw(e.target.value); setErr(false); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Enter password" />
        </Field>
        {err ? <span className="error">Incorrect password. Try again.</span> : null}
        <button className="btn-block" onClick={submit}><Icon name="unlock" size={16} /> Unlock</button>
      </div>
      <button className="ghost" style={{ fontSize: 12 }} onClick={onForgot}>Forgot password? Reset with recovery phrase</button>
    </div>
  );
}

Object.assign(window, { WelcomeScreen, CreateScreen, BackupScreen, VerifyScreen, ImportScreen, UnlockScreen, Strength });
