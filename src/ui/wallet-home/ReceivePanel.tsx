import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { AccountRecord } from "../../sdk/view-types";
import { Banner, chainLabel } from "../common";
import { Icon } from "../Icon";

export function ReceivePanel({ accounts }: { accounts: AccountRecord[] }) {
  const [selected, setSelected] = useState(0);
  const account = accounts[selected] ?? accounts[0];
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!account) return;
    void QRCode.toDataURL(account.address, { margin: 1, width: 160 }).then(setQr);
  }, [account]);

  if (!account) return <p className="muted">No account available.</p>;

  return (
    <section className="stack center">
      <label className="field" style={{ width: "100%" }}>
        Network
        <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
          {accounts.map((entry, index) => (
            <option key={`${entry.walletId}-${entry.chain}-${entry.index}`} value={index}>{chainLabel(entry.chain)} #{entry.index + 1}</option>
          ))}
        </select>
      </label>
      {qr && <img className="qr" src={qr} alt="Receive address QR code" />}
      <p className="muted">{chainLabel(account.chain)} address</p>
      <code className="address">{account.address}</code>
      <button className="btn-block" onClick={() => navigator.clipboard.writeText(account.address)}>
        <Icon name="copy" size={16} />
        Copy
      </button>
      <Banner kind="info">Only send {chainLabel(account.chain)} assets to this address. Sending other networks' assets may lose them.</Banner>
    </section>
  );
}
