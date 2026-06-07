/* ============================================================================
   Static wallet previews for the design-system page.
   Renders representative wallet UI (token-driven) into a container and applies
   a theme, so the same screen can be shown across every brand at once.
   ========================================================================== */
(function () {
  "use strict";
  const I = {
    send: '<path d="M7 17 17 7M8 7h9v9"/>',
    receive: '<path d="M17 7 7 17M16 17H7V8"/>',
    swap: '<path d="M7 4v13m0 0 3-3m-3 3-3-3M17 20V7m0 0 3 3m-3-3-3 3"/>',
    buy: '<path d="M12 5v14M5 12h14"/>',
    coins: '<path d="M2 8a6 6 0 1 0 12 0 6 6 0 1 0-12 0"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    history: '<path d="M3 20h18"/><path d="M7.5 20v-4.5"/><path d="M12 20v-9"/><path d="M16.5 20v-13"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
    settings: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/><path d="M15 4.5v4M8.5 10v4M16 15.5v4"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
    shield: '<path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    wallet: '<path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 1.5-3H16M16 13h2"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>'
  };
  function svg(name, size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name] || ""}</svg>`;
  }

  const NAV = [["coins", "Tokens", true], ["history", "Activity", false], ["globe", "Sites", false], ["settings", "Settings", false]];
  function navHtml() {
    return `<nav class="nav">${NAV.map(([ic, label, active]) =>
      `<button class="nav-item${active ? " active" : ""}"><span class="nav-ico">${svg(ic, 20)}</span>${label}</button>`).join("")}</nav>`;
  }

  const COIN_ICON = { USDt: "usdt", BTC: "btc", XAUt: "xaut", ETH: "eth", SOL: "sol" };
  const ASSETS = [
    ["USDt", "Tether USD", "12,480.50", "#26a17b", "3 networks"],
    ["BTC", "Bitcoin", "0.2841", "#f7931a", "Bitcoin"],
    ["XAUt", "Tether Gold", "4.20", "#b8901f", "Ethereum"],
    ["ETH", "Ethereum", "1.904", "#627eea", "2 networks"]
  ];

  function dashboardHtml(theme, navOverride) {
    const b = theme.brand;
    const navp = navOverride || theme.nav;
    const rail = navp === "rail";
    const body = `
      <div class="topbar">
        <button class="wallet-pill">
          <span class="brand-mark" style="--mark-fill:${b.markFill};--mark-ink:${b.markInk}">${b.glyph}</span>
          <span class="wallet-pill-text"><strong>${b.name}</strong><span>Unlocked · 9:32</span></span>
          ${svg("chevron", 15)}
        </button>
        <div class="actions">
          <button class="icon sm">${svg("refresh", 15)}</button>
          <button class="icon sm">${svg("lock", 15)}</button>
        </div>
      </div>`;
    const main = `
      <div class="shell-body">
        <div class="hero">
          <div class="spread">
            <div class="stack-sm">
              <span class="eyebrow">Total balance</span>
              <div class="hero-total"><span class="hero-amount num">$18,640</span><span class="hero-cur">.12</span></div>
            </div>
            <span class="delta-chip">${svg("send", 11)} 2.4%</span>
          </div>
          <svg class="spark" viewBox="0 0 108 32" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="pspg-${theme.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="M0,26 L11,22 L22,24 L33,15 L44,19 L55,10 L66,14 L77,5 L88,9 L99,3 L108,6 L108,32 L0,32 Z" fill="url(#pspg-${theme.id})"/><path d="M0,26 L11,22 L22,24 L33,15 L44,19 L55,10 L66,14 L77,5 L88,9 L99,3 L108,6" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>
          <div class="spread"><button class="addr-chip mono">0x8f3a…4e1c ${svg("copy", 13)}</button><span class="faint">Last 7 days</span></div>
          <div class="quick">
            <button class="quick-btn"><span class="quick-ico">${svg("send", 18)}</span>Send</button>
            <button class="quick-btn"><span class="quick-ico">${svg("receive", 18)}</span>Receive</button>
            <button class="quick-btn"><span class="quick-ico">${svg("swap", 18)}</span>Swap</button>
            <button class="quick-btn"><span class="quick-ico">${svg("buy", 18)}</span>Buy</button>
          </div>
        </div>
        <div class="section-title"><h3>Assets</h3></div>
        <div class="stack-sm">
          ${ASSETS.map(([sym, name, amt, color, net]) => `
            <div class="row-card">
              <div class="row-lead">
                <img class="coin" src="assets/coins/${COIN_ICON[sym] || 'generic'}.svg" alt="${sym}" style="width:32px;height:32px;border-radius:50%;box-shadow:none;flex:0 0 auto" />
                <span class="row-id"><strong>${sym}</strong><span class="faint">${net}</span></span>
              </div>
              <span class="row-amt"><strong class="num">${amt}</strong></span>
            </div>`).join("")}
        </div>
      </div>`;
    if (rail) {
      return `<div class="shell">${body}<div class="layout">${navHtml()}<div class="main-col">${main}</div></div></div>`;
    }
    return `<div class="shell">${body}${main}${navHtml()}</div>`;
  }

  function renderDashboard(el, themeId, navOverride) {
    const t = window.WDK.applyTheme(el, themeId);
    el.classList.add("wlt");
    if (navOverride) el.setAttribute("data-nav", navOverride);
    el.innerHTML = dashboardHtml(t, navOverride);
    return t;
  }

  window.WDKPreview = { renderDashboard, svg, dashboardHtml };
})();
