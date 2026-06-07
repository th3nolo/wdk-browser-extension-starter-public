import { useMemo, type ReactNode } from "react";
import {
  CHAINS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_STRENGTH_LABELS,
  analyzePasswordStrength,
  createSeedPhrase,
  getPasswordValidationMessage,
  validatePassword,
  validateSeedPhrase,
  type ChainId,
  type PopupState,
  type PopupSummaryState
} from "../sdk/view-types";
import { walletClient } from "./api";
import { Icon } from "./Icon";
import type { PopupActionRunner } from "./usePopupState";
import { useState } from "react";

export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="app-header brand-lockup">
      <span className="brand-mark" aria-hidden="true">W</span>
      <span>
        <h1 className="brand-name">{title}</h1>
        <p className="brand-sub">{subtitle}</p>
      </span>
    </header>
  );
}

/** Section eyebrow + optional right-aligned action (prototype SectionTitle). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action}
    </div>
  );
}

/** Sub-screen header: back button + grow title + optional right slot. */
export function SubBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="subbar subview-bar">
      <button className="icon sm" type="button" onClick={onBack} title="Back"><Icon name="arrowLeft" size={16} /></button>
      <h2 className="grow">{title}</h2>
      {right}
    </div>
  );
}

/** Leading-icon callout banner (prototype Banner). Token-driven kind colors. */
export function Banner({ kind = "warn", icon = "alert", children }: {
  kind?: "warn" | "danger" | "info" | "good";
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className={`banner ${kind}`}>
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Copyable short-address chip (prototype AddrChip). */
export function AddrChip({ addr }: { addr: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  async function copy() {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(addr);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <button className="addr-chip mono" type="button" onClick={() => void copy()} title="Copy address">
      {copied ? "Copied" : short}
      <Icon name={copied ? "check" : "copy"} size={13} />
    </button>
  );
}

/** Transaction status pill (prototype StatusPill). */
export function StatusPill({ status }: { status: "ok" | "pending" | "fail" }) {
  const map = { ok: "Confirmed", pending: "Pending", fail: "Failed" } as const;
  return <span className={`status ${status}`}>● {map[status]}</span>;
}

/** Symbol → bundled coin SVG file (resolves at /coins/<file>.svg in the build). */
const COIN_ICON: Record<string, string> = {
  USDt: "usdt",
  BTC: "btc",
  XAUt: "xaut",
  ETH: "eth",
  SOL: "sol"
};

/** Round token mark — real brand SVG with a graceful initials fallback (prototype Coin). */
export function Coin({ sym, size = 32 }: { sym: string; size?: number }) {
  const file = COIN_ICON[sym] ?? "generic";
  const [failed, setFailed] = useState(false);
  if (failed) {
    const hue = hashHue(sym);
    return (
      <span
        className="coin"
        aria-hidden="true"
        style={{ width: size, height: size, background: `linear-gradient(140deg, hsl(${hue} 62% 46%), hsl(${(hue + 40) % 360} 64% 38%))`, color: "#fff", boxShadow: "none" }}
      >
        {sym.slice(0, 3)}
      </span>
    );
  }
  return (
    <img
      className="coin"
      src={`/coins/${file}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "50%", boxShadow: "none" }}
      onError={() => setFailed(true)}
    />
  );
}

export function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <div className="segmented">
      {options.map(([id, label]) => (
        <button key={id} className={value === id ? "active" : ""} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Deterministic gradient avatar derived from an address so each account reads distinctly. */
export function Avatar({ seed, label, size = 36 }: { seed: string; label?: string; size?: number }) {
  const hue = hashHue(seed);
  const style = {
    width: size,
    height: size,
    background: `linear-gradient(140deg, hsl(${hue} 70% 52%), hsl(${(hue + 48) % 360} 72% 44%))`
  } as const;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {label}
    </span>
  );
}

function hashHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

/** Bottom-anchored modal sheet used for the wallet/account switcher and settings dialogs. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grip sheet-handle" aria-hidden="true" />
        <div className="sheet-head sheet-header">
          <h2>{title}</h2>
          <button className="icon sm" type="button" onClick={onClose} title="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function chainLabel(chain: ChainId): string {
  return CHAINS.find((entry) => entry.id === chain)?.label ?? chain;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** True when a base-unit balance string represents a non-zero holding. */
export function isNonZeroAmount(amount: string): boolean {
  try {
    return BigInt(amount) > 0n;
  } catch {
    return false;
  }
}

export function PasswordStrengthHint({ password }: { password: string }) {
  const analysis = useMemo(() => (password ? analyzePasswordStrength(password) : null), [password]);
  const validationMessage = getPasswordValidationMessage(password);

  if (!password) {
    return (
      <p className="muted password-hint">
        Use a passphrase of four or more unrelated words, or a long random password. This encrypts your vault offline.
      </p>
    );
  }

  const score = analysis?.score ?? 0;
  const label = PASSWORD_STRENGTH_LABELS[score];

  return (
    <div className="password-strength">
      <div className="password-strength-bar" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className={index <= score ? `active score-${score}` : undefined} />
        ))}
      </div>
      <p className="muted password-hint">
        Strength: {label}
        {analysis?.feedback.suggestions[0] ? ` - ${analysis.feedback.suggestions[0]}` : ""}
      </p>
      {validationMessage && <p className="error">{validationMessage}</p>}
    </div>
  );
}

export function WalletForm({ title, subtitle, defaultName, busy, error, onState, onDone, run }: {
  title: string;
  subtitle: string;
  defaultName: string;
  busy: boolean;
  error?: string;
  onState: (state: PopupSummaryState | PopupState) => void;
  onDone?: () => void;
  run: PopupActionRunner;
}) {
  const [mode, setMode] = useState<"create" | "import">("create");
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [generatedSeedPhrase, setGeneratedSeedPhrase] = useState(() => createSeedPhrase());
  const [showSeed, setShowSeed] = useState(false);
  const [recoveryPhraseSaved, setRecoveryPhraseSaved] = useState(false);
  const selectedSeedPhrase = mode === "create" ? generatedSeedPhrase : seedPhrase;
  const seedValid = validateSeedPhrase(selectedSeedPhrase);
  const canSubmit = validatePassword(password) && seedValid && (mode === "import" || recoveryPhraseSaved);

  function regenerateSeedPhrase() {
    setGeneratedSeedPhrase(createSeedPhrase());
    setRecoveryPhraseSaved(false);
  }

  async function submit() {
    if (!canSubmit) return;
    const next = await run(() => (mode === "create"
      ? walletClient.createWallet(name, password, selectedSeedPhrase)
      : walletClient.importWallet(name, password, selectedSeedPhrase)));
    if (next) {
      onState(next);
      onDone?.();
    }
  }

  return (
    <section className="stack">
      <Header title={title} subtitle={subtitle} />
      <Segmented value={mode} options={[["create", "Create"], ["import", "Import"]]} onChange={(value) => { setMode(value as "create" | "import"); setRecoveryPhraseSaved(false); }} />
      <label>
        Wallet name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} minLength={MIN_PASSWORD_LENGTH} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <PasswordStrengthHint password={password} />
      {mode === "create" && (
        <div className="review-panel">
          <div className="section-title">
            <h2>Recovery phrase backup</h2>
            <button className="icon sm" type="button" onClick={regenerateSeedPhrase} title="Regenerate recovery phrase"><Icon name="refresh" size={16} /></button>
          </div>
          <Banner kind="warn">Write this phrase down before creating the vault. It is the only way to recover this wallet.</Banner>
          <code className="message-preview seed-preview">{generatedSeedPhrase}</code>
          <label className="check-row">
            <input type="checkbox" checked={recoveryPhraseSaved} onChange={(event) => setRecoveryPhraseSaved(event.target.checked)} />
            I saved this recovery phrase
          </label>
        </div>
      )}
      {mode === "import" && (
        <label>
          Recovery phrase
          <div className="input-wrap textarea-wrap">
            <textarea value={seedPhrase} onChange={(event) => setSeedPhrase(event.target.value)} rows={showSeed ? 5 : 2} className={showSeed ? "" : "masked"} />
            <button className="icon sm" type="button" onClick={() => setShowSeed(!showSeed)} title={showSeed ? "Hide recovery phrase" : "Show recovery phrase"}>
              <Icon name={showSeed ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
        </label>
      )}
      {!seedValid && <p className="error">Recovery phrase is not valid BIP-39.</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn-block" disabled={busy || !canSubmit} onClick={submit}>
        <Icon name={mode === "create" ? "plus" : "download"} size={16} />
        {mode === "create" ? "Create wallet" : "Import wallet"}
      </button>
    </section>
  );
}
